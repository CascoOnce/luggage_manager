package com.tasf.backend.algorithm;

import com.tasf.backend.domain.Aeropuerto;
import com.tasf.backend.domain.Envio;
import com.tasf.backend.domain.EstadoEnvio;
import com.tasf.backend.domain.MetricaAlgoritmo;
import com.tasf.backend.domain.ParametrosSimulacion;
import com.tasf.backend.domain.PlanDeViaje;
import com.tasf.backend.domain.Vuelo;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component("SIMULATED_ANNEALING")
public class SimulatedAnnealingAlgorithm extends RoutePlannerSupport implements MetaheuristicAlgorithm {
    private static final Logger log = LoggerFactory.getLogger(SimulatedAnnealingAlgorithm.class);
    private final Random random = new Random();
    private MetricaAlgoritmo ultimaMetrica;

    @Override
    public List<PlanDeViaje> planificarConEstado(
        List<Envio> envios,
        List<Vuelo> vuelos,
        List<Aeropuerto> aeropuertos,
        ParametrosSimulacion params,
        AirportTimeline timeline,
        Map<String, Integer> flightLoads
    ) {
        long start = System.currentTimeMillis();
        MutableCounter routeCounter = new MutableCounter();
        this.ultimaMetrica = null;

        try {
            Map<String, List<RouteCandidate>> pool = buildCandidatePool(envios, vuelos, aeropuertos, params, routeCounter);
            Map<String, Envio> envioById = envios.stream()
                .collect(HashMap::new, (m, e) -> m.put(e.getIdEnvio(), e), Map::putAll);

            Map<String, Integer> capacityCache = getAirportCapacityCache();
            int fallback = capacityCache.values().stream().mapToInt(v -> v).max().orElse(Integer.MAX_VALUE / 2);

            // Sort by SLA deadline ascending; tiebreak by origin capacity ascending
            // (smaller-capacity airports = more constrained, claim space before transit bags
            // from large airports that would only use them as a hub)
            List<Envio> sortedEnvios = new ArrayList<>(envios);
            sortedEnvios.sort(Comparator
                .comparing((Envio e) -> e.getFechaHoraIngreso().plusDays(e.getSla()))
                .thenComparingInt(e -> capacityCache.getOrDefault(e.getAeropuertoOrigen(), fallback)));

            // assignments: envioId → list of (route, qty) partial assignments
            final Map<String, List<PartialAssignment>> assignments = new HashMap<>();
            // timeline y flightLoads son parámetros — NO crear nuevos
            // ya contienen reservas de lotes anteriores
            List<String> optimizableEnvios = new ArrayList<>();

            // Native demand per airport: total bags in this batch that originate here.
            // Used to reserve capacity so transit bags don't crowd out origin bags.
            // Decremented as native bags are processed (routed or deferred).
            Map<String, Integer> nativeUnrouted = new HashMap<>();
            for (Envio e : sortedEnvios) {
                nativeUnrouted.merge(e.getAeropuertoOrigen(), e.getCantidadMaletas(), Integer::sum);
            }

            // ---- Seeding: greedy with split ----
            for (Envio envio : sortedEnvios) {
                List<RouteCandidate> options = pool.getOrDefault(envio.getIdEnvio(), List.of());
                if (options.isEmpty()) {
                    envio.setEstado(EstadoEnvio.RETRASADO);
                    log.warn("Envio {} has no feasible routes; marked RETRASADO", envio.getIdEnvio());
                    nativeUnrouted.merge(envio.getAeropuertoOrigen(), -envio.getCantidadMaletas(), Integer::sum);
                    continue;
                }

                int totalQty = envio.getCantidadMaletas();
                int remaining = totalQty;
                List<PartialAssignment> parts = new ArrayList<>();

                for (RouteCandidate route : options) {
                    if (remaining == 0) break;

                    // Flight capacity: how many can this route's flights still carry?
                    int fitsByFlight = remaining;
                    for (RouteCandidate.Leg leg : route.getLegs()) {
                        int legAvail = leg.flight().getCapacidadTotal()
                            - flightLoads.getOrDefault(flightDayKey(leg), 0);
                        fitsByFlight = Math.min(fitsByFlight, legAvail);
                    }
                    if (fitsByFlight <= 0) continue;

                    // Warehouse capacity: how many fit across all time windows?
                    // For transit hubs (airport ≠ this bag's origin), reserve space for
                    // native bags still waiting to be processed, so they always have room.
                    int fitsByWarehouse = fitsByFlight;
                    for (RouteCandidate.CapacityWindow w : route.getCapacityWindows(envio.getFechaHoraIngreso())) {
                        int hardCap = capacityCache.getOrDefault(w.airport(), fallback);
                        if (!w.airport().equals(envio.getAeropuertoOrigen())) {
                            int reserve = nativeUnrouted.getOrDefault(w.airport(), 0);
                            hardCap = Math.max(0, hardCap - reserve);
                        }
                        int fits = timeline.howManyFit(w.airport(), w.from(), w.to(), fitsByWarehouse, hardCap);
                        fitsByWarehouse = Math.min(fitsByWarehouse, fits);
                    }
                    if (fitsByWarehouse <= 0) continue;

                    int assign = Math.min(fitsByWarehouse, remaining);

                    // Register in timeline and flight loads
                    for (RouteCandidate.CapacityWindow w : route.getCapacityWindows(envio.getFechaHoraIngreso())) {
                        timeline.addEvent(w.airport(), w.from(), assign);
                        timeline.addEvent(w.airport(), w.to(), -assign);
                    }
                    for (RouteCandidate.Leg leg : route.getLegs()) {
                        flightLoads.merge(flightDayKey(leg), assign, Integer::sum);
                    }

                    parts.add(new PartialAssignment(route, assign));
                    remaining -= assign;
                }

                // Note: bags that don't fit here stay unassigned (remaining > 0) rather than
                // being force-fit by bypassing the warehouse hard-cap check. The primary loop
                // above already tried every candidate route under the true 100% hard cap; a
                // fallback that ignored warehouse capacity would risk exceeding it, violating
                // the "hard cap never exceeded" requirement. Unassigned bags surface as a
                // partial RETRASADO below.

                // This bag's origin slot is now "spent" — decrement native reserve so
                // later transit bags through this airport gain back the freed capacity.
                nativeUnrouted.merge(envio.getAeropuertoOrigen(), -envio.getCantidadMaletas(), Integer::sum);

                if (parts.isEmpty()) {
                    // ponytail: leave PENDIENTE — capacity may free up in next batch; avanzarDia() catches SLA expiry
                    log.warn("No feasible initial route for envio {} (capacity full) — deferred to next batch", envio.getIdEnvio());
                } else {
                    assignments.put(envio.getIdEnvio(), parts);
                    envio.setEstado(remaining > 0 ? EstadoEnvio.RETRASADO : EstadoEnvio.PLANIFICADO);
                    optimizableEnvios.add(envio.getIdEnvio());
                }
            }

            if (assignments.isEmpty()) {
                saveMetric(start, routeCounter.get());
                return List.of();
            }

            // ---- SA loop: operates on primary route per envío (whole-envío swaps) ----
            // Build a parallel Map<envioId, RouteCandidate> for the loop (primary route = first part)
            Map<String, RouteCandidate> current = new HashMap<>();
            assignments.forEach((id, parts) -> current.put(id, parts.get(0).route()));

            double currentCost = objectiveFromTimeline(timeline, assignments, envioById, params, capacityCache, fallback);
            double temperature = 1000.0d;
            final double coolingRate = 0.995d;
            final double minTemperature = 0.1d;
            final int maxIterations = Math.min(50000, 500 * Math.max(1, envios.size()));

            Map<String, List<PartialAssignment>> best = deepCopyAssignments(assignments);
            double bestCost = currentCost;

            for (int i = 0; i < maxIterations && temperature >= minTemperature; i++) {
                if (optimizableEnvios.isEmpty()) break;

                String envioId = optimizableEnvios.get(random.nextInt(optimizableEnvios.size()));
                List<RouteCandidate> options = pool.getOrDefault(envioId, List.of());
                if (options.isEmpty()) { temperature *= coolingRate; continue; }

                List<PartialAssignment> oldParts = assignments.get(envioId);
                RouteCandidate newRoute = options.get(random.nextInt(options.size()));
                routeCounter.increment(1);

                // Skip if same primary route
                if (!oldParts.isEmpty() && oldParts.get(0).route().getSignature().equals(newRoute.getSignature())) {
                    temperature *= coolingRate;
                    continue;
                }

                Envio envio = envioById.get(envioId);
                int totalQty = envio.getCantidadMaletas();

                // Remove old contributions from timeline
                for (PartialAssignment pa : oldParts) {
                    for (RouteCandidate.CapacityWindow w : pa.route().getCapacityWindows(envio.getFechaHoraIngreso())) {
                        timeline.removeEvent(w.airport(), w.from(), pa.qty());
                        timeline.removeEvent(w.airport(), w.to(), -pa.qty());
                    }
                    for (RouteCandidate.Leg leg : pa.route().getLegs()) {
                        flightLoads.merge(flightDayKey(leg), -pa.qty(), Integer::sum);
                    }
                }

                // Check if new single route can fit all bags
                int fitsFlight = totalQty;
                for (RouteCandidate.Leg leg : newRoute.getLegs()) {
                    int legAvail = leg.flight().getCapacidadTotal()
                        - flightLoads.getOrDefault(flightDayKey(leg), 0);
                    fitsFlight = Math.min(fitsFlight, legAvail);
                }

                int fitsWarehouse = fitsFlight;
                for (RouteCandidate.CapacityWindow w : newRoute.getCapacityWindows(envio.getFechaHoraIngreso())) {
                    int hardCap = capacityCache.getOrDefault(w.airport(), fallback);
                    fitsWarehouse = Math.min(fitsWarehouse, timeline.howManyFit(w.airport(), w.from(), w.to(), fitsWarehouse, hardCap));
                }

                // If new route can't fit all bags, restore old and skip
                if (fitsWarehouse < totalQty) {
                    for (PartialAssignment pa : oldParts) {
                        for (RouteCandidate.CapacityWindow w : pa.route().getCapacityWindows(envio.getFechaHoraIngreso())) {
                            timeline.addEvent(w.airport(), w.from(), pa.qty());
                            timeline.addEvent(w.airport(), w.to(), -pa.qty());
                        }
                        for (RouteCandidate.Leg leg : pa.route().getLegs()) {
                            flightLoads.merge(flightDayKey(leg), pa.qty(), Integer::sum);
                        }
                    }
                    temperature *= coolingRate;
                    continue;
                }

                // Evaluate cost delta
                Envio e = envioById.get(envioId);
                LocalDateTime deadline = e.getFechaHoraIngreso().plusDays(e.getSla());
                boolean oldViolates = oldParts.stream().anyMatch(pa ->
                    pa.route().getFinalArrival().plusMinutes(params.getMinutosRecogidaDestino()).isAfter(deadline));
                boolean newViolates = newRoute.getFinalArrival()
                    .plusMinutes(params.getMinutosRecogidaDestino()).isAfter(deadline);
                double slaDelta = (newViolates ? 1.0 : 0.0) - (oldViolates ? 1.0 : 0.0);

                // Collect only airports touched by this swap — delta for unaffected airports cancels out
                Set<String> swapAirports = new HashSet<>();
                for (PartialAssignment pa : oldParts) {
                    for (RouteCandidate.CapacityWindow w : pa.route().getCapacityWindows(e.getFechaHoraIngreso())) {
                        swapAirports.add(w.airport());
                    }
                }
                for (RouteCandidate.CapacityWindow w : newRoute.getCapacityWindows(e.getFechaHoraIngreso())) {
                    swapAirports.add(w.airport());
                }

                // Apply new route tentatively to compute overload delta
                for (RouteCandidate.CapacityWindow w : newRoute.getCapacityWindows(e.getFechaHoraIngreso())) {
                    timeline.addEvent(w.airport(), w.from(), totalQty);
                    timeline.addEvent(w.airport(), w.to(), -totalQty);
                }
                for (RouteCandidate.Leg leg : newRoute.getLegs()) {
                    flightLoads.merge(flightDayKey(leg), totalQty, Integer::sum);
                }

                double softFactor = params.getCapacidadBlandaFactor();
                double overloadAfter = swapAirports.stream()
                    .mapToDouble(ap -> {
                        double softCap = capacityCache.getOrDefault(ap, fallback) * softFactor;
                        return Math.max(0.0, timeline.globalPeak(ap) - softCap);
                    }).sum();

                // Temporarily remove new to compute overload without it
                for (RouteCandidate.CapacityWindow w : newRoute.getCapacityWindows(e.getFechaHoraIngreso())) {
                    timeline.removeEvent(w.airport(), w.from(), totalQty);
                    timeline.removeEvent(w.airport(), w.to(), -totalQty);
                }
                for (RouteCandidate.Leg leg : newRoute.getLegs()) {
                    flightLoads.merge(flightDayKey(leg), -totalQty, Integer::sum);
                }

                double overloadBefore = swapAirports.stream()
                    .mapToDouble(ap -> {
                        double softCap = capacityCache.getOrDefault(ap, fallback) * softFactor;
                        return Math.max(0.0, timeline.globalPeak(ap) - softCap);
                    }).sum();

                double neighborCost = currentCost + slaDelta + (overloadAfter - overloadBefore) * 10.0d;
                double delta = neighborCost - currentCost;
                boolean accept = delta < 0 || Math.exp(-delta / temperature) > random.nextDouble();

                if (accept) {
                    // Apply new route permanently
                    for (RouteCandidate.CapacityWindow w : newRoute.getCapacityWindows(e.getFechaHoraIngreso())) {
                        timeline.addEvent(w.airport(), w.from(), totalQty);
                        timeline.addEvent(w.airport(), w.to(), -totalQty);
                    }
                    for (RouteCandidate.Leg leg : newRoute.getLegs()) {
                        flightLoads.merge(flightDayKey(leg), totalQty, Integer::sum);
                    }
                    assignments.put(envioId, List.of(new PartialAssignment(newRoute, totalQty)));
                    current.put(envioId, newRoute);
                    currentCost = neighborCost;
                    if (neighborCost < bestCost) {
                        best = deepCopyAssignments(assignments);
                        bestCost = neighborCost;
                    }
                } else {
                    // Restore old
                    for (PartialAssignment pa : oldParts) {
                        for (RouteCandidate.CapacityWindow w : pa.route().getCapacityWindows(e.getFechaHoraIngreso())) {
                            timeline.addEvent(w.airport(), w.from(), pa.qty());
                            timeline.addEvent(w.airport(), w.to(), -pa.qty());
                        }
                        for (RouteCandidate.Leg leg : pa.route().getLegs()) {
                            flightLoads.merge(flightDayKey(leg), pa.qty(), Integer::sum);
                        }
                    }
                    assignments.put(envioId, oldParts);
                }

                temperature *= coolingRate;
            }

            // Sync shared timeline and flightLoads to match `best` (not the final
            // `assignments` state, which may have drifted after post-best accepted swaps).
            assignments.forEach((id, parts) -> {
                Envio envio = envioById.get(id);
                for (PartialAssignment pa : parts) {
                    for (RouteCandidate.CapacityWindow w : pa.route().getCapacityWindows(envio.getFechaHoraIngreso())) {
                        timeline.removeEvent(w.airport(), w.from(), pa.qty());
                        timeline.removeEvent(w.airport(), w.to(), -pa.qty());
                    }
                    for (RouteCandidate.Leg leg : pa.route().getLegs()) {
                        flightLoads.merge(flightDayKey(leg), -pa.qty(), Integer::sum);
                    }
                }
            });
            best.forEach((id, parts) -> {
                Envio envio = envioById.get(id);
                for (PartialAssignment pa : parts) {
                    for (RouteCandidate.CapacityWindow w : pa.route().getCapacityWindows(envio.getFechaHoraIngreso())) {
                        timeline.addEvent(w.airport(), w.from(), pa.qty());
                        timeline.addEvent(w.airport(), w.to(), -pa.qty());
                    }
                    for (RouteCandidate.Leg leg : pa.route().getLegs()) {
                        flightLoads.merge(flightDayKey(leg), pa.qty(), Integer::sum);
                    }
                }
            });

            saveMetric(start, routeCounter.get());
            return toPlans(best, envioById, params, getNombre());

        } catch (RuntimeException ex) {
            log.error("Simulated annealing failed; returning best known partial solution", ex);
            envios.stream()
                .filter(e -> e.getEstado() == EstadoEnvio.PLANIFICADO || e.getEstado() == EstadoEnvio.PENDIENTE)
                .forEach(e -> e.setEstado(EstadoEnvio.RETRASADO));
            saveMetric(start, routeCounter.get());
            return List.of();
        }
    }

    @Override
    public String getNombre() {
        return "SIMULATED_ANNEALING";
    }

    @Override
    public MetricaAlgoritmo getUltimaMetrica() {
        return ultimaMetrica;
    }

    // ponytail: flight code alone is date-agnostic; same flight runs daily with fresh capacity
    private String flightDayKey(RouteCandidate.Leg leg) {
        return leg.flight().getCodigoVuelo() + "|" + leg.departure().toLocalDate();
    }

    private Map<String, List<PartialAssignment>> deepCopyAssignments(Map<String, List<PartialAssignment>> src) {
        Map<String, List<PartialAssignment>> copy = new HashMap<>();
        src.forEach((k, v) -> copy.put(k, new ArrayList<>(v)));
        return copy;
    }

    private double objectiveFromTimeline(
        AirportTimeline timeline,
        Map<String, List<PartialAssignment>> assignments,
        Map<String, Envio> envioById,
        ParametrosSimulacion params,
        Map<String, Integer> capacityCache,
        int fallback
    ) {
        long slaViolations = assignments.entrySet().stream()
            .mapToLong(entry -> {
                Envio envio = envioById.get(entry.getKey());
                LocalDateTime deadline = envio.getFechaHoraIngreso().plusDays(envio.getSla());
                return entry.getValue().stream()
                    .filter(pa -> pa.route().getFinalArrival()
                        .plusMinutes(params.getMinutosRecogidaDestino()).isAfter(deadline))
                    .count();
            })
            .sum();

        double softFactor = params.getCapacidadBlandaFactor();
        double overload = timeline.affectedAirports().stream()
            .mapToDouble(ap -> {
                double softCap = capacityCache.getOrDefault(ap, fallback) * softFactor;
                return Math.max(0.0, timeline.globalPeak(ap) - softCap);
            })
            .sum();

        return slaViolations + (overload * 10.0d);
    }

    private List<PlanDeViaje> toPlans(
        Map<String, List<PartialAssignment>> assignments,
        Map<String, Envio> envioById,
        ParametrosSimulacion params,
        String algorithm
    ) {
        List<PlanDeViaje> plans = new ArrayList<>();
        assignments.entrySet().stream()
            .sorted(Map.Entry.comparingByKey())
            .forEach(entry -> {
                Envio envio = envioById.get(entry.getKey());
                List<PartialAssignment> parts = entry.getValue();
                for (int i = 0; i < parts.size(); i++) {
                    PartialAssignment pa = parts.get(i);
                    PlanDeViaje plan = pa.route().toPlan(envio, algorithm, i + 1, params);
                    plan.setCantidadMaletas(pa.qty());
                    plans.add(plan);
                }
            });
        return plans;
    }

    private void saveMetric(long start, int routesEvaluated) {
        this.ultimaMetrica = MetricaAlgoritmo.builder()
            .idMetrica("MET-" + System.nanoTime())
            .tiempoEjecucionMs(Math.max(1, System.currentTimeMillis() - start))
            .rutasEvaluadas(Math.max(0, routesEvaluated))
            .fechaEjecucion(LocalDateTime.now())
            .build();
    }
}
