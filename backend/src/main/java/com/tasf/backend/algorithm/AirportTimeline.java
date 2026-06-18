package com.tasf.backend.algorithm;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

public class AirportTimeline {

    // airport → (time → cumulative delta at that moment)
    private final Map<String, TreeMap<LocalDateTime, Integer>> events = new HashMap<>();

    /** Add delta bags at airport starting at time (positive = arrive, negative = depart). */
    public void addEvent(String airport, LocalDateTime time, int delta) {
        events.computeIfAbsent(airport, k -> new TreeMap<>())
              .merge(time, delta, Integer::sum);
    }

    /** Undo a previously added event. */
    public void removeEvent(String airport, LocalDateTime time, int delta) {
        addEvent(airport, time, -delta);
    }

    /** Maximum simultaneous bags at airport across all recorded events. */
    public int globalPeak(String airport) {
        TreeMap<LocalDateTime, Integer> map = events.get(airport);
        if (map == null) return 0;
        int running = 0;
        int peak = 0;
        for (int delta : map.values()) {
            running += delta;
            if (running > peak) peak = running;
        }
        return Math.max(0, peak);
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

    /** Peak load at airport strictly within [from, to] inclusive. */
    public int peakBetween(String airport, LocalDateTime from, LocalDateTime to) {
        TreeMap<LocalDateTime, Integer> map = events.get(airport);
        if (map == null) return 0;
        // Carry-over: bags already at the airport at the start of the window
        int running = 0;
        for (int delta : map.headMap(from).values()) {
            running += delta;
        }
        int peak = Math.max(0, running);
        // Apply events within [from, to] and track peak
        for (Map.Entry<LocalDateTime, Integer> e : map.subMap(from, true, to, true).entrySet()) {
            running += e.getValue();
            if (running > peak) peak = running;
        }
        return Math.max(0, peak);
    }

    /** All airports that have at least one registered event. */
    public Set<String> affectedAirports() {
        return events.keySet();
    }
}
