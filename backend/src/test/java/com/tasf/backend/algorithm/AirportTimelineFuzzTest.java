package com.tasf.backend.algorithm;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.TreeMap;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Differential fuzz test: the augmented-treap {@link AirportTimeline} must produce exactly the
 * same globalPeak / peakBetween / howManyFit results as a brute-force reference that mirrors the
 * original straightforward TreeMap implementation. Runs many randomized op sequences.
 */
class AirportTimelineFuzzTest {

    /** Brute-force oracle: the original O(events) TreeMap logic, kept here as ground truth. */
    private static final class Reference {
        private final Map<String, TreeMap<LocalDateTime, Integer>> events = new java.util.HashMap<>();

        void addEvent(String airport, LocalDateTime time, int delta) {
            events.computeIfAbsent(airport, k -> new TreeMap<>()).merge(time, delta, Integer::sum);
        }

        int globalPeak(String airport) {
            TreeMap<LocalDateTime, Integer> map = events.get(airport);
            if (map == null) return 0;
            int running = 0, peak = 0;
            for (int d : map.values()) {
                running += d;
                if (running > peak) peak = running;
            }
            return Math.max(0, peak);
        }

        int peakBetween(String airport, LocalDateTime from, LocalDateTime to) {
            TreeMap<LocalDateTime, Integer> map = events.get(airport);
            if (map == null) return 0;
            int running = 0;
            for (int d : map.headMap(from).values()) running += d;
            int peak = Math.max(0, running);
            for (Map.Entry<LocalDateTime, Integer> e : map.subMap(from, true, to, true).entrySet()) {
                running += e.getValue();
                if (running > peak) peak = running;
            }
            return Math.max(0, peak);
        }
    }

    @Test
    void treapMatchesBruteForceUnderRandomOps() {
        Random rnd = new Random(1234);
        String[] airports = {"AAA", "BBB", "CCC"};
        LocalDateTime base = LocalDateTime.of(2026, 1, 1, 0, 0);

        // A modest pool of candidate times so add/remove frequently collide on the same key.
        List<LocalDateTime> times = new ArrayList<>();
        for (int i = 0; i < 24; i++) times.add(base.plusHours(i * 3));

        for (int trial = 0; trial < 40; trial++) {
            AirportTimeline treap = new AirportTimeline();
            Reference ref = new Reference();

            for (int op = 0; op < 400; op++) {
                String ap = airports[rnd.nextInt(airports.length)];
                LocalDateTime t = times.get(rnd.nextInt(times.size()));
                int delta = rnd.nextInt(201) - 100; // -100..100 (both arrivals and departures)

                if (rnd.nextBoolean()) {
                    treap.addEvent(ap, t, delta);
                    ref.addEvent(ap, t, delta);
                } else {
                    treap.removeEvent(ap, t, delta);
                    ref.addEvent(ap, t, -delta);
                }

                // Verify every few ops across all airports and random windows.
                if (op % 5 == 0) {
                    for (String a : airports) {
                        assertThat(treap.globalPeak(a))
                            .as("globalPeak trial=%d op=%d airport=%s", trial, op, a)
                            .isEqualTo(ref.globalPeak(a));

                        int i = rnd.nextInt(times.size());
                        int j = rnd.nextInt(times.size());
                        LocalDateTime from = times.get(Math.min(i, j));
                        LocalDateTime to = times.get(Math.max(i, j));
                        assertThat(treap.peakBetween(a, from, to))
                            .as("peakBetween trial=%d op=%d airport=%s [%s,%s]", trial, op, a, from, to)
                            .isEqualTo(ref.peakBetween(a, from, to));
                    }
                }
            }
        }
    }

    @Test
    void peakBetweenWindowBoundariesAreInclusive() {
        AirportTimeline tl = new AirportTimeline();
        LocalDateTime t0 = LocalDateTime.of(2026, 1, 1, 6, 0);
        LocalDateTime t1 = LocalDateTime.of(2026, 1, 1, 10, 0);
        LocalDateTime t2 = LocalDateTime.of(2026, 1, 1, 14, 0);

        tl.addEvent("X", t0, 100); // carry-in before t1
        tl.addEvent("X", t1, 50);  // inside window
        tl.addEvent("X", t2, -150);

        // Window [t1, t2]: carry-in 100 (from t0) + 50 at t1 = peak 150.
        assertThat(tl.peakBetween("X", t1, t2)).isEqualTo(150);
        // Window [t0, t0]: only t0 counts → 100.
        assertThat(tl.peakBetween("X", t0, t0)).isEqualTo(100);
    }
}
