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
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component("SIMULATED_ANNEALING")
public class SimulatedAnnealingAlgorithm extends RoutePlannerSupport implements MetaheuristicAlgorithm {
    private static final Logger log = LoggerFactory.getLogger(SimulatedAnnealingAlgorithm.class);
    private final Random random = new Random();
    private MetricaAlgoritmo ultimaMetrica;

    @Override
    public List<PlanDeViaje> planificar(
        List<Envio> envios,
        List<Vuelo> vuelos,
        List<Aeropuerto> aeropuertos,
        ParametrosSimulacion params
    ) {
        long start = System.currentTimeMillis();
        MutableCounter routeCounter = new MutableCounter();
        this.ultimaMetrica = null;

        try {
            Map<String, List<RouteCandidate>> pool = buildCandidatePool(envios, vuelos, aeropuertos, params, routeCounter);
            Map<String, Envio> envioById = envios.stream().collect(HashMap::new, (m, e) -> m.put(e.getIdEnvio(), e), Map::putAll);

            // ---- Seeding: incremental live-state feasibility (O(legs) per option) ----
            Map<String, Integer> capacityCache = getAirportCapacityCache();
            int fallback = capacityCache.values().stream().mapToInt(v -> v).max().orElse(Integer.MAX_VALUE / 2);

            final Map<String, RouteCandidate> current = new HashMap<>();
            Map<String, Integer> flightLoads = new HashMap<>();
            Map<String, Integer> warehouseLoads = new HashMap<>();
            List<String> optimizableEnvios = new ArrayList<>();

            for (Envio envio : envios) {
                List<RouteCandidate> options = pool.getOrDefault(envio.getIdEnvio(), List.of());
                if (options.isEmpty()) {
                    envio.setEstado(EstadoEnvio.RETRASADO);
                    log.warn("Envio {} has no feasible routes; marked RETRASADO", envio.getIdEnvio());
                    continue;
                }
                int qty = envio.getCantidadMaletas();

                RouteCandidate chosen = null;
                for (RouteCandidate option : options) {
                    boolean ok = true;
                    for (RouteCandidate.Leg leg : option.getLegs()) {
                        if (flightLoads.getOrDefault(leg.flight().getCodigoVuelo(), 0) + qty
                                > leg.flight().getCapacidadTotal()) {
                            ok = false; break;
                        }
                    }
                    if (!ok) continue;
                    for (String hub : option.getIntermediateAirports()) {
                        int hubCap = (int) Math.floor(capacityCache.getOrDefault(hub, fallback) * 0.9d);
                        if (warehouseLoads.getOrDefault(hub, 0) + qty > hubCap) {
                            ok = false; break;
                        }
                    }
                    if (ok) { chosen = option; break; }
                }

                if (chosen != null) {
                    current.put(envio.getIdEnvio(), chosen);
                    envio.setEstado(EstadoEnvio.PLANIFICADO);
                    optimizableEnvios.add(envio.getIdEnvio());
                    for (RouteCandidate.Leg leg : chosen.getLegs()) {
                        flightLoads.merge(leg.flight().getCodigoVuelo(), qty, Integer::sum);
                    }
                    for (String hub : chosen.getIntermediateAirports()) {
                        warehouseLoads.merge(hub, qty, Integer::sum);
                    }
                } else {
                    envio.setEstado(EstadoEnvio.RETRASADO);
                    log.warn("No feasible initial route for envio {}", envio.getIdEnvio());
                }
            }

            if (current.isEmpty()) {
                saveMetric(start, routeCounter.get());
                return List.of();
            }

            double currentCost = objective(current, envioById, params);

            // ---- SA loop with O(legs) delta evaluation ----
            double temperature = 1000.0d;
            final double coolingRate = 0.995d;
            final double minTemperature = 0.1d;
            final int maxIterations = Math.min(50000, 500 * Math.max(1, envios.size()));

            Map<String, RouteCandidate> best = new HashMap<>(current);
            double bestCost = currentCost;

            for (int i = 0; i < maxIterations && temperature >= minTemperature; i++) {
                if (optimizableEnvios.isEmpty()) break;

                String envioId = optimizableEnvios.get(random.nextInt(optimizableEnvios.size()));
                List<RouteCandidate> options = pool.getOrDefault(envioId, List.of());
                if (options.isEmpty()) { temperature *= coolingRate; continue; }

                RouteCandidate oldRoute = current.get(envioId);
                RouteCandidate newRoute = options.get(random.nextInt(options.size()));
                routeCounter.increment(1);

                if (oldRoute != null && oldRoute.getSignature().equals(newRoute.getSignature())) {
                    temperature *= coolingRate;
                    continue;
                }

                int qty = envioById.get(envioId).getCantidadMaletas();

                // --- Feasibility check: O(legs) instead of O(n) ---
                Set<String> oldFlightCodes = oldRoute == null ? Set.of()
                    : oldRoute.getLegs().stream()
                        .map(l -> l.flight().getCodigoVuelo())
                        .collect(Collectors.toSet());
                Set<String> oldHubs = oldRoute == null ? Set.of()
                    : new HashSet<>(oldRoute.getIntermediateAirports());

                boolean feasible = true;
                for (RouteCandidate.Leg leg : newRoute.getLegs()) {
                    // Flights shared with old route have no net load change
                    if (oldFlightCodes.contains(leg.flight().getCodigoVuelo())) continue;
                    if (flightLoads.getOrDefault(leg.flight().getCodigoVuelo(), 0) + qty
                            > leg.flight().getCapacidadTotal()) {
                        feasible = false;
                        break;
                    }
                }
                if (!feasible) { temperature *= coolingRate; continue; }

                for (String hub : newRoute.getIntermediateAirports()) {
                    if (oldHubs.contains(hub)) continue;
                    int hubCap = (int) Math.floor(capacityCache.getOrDefault(hub, fallback) * 0.9d);
                    if (warehouseLoads.getOrDefault(hub, 0) + qty > hubCap) {
                        feasible = false;
                        break;
                    }
                }
                if (!feasible) { temperature *= coolingRate; continue; }

                // --- Cost delta: O(hubs) instead of O(n) ---
                Envio envio = envioById.get(envioId);
                LocalDateTime deadline = envio.getFechaHoraIngreso().plusDays(envio.getSla());
                boolean oldViolates = oldRoute != null
                    && oldRoute.getFinalArrival().plusMinutes(params.getMinutosRecogidaDestino()).isAfter(deadline);
                boolean newViolates = newRoute.getFinalArrival().plusMinutes(params.getMinutosRecogidaDestino()).isAfter(deadline);
                double slaDelta = (newViolates ? 1.0 : 0.0) - (oldViolates ? 1.0 : 0.0);

                // Net load change per hub (handles hubs shared between old and new)
                Map<String, Integer> hubChanges = new HashMap<>();
                if (oldRoute != null) {
                    for (String hub : oldRoute.getIntermediateAirports()) {
                        hubChanges.merge(hub, -qty, Integer::sum);
                    }
                }
                for (String hub : newRoute.getIntermediateAirports()) {
                    hubChanges.merge(hub, qty, Integer::sum);
                }

                double overloadDelta = 0.0;
                for (Map.Entry<String, Integer> change : hubChanges.entrySet()) {
                    if (change.getValue() == 0) continue;
                    String hub = change.getKey();
                    double cap = capacityCache.getOrDefault(hub, fallback) * 0.9d;
                    int currentLoad = warehouseLoads.getOrDefault(hub, 0);
                    overloadDelta += Math.max(0, currentLoad + change.getValue() - cap)
                                   - Math.max(0, currentLoad - cap);
                }

                double neighborCost = currentCost + slaDelta + overloadDelta * 10.0d;
                double delta = neighborCost - currentCost;

                boolean accept = delta < 0 || Math.exp(-delta / temperature) > random.nextDouble();
                if (accept) {
                    current.put(envioId, newRoute);

                    // Update live flight loads
                    if (oldRoute != null) {
                        for (RouteCandidate.Leg leg : oldRoute.getLegs()) {
                            flightLoads.merge(leg.flight().getCodigoVuelo(), -qty, Integer::sum);
                        }
                    }
                    for (RouteCandidate.Leg leg : newRoute.getLegs()) {
                        flightLoads.merge(leg.flight().getCodigoVuelo(), qty, Integer::sum);
                    }

                    // Update live warehouse loads
                    for (Map.Entry<String, Integer> change : hubChanges.entrySet()) {
                        if (change.getValue() != 0) {
                            warehouseLoads.merge(change.getKey(), change.getValue(), Integer::sum);
                        }
                    }

                    currentCost = neighborCost;
                    if (neighborCost < bestCost) {
                        best = new HashMap<>(current);
                        bestCost = neighborCost;
                    }
                }
                temperature *= coolingRate;
            }

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

    private List<PlanDeViaje> toPlans(
        Map<String, RouteCandidate> selectedRoutes,
        Map<String, Envio> envioById,
        ParametrosSimulacion params,
        String algorithm
    ) {
        return selectedRoutes.entrySet().stream()
            .sorted(Map.Entry.comparingByKey())
            .map(entry -> entry.getValue().toPlan(envioById.get(entry.getKey()), algorithm, 1, params))
            .toList();
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
