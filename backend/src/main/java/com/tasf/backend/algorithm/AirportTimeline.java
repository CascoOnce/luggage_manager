package com.tasf.backend.algorithm;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/**
 * Per-airport bag-occupancy timeline used by the metaheuristic planners.
 *
 * <p>Each airport keeps a set of (time → delta) events; the "peak" is the maximum running
 * prefix sum over those events in chronological order. This is queried extremely heavily
 * inside the Simulated Annealing loop (per swap-airport, every iteration), so the naive
 * O(events) scan was the dominant cost when many flights/bags are in play.
 *
 * <p>The events are now stored in a per-airport augmented balanced BST (a treap keyed by
 * time). Each node caches, for its subtree, both the total {@code sum} of deltas and the
 * maximum non-empty prefix sum {@code pre} in key order. That makes:
 * <ul>
 *   <li>{@link #addEvent} / {@link #removeEvent}: O(log n)</li>
 *   <li>{@link #globalPeak}: O(1) — just the root's cached prefix max</li>
 *   <li>{@link #peakBetween}: O(log n) — a range prefix-max aggregate</li>
 * </ul>
 *
 * <p>Public behaviour is identical to the previous TreeMap implementation (verified by a
 * randomized differential fuzz test against a brute-force oracle).
 */
public class AirportTimeline {

    // Sentinel meaning "no non-empty prefix exists" (empty subtree). Kept well away from
    // Long.MIN_VALUE so that additions of real sums never overflow.
    private static final long NEG = Long.MIN_VALUE / 4;

    private static final class Node {
        final LocalDateTime key;
        final int priority;
        int value;          // net delta at this exact time
        Node left, right;
        long sum;           // subtree total delta
        long pre;           // subtree maximum non-empty prefix sum (in key order)

        Node(LocalDateTime key, int value, int priority) {
            this.key = key;
            this.value = value;
            this.priority = priority;
            pull();
        }

        void pull() {
            long sumL = left == null ? 0 : left.sum;
            long sumR = right == null ? 0 : right.sum;
            long preL = left == null ? NEG : left.pre;
            long preR = right == null ? NEG : right.pre;
            this.sum = sumL + value + sumR;
            long throughThis = sumL + value;                         // whole left + this node
            long throughRight = (preR == NEG) ? NEG : throughThis + preR; // + a prefix of right
            this.pre = Math.max(preL, Math.max(throughThis, throughRight));
        }
    }

    /** Immutable (sum, pre) aggregate of an ordered event range. */
    private static final class Agg {
        static final Agg EMPTY = new Agg(0, NEG);
        final long sum;
        final long pre;

        Agg(long sum, long pre) {
            this.sum = sum;
            this.pre = pre;
        }
    }

    // airport → root of its event treap
    private final Map<String, Node> roots = new HashMap<>();
    private final Random rng = new Random(42);  // deterministic priorities → reproducible

    /** Add delta bags at airport starting at time (positive = arrive, negative = depart). */
    public void addEvent(String airport, LocalDateTime time, int delta) {
        roots.put(airport, add(roots.get(airport), time, delta));
    }

    /** Undo a previously added event. */
    public void removeEvent(String airport, LocalDateTime time, int delta) {
        addEvent(airport, time, -delta);
    }

    /** Maximum simultaneous bags at airport across all recorded events. */
    public int globalPeak(String airport) {
        Node root = roots.get(airport);
        if (root == null) return 0;
        return (int) Math.max(0L, root.pre);
    }

    /**
     * How many of the requested qty bags can be added to airport during [from, to]
     * without the peak load exceeding hardCap.
     * Returns a value in [0, qty].
     */
    public int howManyFit(String airport, LocalDateTime from, LocalDateTime to, int qty, int hardCap) {
        int peakExisting = peakBetween(airport, from, to);
        int available = Math.max(0, hardCap - peakExisting);
        return Math.min(qty, available);
    }

    /** Peak load at airport within [from, to] inclusive, carrying over bags present before `from`. */
    public int peakBetween(String airport, LocalDateTime from, LocalDateTime to) {
        Node root = roots.get(airport);
        if (root == null) return 0;
        long carryIn = sumBelow(root, from);                 // bags already present at window start
        long rangePre = rangeAgg(root, from, to).pre;        // best prefix inside the window
        long best = carryIn + Math.max(0L, rangePre == NEG ? 0L : rangePre);
        return (int) Math.max(0L, best);
    }

    /** All airports that have at least one registered event. */
    public Set<String> affectedAirports() {
        return roots.keySet();
    }

    // ── Treap internals ──────────────────────────────────────────────────────────────

    private Node add(Node t, LocalDateTime key, int delta) {
        if (t == null) {
            return new Node(key, delta, rng.nextInt());
        }
        int cmp = key.compareTo(t.key);
        if (cmp == 0) {
            t.value += delta;
        } else if (cmp < 0) {
            t.left = add(t.left, key, delta);
            if (t.left.priority > t.priority) {
                t = rotateRight(t);
            }
        } else {
            t.right = add(t.right, key, delta);
            if (t.right.priority > t.priority) {
                t = rotateLeft(t);
            }
        }
        t.pull();
        return t;
    }

    private Node rotateRight(Node t) {
        Node l = t.left;
        t.left = l.right;
        l.right = t;
        t.pull();
        l.pull();
        return l;
    }

    private Node rotateLeft(Node t) {
        Node r = t.right;
        t.right = r.left;
        r.left = t;
        t.pull();
        r.pull();
        return r;
    }

    private static long subtreeSum(Node t) {
        return t == null ? 0 : t.sum;
    }

    private static Agg agg(Node t) {
        return t == null ? Agg.EMPTY : new Agg(t.sum, t.pre);
    }

    /** Sum of deltas at keys strictly less than `from`. */
    private long sumBelow(Node t, LocalDateTime from) {
        if (t == null) return 0;
        if (t.key.compareTo(from) < 0) {
            return subtreeSum(t.left) + t.value + sumBelow(t.right, from);
        }
        return sumBelow(t.left, from);
    }

    /** Combine two ordered aggregates L then R. */
    private static Agg combine(Agg l, Agg r) {
        long sum = l.sum + r.sum;
        long throughR = (r.pre == NEG) ? NEG : l.sum + r.pre;
        long pre = Math.max(l.pre, throughR);
        return new Agg(sum, pre);
    }

    private static Agg leaf(int value) {
        return new Agg(value, value);
    }

    /** Aggregate of keys in [lo, hi] inclusive, in key order. */
    private Agg rangeAgg(Node t, LocalDateTime lo, LocalDateTime hi) {
        if (t == null) return Agg.EMPTY;
        if (t.key.compareTo(lo) < 0) return rangeAgg(t.right, lo, hi);
        if (t.key.compareTo(hi) > 0) return rangeAgg(t.left, lo, hi);
        // lo <= t.key <= hi: left contributes keys >= lo, right contributes keys <= hi.
        Agg left = aggGE(t.left, lo);
        Agg right = aggLE(t.right, hi);
        return combine(combine(left, leaf(t.value)), right);
    }

    /** Aggregate of keys >= lo, in key order. */
    private Agg aggGE(Node t, LocalDateTime lo) {
        if (t == null) return Agg.EMPTY;
        if (t.key.compareTo(lo) < 0) {
            return aggGE(t.right, lo);
        }
        return combine(combine(aggGE(t.left, lo), leaf(t.value)), agg(t.right));
    }

    /** Aggregate of keys <= hi, in key order. */
    private Agg aggLE(Node t, LocalDateTime hi) {
        if (t == null) return Agg.EMPTY;
        if (t.key.compareTo(hi) > 0) {
            return aggLE(t.left, hi);
        }
        return combine(combine(agg(t.left), leaf(t.value)), aggLE(t.right, hi));
    }
}
