package com.tasf.backend.simulation;

import com.tasf.backend.domain.Aeropuerto;
import com.tasf.backend.domain.ColapsoPunto;
import com.tasf.backend.domain.Cancelacion;
import com.tasf.backend.domain.Escala;
import com.tasf.backend.domain.Envio;
import com.tasf.backend.domain.EstadoEnvio;
import com.tasf.backend.domain.EstadoMaleta;
import com.tasf.backend.domain.Maleta;
import com.tasf.backend.domain.MetricaAlgoritmo;
import com.tasf.backend.domain.ParametrosSimulacion;
import com.tasf.backend.domain.PlanDeViaje;
import com.tasf.backend.domain.PlanningResult;
import com.tasf.backend.domain.Vuelo;
import com.tasf.backend.dto.AeropuertoDTO;
import com.tasf.backend.dto.CancelacionDTO;
import com.tasf.backend.dto.EnvioDTO;
import com.tasf.backend.dto.KpisDTO;
import com.tasf.backend.dto.SimulationStateDTO;
import com.tasf.backend.dto.ThroughputDiaDTO;
import com.tasf.backend.dto.VueloDTO;
import com.tasf.backend.service.DataLoaderService;
import com.tasf.backend.service.PlanningService;
import com.tasf.backend.service.SimulationPersistenceService;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Random;
import java.util.Set;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class SimulationEngine {
    private static final Logger log = LoggerFactory.getLogger(SimulationEngine.class);
    private static final DateTimeFormatter TS_FORMAT = DateTimeFormatter.ISO_LOCAL_DATE_TIME;
    private static final int MAX_LOG_ENTRIES = 100;

    private final DataLoaderService dataLoaderService;
    private final PlanningService planningService;
    private final SimulationPersistenceService persistenceService;
    private final Random random = new Random();

    private ParametrosSimulacion params;
    private List<Aeropuerto> aeropuertos = new ArrayList<>();
    private List<Vuelo> vuelos = new ArrayList<>();
    private List<Envio> envios = new ArrayList<>();
    private List<Maleta> maletas = new ArrayList<>();
    private List<PlanDeViaje> planes = new ArrayList<>();
    private List<Cancelacion> cancelaciones = new ArrayList<>();
    private List<MetricaAlgoritmo> metricas = new ArrayList<>();
    private int diaActual;
    private LocalDateTime fechaSimulada;
    private boolean enEjecucion;
    private boolean finalizada;
    private List<String> logOperaciones = new ArrayList<>();

    private ColapsoPunto colapsoPunto = null;

    private final Deque<String> logBuffer = new ArrayDeque<>();
    private final Map<String, String> maletaVueloActual = new HashMap<>();
    private final List<ThroughputDiaDTO> throughputHistorial = new ArrayList<>();

    public SimulationEngine(DataLoaderService dataLoaderService, PlanningService planningService, SimulationPersistenceService persistenceService) {
        this.dataLoaderService = dataLoaderService;
        this.planningService = planningService;
        this.persistenceService = persistenceService;
    }

    public synchronized void inicializar(ParametrosSimulacion params, List<Envio> todosLosEnvios) {
        reset();
        this.params = params;
        this.aeropuertos = deepCopyAeropuertos(dataLoaderService.getAeropuertos());
        this.vuelos = deepCopyVuelos(dataLoaderService.getVuelos());

        // Resolve the number of days requested by the user
        int filterDias = resolveDias(params);

        // Apply date-window filter: fecha >= fechaInicio AND fecha < fechaInicio + dias
        // When esColapso=true there is no upper bound
        LocalDate fechaInicio = params.getFechaInicio();
        boolean esColapso = Boolean.TRUE.equals(params.getEsColapso());

        List<Envio> filteredEnvios;
        if (esColapso) {
            filteredEnvios = todosLosEnvios.stream()
                .filter(e -> !e.getFechaHoraIngreso().toLocalDate().isBefore(fechaInicio))
                .collect(Collectors.toCollection(ArrayList::new));
        } else {
            LocalDate dateEnd = fechaInicio.plusDays(filterDias);
            filteredEnvios = todosLosEnvios.stream()
                .filter(e -> {
                    LocalDate d = e.getFechaHoraIngreso().toLocalDate();
                    return !d.isBefore(fechaInicio) && d.isBefore(dateEnd);
                })
                .collect(Collectors.toCollection(ArrayList::new));
        }

        // Compute diasSimulacion: honour pre-set value (e.g. from tests), otherwise derive it
        int diasSimulacion;
        if (params.getDiasSimulacion() > 0) {
            diasSimulacion = params.getDiasSimulacion();
        } else if (esColapso) {
            diasSimulacion = computeDiasColapso(fechaInicio, filteredEnvios);
        } else {
            diasSimulacion = filterDias;
        }
        params.setDias(filterDias);
        params.setDiasSimulacion(diasSimulacion);

        this.envios = deepCopyEnvios(filteredEnvios);
        this.maletas = generarMaletas(this.envios);
        this.planes = new ArrayList<>();
        this.cancelaciones = new ArrayList<>();
        this.metricas = new ArrayList<>();
        this.fechaSimulada = params.getFechaInicio().atTime(parseHoraInicio(params.getHoraInicio()));

        this.envios.forEach(envio -> envio.setEstado(EstadoEnvio.PLANIFICADO));
        this.maletas.forEach(maleta -> {
            maleta.setEstado(EstadoMaleta.EN_ALMACEN);
        });

        PlanningResult planning = planningService.planificar(this.envios, this.vuelos, this.aeropuertos, this.params);
        this.planes = new ArrayList<>(planning.getPlanes());
        if (planning.getMetrica() != null) {
            this.metricas.add(planning.getMetrica());
        }

        Set<String> sinRuta = new HashSet<>(planning.getEnviosSinRuta());
        this.envios.stream()
            .filter(envio -> sinRuta.contains(envio.getIdEnvio()))
            .forEach(envio -> envio.setEstado(EstadoEnvio.RETRASADO));

        this.diaActual = 1;
        this.enEjecucion = true;
        this.finalizada = false;
        updateWarehouseOccupation();
        aeropuertos.forEach(a -> a.setOcupacionInicioDia(a.getOcupacionActual()));

        String algoritmoInicial = params.getAlgoritmo() != null ? params.getAlgoritmo() : "N/A";
        addOperationLog("Simulation initialized - Day 1 - " + this.envios.size()
            + " envios - algorithm: " + algoritmoInicial
            + " - routes evaluated: " + Optional.ofNullable(planning.getMetrica()).map(MetricaAlgoritmo::getRutasEvaluadas).orElse(0));
    }

    public synchronized SimulationStateDTO avanzarDia() {
        if (!enEjecucion || params == null) {
            return getEstado();
        }

        addOperationLog("Processing day " + diaActual);

        // Vuelos have only LocalTime (daily repeating schedule). Cancellations from a
        // previous simulated day must be reset so that the same flight can operate again.
        vuelos.forEach(v -> v.setCancelado(false));

        // Snapshot warehouse state at the START of the day — before any departures or
        // deliveries — so that [OCUPACION] logs capture origin warehouses (e.g. OJAI)
        // while bags are still present. The end-of-day call below reflects the
        // post-delivery state and updates the domain field used by the API.
        updateWarehouseOccupation();
        accumulateOccupationSample();
        aeropuertos.forEach(a -> a.setOcupacionInicioDia(a.getOcupacionActual()));

        // Build lookup maps once per day — shared across all passes and processDeliveries.
        Map<String, Envio> envioById = envios.stream().collect(Collectors.toMap(Envio::getIdEnvio, e -> e, (a, b) -> a));
        Map<String, Vuelo> vueloByCode = vuelos.stream().collect(Collectors.toMap(Vuelo::getCodigoVuelo, v -> v, (a, b) -> a));
        Map<String, Aeropuerto> airportByCode = aeropuertos.stream().collect(Collectors.toMap(Aeropuerto::getCodigoIATA, a -> a, (a, b) -> a));
        Map<String, List<Maleta>> maletasByEnvio = maletas.stream().collect(Collectors.groupingBy(Maleta::getIdEnvio));

        // Run up to 3 passes so that same-day connections work correctly.
        // On pass 1: leg-1 bags depart and arrive at the intermediate hub.
        // On pass 2: leg-2 bags depart from the hub (now EN_ALMACEN) and arrive at destination.
        // The existing state machine (EN_ALMACEN→EN_VUELO→EN_ALMACEN) prevents double-processing.
        for (int pass = 0; pass < 3; pass++) {
            processDepartures(envioById, vueloByCode, airportByCode, maletasByEnvio);
            processArrivals(vueloByCode, airportByCode, maletasByEnvio);
        }
        DeliveryStats deliveryStats = processDeliveries(envioById, airportByCode, maletasByEnvio);
        checkSlaViolations();

        if (Boolean.TRUE.equals(params.getEsColapso()) && colapsoPunto == null) {
            long retrasados = envios.stream()
                .filter(e -> e.getEstado() == EstadoEnvio.RETRASADO).count();
            if (!envios.isEmpty()) {
                double pct = retrasados * 100.0 / envios.size();
                if (pct >= params.getUmbralColapsoPorcentajeSlaVencido()) {
                    String aerMasCritico = aeropuertos.stream()
                        .filter(a -> a.getCapacidadAlmacen() > 0)
                        .max(Comparator.comparingDouble(a ->
                            (double) a.getOcupacionActual() / a.getCapacidadAlmacen()))
                        .map(Aeropuerto::getCodigoIATA)
                        .orElse("N/A");
                    List<String> topAps = aeropuertos.stream()
                        .filter(a -> a.getCapacidadAlmacen() > 0)
                        .sorted(Comparator.comparingDouble((Aeropuerto a) ->
                            (double) a.getOcupacionActual() / a.getCapacidadAlmacen()).reversed())
                        .limit(5)
                        .map(Aeropuerto::getCodigoIATA)
                        .collect(Collectors.toList());
                    colapsoPunto = ColapsoPunto.builder()
                        .dia(diaActual)
                        .pctSlaVencido(Math.round(pct * 10.0) / 10.0)
                        .aeropuertoMasCritico(aerMasCritico)
                        .topAeropuertos(topAps)
                        .build();
                    addOperationLog(String.format(
                        "[COLAPSO] Operación colapsó en Día %d — SLA vencido: %.1f%%", diaActual, pct));
                }
            }
        }

        throughputHistorial.add(ThroughputDiaDTO.builder()
            .dia(diaActual)
            .maletasProcesadas(deliveryStats.delivered)
            .slaOk(deliveryStats.slaOk)
            .slaBreach(deliveryStats.slaBreach)
            .build());

        if (params.getPorcentajeCancelacionAleatoria() > 0) {
            cancelRandomFlightsAndReplan();
        }

        if (diaActual >= params.getDiasSimulacion()) {
            updateWarehouseOccupation();
            this.finalizada = true;
            this.enEjecucion = false;
            applySimulationEnd(params.getFechaInicio().plusDays(params.getDiasSimulacion() - 1));
            addOperationLog("Simulation completed - Day " + diaActual);
            persistenceService.persistSimulationResults(
                List.copyOf(planes),
                List.copyOf(metricas),
                List.copyOf(logOperaciones),
                List.copyOf(envios)
            );
            return getEstado();
        }

        // Advance AFTER processing current day so day-1 departures are not skipped
        diaActual++;
        this.fechaSimulada = this.fechaSimulada.plusDays(1);
        // Recompute warehouse occupation AFTER date advance so that bags of the
        // upcoming day (fechaIngreso == new today) become visible during the
        // polling window before the next avanzarDia() runs.
        updateWarehouseOccupation();

        return getEstado();
    }

    public synchronized SimulationStateDTO reiniciar() {
        if (params == null) {
            return getEstado();
        }
        // Reset aeropuertos and vuelos to clean state (clears accumulated stats/loads)
        this.aeropuertos = deepCopyAeropuertos(dataLoaderService.getAeropuertos());
        this.vuelos = deepCopyVuelos(dataLoaderService.getVuelos());

        // Reset envio states to PLANIFICADO
        this.envios.forEach(e -> e.setEstado(EstadoEnvio.PLANIFICADO));

        // Rebuild maletas from envios (resets ubicacion to origin and estado to EN_ALMACEN)
        this.maletas = generarMaletas(this.envios);

        // planes unchanged — reuse existing routes, no re-planning needed

        // Reset runtime tracking
        this.metricas = new ArrayList<>();
        this.cancelaciones = new ArrayList<>();
        this.maletaVueloActual.clear();
        this.logBuffer.clear();
        this.logOperaciones = new ArrayList<>();
        this.throughputHistorial.clear();

        // Reset simulation clock
        this.diaActual = 1;
        this.fechaSimulada = params.getFechaInicio().atTime(parseHoraInicio(params.getHoraInicio()));
        this.enEjecucion = true;
        this.finalizada = false;

        updateWarehouseOccupation();
        aeropuertos.forEach(a -> a.setOcupacionInicioDia(a.getOcupacionActual()));
        addOperationLog("Simulation restarted - Day 1 - reusing previous plans");
        return getEstado();
    }

    public synchronized SimulationStateDTO detener() {
        if (params == null || finalizada) {
            return getEstado();
        }
        this.enEjecucion = false;
        this.finalizada = true;
        applySimulationEnd(fechaSimulada.toLocalDate());
        addOperationLog("Simulation stopped manually - Day " + diaActual);
        persistenceService.persistSimulationResults(
            List.copyOf(planes),
            List.copyOf(metricas),
            List.copyOf(logOperaciones),
            List.copyOf(envios)
        );
        return getEstado();
    }

    private void applySimulationEnd(LocalDate simulationEndDate) {
        Map<String, PlanDeViaje> latestPlans = buildLatestPlanByEnvio();

        envios.stream()
            .filter(e -> e.getEstado() != EstadoEnvio.ENTREGADO && e.getEstado() != EstadoEnvio.RETRASADO)
            .filter(e -> !isCrossWindow(e, simulationEndDate, latestPlans))
            .forEach(e -> {
                LocalDate deadline = e.getFechaHoraIngreso().plusDays(e.getSla()).toLocalDate();
                if (!deadline.isAfter(simulationEndDate)) {
                    e.setEstado(EstadoEnvio.RETRASADO);
                }
            });

        maletas.stream()
            .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN || m.getEstado() == EstadoMaleta.EN_VUELO)
            .forEach(m -> m.setEstado(EstadoMaleta.RETRASADA));

        long auditEvaluable = envios.stream()
            .filter(e -> !e.getFechaHoraIngreso().toLocalDate().plusDays(e.getSla()).isAfter(simulationEndDate))
            .count();
        long auditEntregado = envios.stream()
            .filter(e -> e.getEstado() == EstadoEnvio.ENTREGADO)
            .filter(e -> !e.getFechaHoraIngreso().toLocalDate().plusDays(e.getSla()).isAfter(simulationEndDate))
            .count();
        long auditRetrasado = envios.stream()
            .filter(e -> e.getEstado() == EstadoEnvio.RETRASADO)
            .filter(e -> !e.getFechaHoraIngreso().toLocalDate().plusDays(e.getSla()).isAfter(simulationEndDate))
            .count();
        long auditInProgress = envios.stream()
            .filter(e -> e.getEstado() != EstadoEnvio.ENTREGADO && e.getEstado() != EstadoEnvio.RETRASADO)
            .filter(e -> !e.getFechaHoraIngreso().toLocalDate().plusDays(e.getSla()).isAfter(simulationEndDate))
            .count();
        double auditSla = auditEvaluable == 0 ? 0.0
            : Math.round(auditEntregado * 1000.0 / auditEvaluable) / 10.0;
        log.info("[SLA AUDIT] simulationEndDate={} Evaluable={} ENTREGADO={} RETRASADO={} IN_PROGRESS={} SLA={}%",
            simulationEndDate, auditEvaluable, auditEntregado, auditRetrasado, auditInProgress, auditSla);
        addOperationLog(String.format(
            "[SLA AUDIT] period=%d ENTREGADO=%d RETRASADO=%d IN_PROGRESS=%d SLA=%.1f%%",
            auditEvaluable, auditEntregado, auditRetrasado, auditInProgress, auditSla));
    }

    public synchronized void replanificar(List<Maleta> affectedMaletas) {
        replanificarConStats(affectedMaletas, false);
    }

    private synchronized int replanificarConStats(List<Maleta> affectedMaletas, boolean porIncidencia) {
        long start = System.currentTimeMillis();
        if (affectedMaletas == null || affectedMaletas.isEmpty()) {
            return 0;
        }

        Set<String> envioIds = affectedMaletas.stream().map(Maleta::getIdEnvio).collect(Collectors.toSet());
        List<Envio> afectados = envios.stream()
            .filter(envio -> envioIds.contains(envio.getIdEnvio()))
            .peek(envio -> envio.setEstado(EstadoEnvio.PLANIFICADO))
            .toList();

        if (afectados.isEmpty()) {
            return 0;
        }

        // For incidence replanning, route from the bags' current location rather than
        // the original origin airport — bags may already be partway through their journey.
        List<Envio> enviosParaPlanificar;
        if (porIncidencia) {
            Map<String, String> currentLocByEnvio = maletas.stream()
                .filter(m -> envioIds.contains(m.getIdEnvio()))
                .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN || m.getEstado() == EstadoMaleta.RETRASADA)
                .collect(Collectors.toMap(Maleta::getIdEnvio, Maleta::getUbicacionActual, (a, b) -> a));

            enviosParaPlanificar = new ArrayList<>();
            for (Envio envio : afectados) {
                String currentLoc = currentLocByEnvio.get(envio.getIdEnvio());
                if (currentLoc == null) {
                    continue; // no active bags to replan for this envio
                }
                if (currentLoc.equals(envio.getAeropuertoDestino())) {
                    // Bags already at destination — mark delivered and skip replanning
                    envio.setEstado(EstadoEnvio.ENTREGADO);
                    maletas.stream()
                        .filter(m -> m.getIdEnvio().equals(envio.getIdEnvio()) && m.getEstado() == EstadoMaleta.EN_ALMACEN)
                        .forEach(m -> m.setEstado(EstadoMaleta.ENTREGADA));
                    continue;
                }
                enviosParaPlanificar.add(Envio.builder()
                    .idEnvio(envio.getIdEnvio())
                    .codigoAerolinea(envio.getCodigoAerolinea())
                    .aeropuertoOrigen(currentLoc)
                    .aeropuertoDestino(envio.getAeropuertoDestino())
                    .fechaHoraIngreso(envio.getFechaHoraIngreso())
                    .cantidadMaletas(envio.getCantidadMaletas())
                    .sla(envio.getSla())
                    .estado(EstadoEnvio.PLANIFICADO)
                    .build());
            }
            if (enviosParaPlanificar.isEmpty()) {
                return 0;
            }
        } else {
            enviosParaPlanificar = afectados;
        }

        PlanningResult result = porIncidencia
            ? planningService.planificarConIncidencia(enviosParaPlanificar, vuelos, aeropuertos, params)
            : planningService.planificar(enviosParaPlanificar, vuelos, aeropuertos, params);
        if (result.getMetrica() != null) {
            metricas.add(result.getMetrica());
        }

        Set<String> affectedIds = afectados.stream().map(Envio::getIdEnvio).collect(Collectors.toSet());
        planes = planes.stream().filter(plan -> !affectedIds.contains(plan.getIdEnvio())).collect(Collectors.toCollection(ArrayList::new));
        planes.addAll(result.getPlanes());

        Set<String> sinRuta = new HashSet<>(result.getEnviosSinRuta());
        for (Envio envio : afectados) {
            if (sinRuta.contains(envio.getIdEnvio())) {
                envio.setEstado(EstadoEnvio.RETRASADO);
                addOperationLog("ALERT replanification no route for envio " + envio.getIdEnvio());
            }
        }

        long elapsed = System.currentTimeMillis() - start;
        String algorithmUsed = params.getAlgoritmo() != null ? params.getAlgoritmo() : "N/A";
        if (sinRuta.isEmpty()) {
            addOperationLog(String.format("[LOG] Replanificación exitosa (%s) en %d ms.", algorithmUsed, elapsed));
        } else {
            addOperationLog(String.format("[ALERTA] Replanificación parcial (%s). %d envíos se quedaron sin ruta viable.", 
                algorithmUsed, sinRuta.size()));
        }

        if (elapsed > 10_000) {
            addOperationLog("[ADVERTENCIA] La replanificación excedió los 10 segundos (RF 33): " + elapsed + " ms");
        }
        return sinRuta.size();
    }

    public synchronized void agregarNuevosEnvios(List<Envio> nuevosEnvios) {
        if (!enEjecucion || params == null) {
            log.warn("Cannot add envios: simulation is not running.");
            return;
        }
        
        // Filtrar los que estén dentro del rango de la simulación actual
        LocalDate fechaInicio = params.getFechaInicio();
        LocalDate fechaFinSim = fechaInicio.plusDays(params.getDiasSimulacion());
        
        List<Envio> validos = nuevosEnvios.stream()
            .filter(e -> {
                LocalDate d = e.getFechaHoraIngreso().toLocalDate();
                return !d.isBefore(fechaInicio) && !d.isAfter(fechaFinSim);
            })
            .toList();
            
        if (validos.isEmpty()) {
            log.info("No new envios fit in the current simulation time window.");
            return;
        }

        List<Envio> copias = deepCopyEnvios(validos);
        this.envios.addAll(copias);
        
        List<Maleta> nuevasMaletas = generarMaletas(copias);
        this.maletas.addAll(nuevasMaletas);
        
        copias.forEach(e -> e.setEstado(EstadoEnvio.PLANIFICADO));
        nuevasMaletas.forEach(m -> m.setEstado(EstadoMaleta.EN_ALMACEN));
        
        addOperationLog("[LOG] Cargados " + validos.size() + " nuevos envíos vía upload. Iniciando replanificación...");
        
        replanificar(nuevasMaletas);
        updateWarehouseOccupation();
    }

    public synchronized SimulationStateDTO getEstado() {

        if (params == null) {
            return SimulationStateDTO.builder()
                .diaActual(0)
                .totalDias(0)
                .fechaSimulada(null)
                .algoritmo(null)
                .metrica(null)
                .enEjecucion(false)
                .finalizada(false)
                .aeropuertos(List.of())
                .vuelos(List.of())
                .envios(List.of())
                .kpis(KpisDTO.builder()
                    .maletasEnTransito(0)
                    .maletasEntregadas(0)
                    .cumplimientoSLA(0.0)
                    .vuelosActivos(0)
                    .slaVencidos(0)
                    .ocupacionPromedioAlmacen(0.0)
                    .build())
                .throughputHistorial(List.of())
                .logOperaciones(List.of())
                .colapsoPunto(null)
                .cancelaciones(List.of())
                .build();
        }

        // OPTIMIZATION: Indexing for state preparation
        Map<String, List<PlanDeViaje>> plansByFlight = new HashMap<>();
        Map<String, PlanDeViaje> latestPlanByEnvio = new HashMap<>();
        for (PlanDeViaje p : planes) {
            PlanDeViaje current = latestPlanByEnvio.get(p.getIdEnvio());
            if (current == null || p.getVersion() > current.getVersion()) {
                latestPlanByEnvio.put(p.getIdEnvio(), p);
            }
            for (var esc : p.getEscalas()) {
                plansByFlight.computeIfAbsent(esc.getCodigoVuelo(), k -> new ArrayList<>()).add(p);
            }
        }
        Map<String, Envio> envioById = envios.stream().collect(Collectors.toMap(Envio::getIdEnvio, e -> e, (a, b) -> a));

        Map<String, Long> maletasPorAlmacen = maletas.stream()
            .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN && m.getUbicacionActual() != null)
            .collect(Collectors.groupingBy(Maleta::getUbicacionActual, Collectors.counting()));

        Map<String, String> vueloADestino = vuelos.stream()
            .filter(v -> v.getDestino() != null)
            .collect(Collectors.toMap(Vuelo::getCodigoVuelo, Vuelo::getDestino, (a, b) -> a));

        Map<String, Long> maletasPorDestino = maletas.stream()
            .filter(m -> m.getEstado() == EstadoMaleta.EN_VUELO)
            .filter(m -> maletaVueloActual.containsKey(m.getIdMaleta()))
            .collect(Collectors.groupingBy(
                m -> vueloADestino.getOrDefault(maletaVueloActual.get(m.getIdMaleta()), ""),
                Collectors.counting()
            ));

        return SimulationStateDTO.builder()
            .diaActual(diaActual)
            .totalDias(params.getDiasSimulacion())
            .fechaSimulada(fechaSimulada.format(TS_FORMAT))
            .algoritmo(params.getAlgoritmo())
            .metrica(metricas.isEmpty() ? null : metricas.get(metricas.size() - 1))
            .enEjecucion(enEjecucion)
            .finalizada(finalizada)
            .aeropuertos(aeropuertos.stream().map(a -> toAeropuertoDto(a, maletasPorAlmacen, maletasPorDestino)).toList())
            .vuelos(vuelos.stream().map(v -> toVueloDto(v, plansByFlight, envioById)).toList())
            .envios(envios.stream().map(e -> toEnvioDto(e, false, latestPlanByEnvio.get(e.getIdEnvio()))).toList())
            .kpis(buildKpis())
            .throughputHistorial(List.copyOf(throughputHistorial))
            .logOperaciones(List.copyOf(logOperaciones))
            .colapsoPunto(colapsoPunto)
            .cancelaciones(cancelaciones.stream()
                .map(c -> CancelacionDTO.builder()
                    .id(c.getId())
                    .codigoVuelo(c.getCodigoVuelo())
                    .fecha(c.getFecha() != null ? c.getFecha().toString() : null)
                    .hora(c.getHora() != null ? c.getHora().toString() : null)
                    .motivo(c.getMotivo())
                    .maletasAfectadas(c.getMaletasAfectadas())
                    .enviosSinRuta(c.getEnviosSinRuta())
                    .resultado(c.getResultado())
                    .build())
                .toList())
            .build();
    }

    public synchronized void reset() {
        this.params = null;
        this.aeropuertos = new ArrayList<>();
        this.vuelos = new ArrayList<>();
        this.envios = new ArrayList<>();
        this.maletas = new ArrayList<>();
        this.planes = new ArrayList<>();
        this.cancelaciones = new ArrayList<>();
        this.metricas = new ArrayList<>();
        this.diaActual = 0;
        this.fechaSimulada = null;
        this.enEjecucion = false;
        this.finalizada = false;
        this.logOperaciones = new ArrayList<>();
        this.logBuffer.clear();
        this.maletaVueloActual.clear();
        this.throughputHistorial.clear();
        this.colapsoPunto = null;
    }

    public synchronized boolean estaInicializada() {
        return params != null;
    }

    public synchronized ParametrosSimulacion getParams() {
        return params;
    }

    public synchronized List<AeropuertoDTO> getAeropuertosEstado() {
        if (params == null) {
            return dataLoaderService.getAeropuertos().stream()
                .map(a -> toAeropuertoDto(a, Map.of(), Map.of())).toList();
        }
        Map<String, Long> maletasPorAlmacen = maletas.stream()
            .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN && m.getUbicacionActual() != null)
            .collect(Collectors.groupingBy(Maleta::getUbicacionActual, Collectors.counting()));
        Map<String, String> vueloADestino = vuelos.stream()
            .filter(v -> v.getDestino() != null)
            .collect(Collectors.toMap(Vuelo::getCodigoVuelo, Vuelo::getDestino, (a, b) -> a));
        Map<String, Long> maletasPorDestino = maletas.stream()
            .filter(m -> m.getEstado() == EstadoMaleta.EN_VUELO)
            .filter(m -> maletaVueloActual.containsKey(m.getIdMaleta()))
            .collect(Collectors.groupingBy(
                m -> vueloADestino.getOrDefault(maletaVueloActual.get(m.getIdMaleta()), ""),
                Collectors.counting()
            ));
        return aeropuertos.stream().map(a -> toAeropuertoDto(a, maletasPorAlmacen, maletasPorDestino)).toList();
    }

    public synchronized List<VueloDTO> getVuelosEstado() {
        Map<String, List<PlanDeViaje>> plansByFlight = new HashMap<>();
        for (PlanDeViaje p : planes) {
            for (var esc : p.getEscalas()) {
                plansByFlight.computeIfAbsent(esc.getCodigoVuelo(), k -> new ArrayList<>()).add(p);
            }
        }
        Map<String, Envio> envioById = envios.stream().collect(Collectors.toMap(Envio::getIdEnvio, e -> e, (a, b) -> a));
        return vuelos.stream().map(v -> toVueloDto(v, plansByFlight, envioById)).toList();
    }

    public synchronized List<EnvioDTO> getEnviosEstado() {
        Map<String, PlanDeViaje> latestPlanByEnvio = buildLatestPlanByEnvio();
        return envios.stream().map(envio -> toEnvioDto(envio, false, latestPlanByEnvio.get(envio.getIdEnvio()))).toList();
    }

    public synchronized Optional<EnvioDTO> getEnvioPorId(String idEnvio) {
        Map<String, PlanDeViaje> latestPlanByEnvio = buildLatestPlanByEnvio();
        return envios.stream()
            .filter(envio -> envio.getIdEnvio().equals(idEnvio))
            .findFirst()
            .map(envio -> toEnvioDto(envio, true, latestPlanByEnvio.get(envio.getIdEnvio())));
    }

    public synchronized List<EnvioDTO> getEnviosByFlight(String codigoVuelo) {
        Map<String, PlanDeViaje> latestPlanByEnvio = buildLatestPlanByEnvio();
        Set<String> envioIds = planes.stream()
            .filter(PlanDeViaje::isEsActivo)
            .filter(p -> p.getEscalas().stream().anyMatch(e -> codigoVuelo.equals(e.getCodigoVuelo())))
            .map(PlanDeViaje::getIdEnvio)
            .collect(Collectors.toSet());
        return envios.stream()
            .filter(e -> envioIds.contains(e.getIdEnvio()))
            .map(e -> toEnvioDto(e, false, latestPlanByEnvio.get(e.getIdEnvio())))
            .collect(Collectors.toList());
    }

    public synchronized com.tasf.backend.dto.AirportInventoryDTO getAirportInventory(String iata) {
        Map<String, Envio> envioById = envios.stream()
            .collect(Collectors.toMap(Envio::getIdEnvio, e -> e, (a, b) -> a));

        // Envíos actualmente en almacén
        Set<String> idsEnAlmacen = maletas.stream()
            .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN && iata.equals(m.getUbicacionActual()))
            .map(com.tasf.backend.domain.Maleta::getIdEnvio)
            .collect(Collectors.toSet());
        Map<String, Long> maletasPorEnvio = maletas.stream()
            .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN && iata.equals(m.getUbicacionActual()))
            .collect(Collectors.groupingBy(com.tasf.backend.domain.Maleta::getIdEnvio, Collectors.counting()));

        List<com.tasf.backend.dto.EnvioSummaryDTO> enAlmacen = idsEnAlmacen.stream()
            .map(id -> {
                Envio e = envioById.get(id);
                if (e == null) return null;
                return com.tasf.backend.dto.EnvioSummaryDTO.builder()
                    .idEnvio(id)
                    .aeropuertoOrigen(e.getAeropuertoOrigen())
                    .aeropuertoDestino(e.getAeropuertoDestino())
                    .cantidadMaletas(maletasPorEnvio.getOrDefault(id, 0L).intValue())
                    .estado(e.getEstado().name())
                    .build();
            })
            .filter(java.util.Objects::nonNull)
            .sorted(java.util.Comparator.comparing(com.tasf.backend.dto.EnvioSummaryDTO::getIdEnvio))
            .collect(Collectors.toList());

        // Escalas planificadas hoy en este aeropuerto
        LocalDate today = fechaSimulada != null ? fechaSimulada.toLocalDate() : LocalDate.now();
        List<com.tasf.backend.dto.EnvioSummaryDTO> entrando = new java.util.ArrayList<>();
        List<com.tasf.backend.dto.EnvioSummaryDTO> saliendo = new java.util.ArrayList<>();

        planes.stream()
            .filter(PlanDeViaje::isEsActivo)
            .forEach(plan -> {
                Envio e = envioById.get(plan.getIdEnvio());
                if (e == null || e.getEstado() == EstadoEnvio.ENTREGADO || e.getEstado() == EstadoEnvio.CANCELADO) return;
                for (Escala esc : plan.getEscalas()) {
                    if (esc.isCompletada() || !iata.equals(esc.getCodigoAeropuerto())) continue;
                    if (esc.getHoraLlegadaEst() != null && esc.getHoraLlegadaEst().toLocalDate().equals(today)) {
                        entrando.add(com.tasf.backend.dto.EnvioSummaryDTO.builder()
                            .idEnvio(plan.getIdEnvio())
                            .aeropuertoOrigen(e.getAeropuertoOrigen())
                            .aeropuertoDestino(e.getAeropuertoDestino())
                            .cantidadMaletas(e.getCantidadMaletas())
                            .estado(e.getEstado().name())
                            .codigoVuelo(esc.getCodigoVuelo())
                            .hora(esc.getHoraLlegadaEst().toLocalTime().toString().substring(0, 5))
                            .build());
                    }
                    if (esc.getHoraSalidaEst() != null && esc.getHoraSalidaEst().toLocalDate().equals(today)) {
                        saliendo.add(com.tasf.backend.dto.EnvioSummaryDTO.builder()
                            .idEnvio(plan.getIdEnvio())
                            .aeropuertoOrigen(e.getAeropuertoOrigen())
                            .aeropuertoDestino(e.getAeropuertoDestino())
                            .cantidadMaletas(e.getCantidadMaletas())
                            .estado(e.getEstado().name())
                            .codigoVuelo(esc.getCodigoVuelo())
                            .hora(esc.getHoraSalidaEst().toLocalTime().toString().substring(0, 5))
                            .build());
                    }
                }
            });

        entrando.sort(java.util.Comparator.comparing(com.tasf.backend.dto.EnvioSummaryDTO::getHora,
            java.util.Comparator.nullsLast(java.util.Comparator.naturalOrder())));
        saliendo.sort(java.util.Comparator.comparing(com.tasf.backend.dto.EnvioSummaryDTO::getHora,
            java.util.Comparator.nullsLast(java.util.Comparator.naturalOrder())));

        return com.tasf.backend.dto.AirportInventoryDTO.builder()
            .iata(iata)
            .enAlmacen(enAlmacen)
            .planificadosEntrando(entrando)
            .planificadosSaliendo(saliendo)
            .build();
    }

    private Map<String, PlanDeViaje> buildLatestPlanByEnvio() {
        Map<String, PlanDeViaje> map = new HashMap<>();
        for (PlanDeViaje p : planes) {
            map.merge(p.getIdEnvio(), p,
                (a, b) -> a.getVersion() >= b.getVersion() ? a : b);
        }
        return map;
    }

    private void processDepartures(Map<String, Envio> envioById, Map<String, Vuelo> vueloByCode,
            Map<String, Aeropuerto> airportByCode, Map<String, List<Maleta>> maletasByEnvio) {
        LocalDate today = fechaSimulada.toLocalDate();

        for (PlanDeViaje plan : planes) {
            Envio envio = envioById.get(plan.getIdEnvio());
            if (envio == null || envio.getEstado() == EstadoEnvio.ENTREGADO || envio.getEstado() == EstadoEnvio.CANCELADO) {
                continue;
            }
            for (var escala : plan.getEscalas()) {
                if (!escala.getHoraSalidaEst().toLocalDate().equals(today)) {
                    continue;
                }
                Vuelo vuelo = vueloByCode.get(escala.getCodigoVuelo());
                if (vuelo == null || vuelo.isCancelado()) {
                    continue;
                }

                String legOrigin = vuelo.getOrigen();
                List<Maleta> maletasEnvio = maletasByEnvio.getOrDefault(envio.getIdEnvio(), List.of()).stream()
                    .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN || m.getEstado() == EstadoMaleta.RETRASADA)
                    .filter(m -> legOrigin.equals(m.getUbicacionActual()))
                    .toList();
                
                for (Maleta maleta : maletasEnvio) {
                    maleta.setEstado(EstadoMaleta.EN_VUELO);
                    maletaVueloActual.put(maleta.getIdMaleta(), vuelo.getCodigoVuelo());
                }
                if (!maletasEnvio.isEmpty()) {
                    vuelo.setCargaActual(vuelo.getCargaActual() + maletasEnvio.size());
                    if (envio.getEstado() != EstadoEnvio.RETRASADO) {
                        envio.setEstado(EstadoEnvio.EN_TRANSITO);
                    }
                    Aeropuerto originAirport = airportByCode.get(legOrigin);
                    if (originAirport != null) {
                        originAirport.setMaletasEnviadas(originAirport.getMaletasEnviadas() + maletasEnvio.size());
                    }
                }
            }
        }
    }

    private void processArrivals(Map<String, Vuelo> vueloByCode, Map<String, Aeropuerto> airportByCode,
            Map<String, List<Maleta>> maletasByEnvio) {
        LocalDate today = fechaSimulada.toLocalDate();

        for (PlanDeViaje plan : planes) {
            for (var escala : plan.getEscalas()) {
                if (!escala.getHoraLlegadaEst().toLocalDate().equals(today)) {
                    continue;
                }
                Vuelo vuelo = vueloByCode.get(escala.getCodigoVuelo());
                if (vuelo == null || vuelo.isCancelado()) {
                    continue;
                }

                List<Maleta> inFlight = maletasByEnvio.getOrDefault(plan.getIdEnvio(), List.of()).stream()
                    .filter(m -> m.getEstado() == EstadoMaleta.EN_VUELO)
                    .filter(m -> escala.getCodigoVuelo().equals(maletaVueloActual.get(m.getIdMaleta())))
                    .toList();

                for (Maleta maleta : inFlight) {
                    maleta.setUbicacionActual(escala.getCodigoAeropuerto());
                    maleta.setEstado(EstadoMaleta.EN_ALMACEN);
                    maletaVueloActual.remove(maleta.getIdMaleta());
                }
                if (!inFlight.isEmpty()) {
                    Aeropuerto arrivalAirport = airportByCode.get(escala.getCodigoAeropuerto());
                    if (arrivalAirport != null) {
                        arrivalAirport.setMaletasRecibidas(arrivalAirport.getMaletasRecibidas() + inFlight.size());
                    }
                }

                vuelo.setCargaActual(Math.max(0, vuelo.getCargaActual() - inFlight.size()));
                // Warehouse occupation is fully recalculated by updateWarehouseOccupation() after
                // all arrivals/deliveries are processed, so we don't increment it here to avoid
                // double-counting.
            }
        }
    }

    private DeliveryStats processDeliveries(Map<String, Envio> envioById, Map<String, Aeropuerto> airportByCode,
            Map<String, List<Maleta>> maletasByEnvio) {
        int delivered = 0;
        int slaOk = 0;
        int slaBreach = 0;

        int entregadosEstePaso = 0;
        for (Maleta maleta : maletas) {
            Envio envio = envioById.get(maleta.getIdEnvio());
            if (envio == null || maleta.getEstado() != EstadoMaleta.EN_ALMACEN) {
                continue;
            }
            log.debug("DELIVERY CHECK: envio {} estado={} ubicacion={} destino={} match={}",
                envio.getIdEnvio(), maleta.getEstado(), maleta.getUbicacionActual(),
                envio.getAeropuertoDestino(),
                envio.getAeropuertoDestino().equals(maleta.getUbicacionActual()));

            if (envio.getAeropuertoDestino().equals(maleta.getUbicacionActual())) {
                maleta.setEstado(EstadoMaleta.ENTREGADA);
                delivered++;
                // Mark the envio ENTREGADO immediately on first bag arrival; do not wait
                // for allMatch across all bags (which breaks when envio IDs collide across
                // airport files, leaving some bags of the same ID at a different airport).
                if (envio.getEstado() != EstadoEnvio.ENTREGADO) {
                    envio.setEstado(EstadoEnvio.ENTREGADO);
                    entregadosEstePaso++;
                    log.debug("Envio {} entregado en {}", envio.getIdEnvio(), envio.getAeropuertoDestino());
                }
                Aeropuerto destino = airportByCode.get(maleta.getUbicacionActual());
                if (destino != null) {
                    destino.setOcupacionActual(Math.max(0, destino.getOcupacionActual() - 1));
                }
                if (fechaSimulada.isAfter(envio.getFechaHoraIngreso().plusDays(envio.getSla()))) {
                    slaBreach++;
                } else {
                    slaOk++;
                }
            }
        }

        // Second pass: catch any envio whose bags all reached ENTREGADA without going through
        // the first loop (e.g. via replanning that set bags directly). entregadosEstePaso was
        // already incremented above for the common path, so only add here for the rare case.
        for (Envio envio : envios) {
            if (envio.getEstado() == EstadoEnvio.ENTREGADO) continue;
            List<Maleta> maletasEnvio = maletasByEnvio.getOrDefault(envio.getIdEnvio(), List.of());
            boolean allDelivered = !maletasEnvio.isEmpty()
                && maletasEnvio.stream().allMatch(m -> m.getEstado() == EstadoMaleta.ENTREGADA);
            if (allDelivered) {
                envio.setEstado(EstadoEnvio.ENTREGADO);
                entregadosEstePaso++;
                log.debug("Envio {} entregado en {}", envio.getIdEnvio(), envio.getAeropuertoDestino());
            }
        }
        log.info("processDeliveries: {} envios entregados this pass", entregadosEstePaso);

        return new DeliveryStats(delivered, slaOk, slaBreach);
    }

    private boolean isCrossWindow(Envio envio, LocalDate simEnd, Map<String, PlanDeViaje> latestPlans) {
        if (simEnd == null) return false;
        PlanDeViaje plan = latestPlans.get(envio.getIdEnvio());
        if (plan == null) return false;
        return plan.getEscalas().stream()
            .filter(e -> !e.isCompletada() && e.getHoraLlegadaEst() != null)
            .anyMatch(e -> e.getHoraLlegadaEst().toLocalDate().isAfter(simEnd));
    }

    private void checkSlaViolations() {
        LocalDate simEnd = params == null ? null
            : params.getFechaInicio().plusDays(params.getDiasSimulacion() - 1);
        Map<String, PlanDeViaje> latestPlans = buildLatestPlanByEnvio();

        for (Envio envio : envios) {
            if (envio.getEstado() == EstadoEnvio.ENTREGADO) {
                continue;
            }
            if (isCrossWindow(envio, simEnd, latestPlans)) {
                continue;
            }
            LocalDateTime deadline = envio.getFechaHoraIngreso().plusDays(envio.getSla());
            if (fechaSimulada.isAfter(deadline)) {
                envio.setEstado(EstadoEnvio.RETRASADO);
                maletas.stream()
                    .filter(m -> m.getIdEnvio().equals(envio.getIdEnvio()))
                    .filter(m -> m.getEstado() != EstadoMaleta.ENTREGADA)
                    .forEach(m -> m.setEstado(EstadoMaleta.RETRASADA));
                long exceeded = Duration.between(deadline, fechaSimulada).toHours();
                addOperationLog("WARNING SLA exceeded for envio " + envio.getIdEnvio()
                    + " by " + exceeded + " sim-hours");
            }
        }
    }

    private void cancelRandomFlightsAndReplan() {
        LocalDate today = fechaSimulada == null ? null : fechaSimulada.toLocalDate();
        if (today == null) return;

        List<Vuelo> cancelledToday = detectCancellations(today);
        for (Vuelo vuelo : cancelledToday) {
            List<Maleta> affected = rescueBags(vuelo, today);
            int sinRuta = 0;
            String resultado;
            if (!affected.isEmpty()) {
                addOperationLog(String.format("[INCIDENCIA] Vuelo %s cancelado. Rescatadas %d maletas. Iniciando replanificación...",
                    vuelo.getCodigoVuelo(), affected.size()));
                sinRuta = replanificarConStats(affected, true);
                resultado = sinRuta == 0 ? "REROUTADO" : "PARCIAL";
            } else {
                addOperationLog("[INCIDENCIA] Vuelo " + vuelo.getCodigoVuelo() + " cancelado. Sin maletas afectadas hoy.");
                resultado = "SIN_AFECTADOS";
            }
            cancelaciones.add(Cancelacion.builder()
                .id("CAN-" + vuelo.getCodigoVuelo() + "-" + System.nanoTime())
                .codigoVuelo(vuelo.getCodigoVuelo())
                .fecha(today)
                .hora(LocalTime.now())
                .motivo("Incidencia aleatoria")
                .maletasAfectadas(affected.size())
                .enviosSinRuta(sinRuta)
                .resultado(resultado)
                .build());
        }
    }

    private List<Vuelo> detectCancellations(LocalDate today) {
        double probability = params.getPorcentajeCancelacionAleatoria() / 100.0;
        Set<String> plannedToday = planes.stream()
            .flatMap(plan -> plan.getEscalas().stream())
            .filter(e -> e.getHoraSalidaEst() != null && e.getHoraSalidaEst().toLocalDate().equals(today))
            .map(Escala::getCodigoVuelo)
            .collect(Collectors.toSet());

        List<Vuelo> cancelled = new ArrayList<>();
        for (Vuelo vuelo : vuelos) {
            if (!plannedToday.contains(vuelo.getCodigoVuelo()) || vuelo.isCancelado()) continue;
            if (random.nextDouble() < probability) {
                vuelo.setCancelado(true);
                cancelled.add(vuelo);
            }
        }
        return cancelled;
    }

    public synchronized void cancelarVueloManualmente(String codigoVuelo) {
        if (!enEjecucion) return;

        Vuelo vuelo = vuelos.stream()
            .filter(v -> v.getCodigoVuelo().equals(codigoVuelo))
            .findFirst()
            .orElse(null);

        if (vuelo == null || vuelo.isCancelado()) return;

        LocalDate today = fechaSimulada.toLocalDate();
        vuelo.setCancelado(true);
        List<Maleta> affected = rescueBags(vuelo, today);
        int sinRuta = 0;
        String resultado;
        if (!affected.isEmpty()) {
            addOperationLog(String.format("[INCIDENCIA] Vuelo %s cancelado MANUALMENTE. Rescatadas %d maletas. Iniciando replanificación...",
                vuelo.getCodigoVuelo(), affected.size()));
            sinRuta = replanificarConStats(affected, true);
            resultado = sinRuta == 0 ? "REROUTADO" : "PARCIAL";
        } else {
            addOperationLog("[INCIDENCIA] Vuelo " + vuelo.getCodigoVuelo() + " cancelado MANUALMENTE. Sin maletas afectadas hoy.");
            resultado = "SIN_AFECTADOS";
        }
        cancelaciones.add(Cancelacion.builder()
            .id("CAN-MANUAL-" + vuelo.getCodigoVuelo() + "-" + System.nanoTime())
            .codigoVuelo(vuelo.getCodigoVuelo())
            .fecha(today)
            .hora(LocalTime.now())
            .motivo("Cancelación manual")
            .maletasAfectadas(affected.size())
            .enviosSinRuta(sinRuta)
            .resultado(resultado)
            .build());
    }

    public synchronized void cancelarEnvioManualmente(String idEnvio) {
        if (!enEjecucion) return;

        Envio envio = envios.stream()
            .filter(e -> e.getIdEnvio().equals(idEnvio))
            .findFirst()
            .orElse(null);

        if (envio == null || envio.getEstado() == EstadoEnvio.CANCELADO) return;

        // Restriction: Cannot cancel if already in transit
        boolean alreadyInTransit = maletas.stream()
            .filter(m -> m.getIdEnvio().equals(idEnvio))
            .anyMatch(m -> m.getEstado() == EstadoMaleta.EN_VUELO);
        
        if (alreadyInTransit) {
            addOperationLog("[ADVERTENCIA] No se puede cancelar el envío " + idEnvio + " porque ya está en vuelo.");
            return;
        }

        envio.setEstado(EstadoEnvio.CANCELADO);
        addOperationLog("[INCIDENCIA] Envío " + idEnvio + " cancelado. Liberando capacidad y replanificando...");

        for (Maleta maleta : maletas) {
            if (maleta.getIdEnvio().equals(idEnvio)) {
                maleta.setEstado(EstadoMaleta.CANCELADA);
                maletaVueloActual.remove(maleta.getIdMaleta());
            }
        }

        // Trigger re-planning for all other pending/delayed bags to use the freed capacity
        List<Maleta> toOptimize = maletas.stream()
            .filter(m -> (m.getEstado() == EstadoMaleta.EN_ALMACEN || m.getEstado() == EstadoMaleta.RETRASADA) 
                && !m.getIdEnvio().equals(idEnvio))
            .toList();

        if (!toOptimize.isEmpty()) {
            replanificarConStats(toOptimize, true);
        }
    }

    private List<Maleta> rescueBags(Vuelo vuelo, LocalDate today) {
        Set<String> affectedEnvioIds = planes.stream()
            .filter(plan -> plan.getEscalas().stream()
                .anyMatch(e -> vuelo.getCodigoVuelo().equals(e.getCodigoVuelo())
                    && e.getHoraSalidaEst() != null
                    && e.getHoraSalidaEst().toLocalDate().equals(today)))
            .map(PlanDeViaje::getIdEnvio)
            .collect(Collectors.toSet());

        if (affectedEnvioIds.isEmpty()) return List.of();

        List<Maleta> affected = new ArrayList<>();
        int unloadedCount = 0;
        for (Maleta maleta : maletas) {
            if (!affectedEnvioIds.contains(maleta.getIdEnvio()) || maleta.getEstado() == EstadoMaleta.ENTREGADA) continue;

            // If it was supposed to be in this flight, put it back in the warehouse at the origin
            boolean wasInCanceledFlight = maleta.getEstado() == EstadoMaleta.EN_VUELO
                && vuelo.getCodigoVuelo().equals(maletaVueloActual.get(maleta.getIdMaleta()));
            
            if (wasInCanceledFlight) {
                maleta.setEstado(EstadoMaleta.EN_ALMACEN);
                maleta.setUbicacionActual(vuelo.getOrigen());
                maletaVueloActual.remove(maleta.getIdMaleta());
                unloadedCount++;
            }

            if (maleta.getEstado() == EstadoMaleta.EN_ALMACEN || maleta.getEstado() == EstadoMaleta.RETRASADA) {
                affected.add(maleta);
            }
        }

        if (unloadedCount > 0) {
            vuelo.setCargaActual(Math.max(0, vuelo.getCargaActual() - unloadedCount));
        }
        return affected;
    }

    private void updateWarehouseOccupation() {
        LocalDate today = fechaSimulada == null ? null : fechaSimulada.toLocalDate();
        Map<String, Long> counts = maletas.stream()
            .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN)
            .filter(m -> today == null || m.getFechaIngreso() == null || !m.getFechaIngreso().isAfter(today))
            .collect(Collectors.groupingBy(Maleta::getUbicacionActual, Collectors.counting()));

        for (Aeropuerto aeropuerto : aeropuertos) {
            long count = counts.getOrDefault(aeropuerto.getCodigoIATA(), 0L);
            aeropuerto.setOcupacionActual((int) count);
            if (count > 0) {
                int cap = aeropuerto.getCapacidadAlmacen();
                double pct = cap > 0 ? (count * 100.0 / cap) : 0.0;
                log.debug("[OCUPACION] Airport: {} | Bags in warehouse: {} | Capacity: {} | Occupation: {}%",
                    aeropuerto.getCodigoIATA(), count, cap, String.format("%.1f", pct));
            }
        }
    }

    private void accumulateOccupationSample() {
        for (Aeropuerto aeropuerto : aeropuertos) {
            int count = aeropuerto.getOcupacionActual();
            int cap = aeropuerto.getCapacidadAlmacen();
            double pct = cap > 0 ? (count * 100.0 / cap) : 0.0;
            aeropuerto.setOcupacionPorcentajeSuma(aeropuerto.getOcupacionPorcentajeSuma() + pct);
            aeropuerto.setOcupacionMuestras(aeropuerto.getOcupacionMuestras() + 1);
            if (count > aeropuerto.getOcupacionMaximaBolsas()) {
                aeropuerto.setOcupacionMaximaBolsas(count);
            }
        }
    }

    private KpisDTO buildKpis() {
        // EN_VUELO is a transient state (exists only during processDepartures/Arrivals).
        // Count maletas of envíos that are still active (PLANIFICADO or EN_TRANSITO).
        Set<String> enviosActivos = envios.stream()
            .filter(e -> e.getEstado() == EstadoEnvio.PLANIFICADO || e.getEstado() == EstadoEnvio.EN_TRANSITO)
            .map(Envio::getIdEnvio)
            .collect(Collectors.toSet());
        int maletasEnTransito = (int) maletas.stream()
            .filter(m -> enviosActivos.contains(m.getIdEnvio()))
            .count();
        int maletasEntregadas = (int) maletas.stream().filter(m -> m.getEstado() == EstadoMaleta.ENTREGADA).count();
        LocalDate today = fechaSimulada == null ? null : fechaSimulada.toLocalDate();
        Set<String> vuelosEnUso = planes.stream()
            .flatMap(p -> p.getEscalas().stream())
            .filter(e -> e.getHoraSalidaEst() != null && today != null &&
                e.getHoraSalidaEst().toLocalDate().equals(today))
            .map(Escala::getCodigoVuelo)
            .collect(Collectors.toSet());
        int vuelosActivos = vuelosEnUso.size();
        int slaVencidos = (int) envios.stream().filter(e -> e.getEstado() == EstadoEnvio.RETRASADO).count();

        // SLA compliance denominator: shipments whose deadline (fechaIngreso + sla)
        // falls on or before simulationEndDate. Only these shipments could have been
        // delivered within the simulation window; including others would unfairly
        // inflate the failure count.
        LocalDate simEnd = params == null ? null
            : params.getFechaInicio().plusDays(params.getDiasSimulacion() - 1);
        long totalEnvios = simEnd == null ? envios.size()
            : envios.stream()
                .filter(e -> !e.getFechaHoraIngreso().toLocalDate().plusDays(e.getSla()).isAfter(simEnd))
                .count();
        long entregadosEnSla = simEnd == null
            ? envios.stream().filter(e -> e.getEstado() == EstadoEnvio.ENTREGADO).count()
            : envios.stream()
                .filter(e -> e.getEstado() == EstadoEnvio.ENTREGADO)
                .filter(e -> !e.getFechaHoraIngreso().toLocalDate().plusDays(e.getSla()).isAfter(simEnd))
                .count();
        double cumplimientoSla = totalEnvios == 0 ? 0.0 : Math.round(entregadosEnSla * 1000.0 / totalEnvios) / 10.0;
        // When the simulation is finalised all bags are ENTREGADA so the live stream
        // would return 0. Use the historical average accumulated by accumulateOccupationSample()
        // instead. During the simulation (finalizada=false) keep the live computation so
        // that the map still shows real-time occupation correctly.
        double ocupacionPromedio;
        if (finalizada) {
            ocupacionPromedio = aeropuertos.stream()
                .mapToDouble(a -> a.getOcupacionMuestras() == 0 ? 0.0
                    : a.getOcupacionPorcentajeSuma() / a.getOcupacionMuestras())
                .average()
                .orElse(0.0d);
        } else {
            LocalDate kpiToday = fechaSimulada == null ? null : fechaSimulada.toLocalDate();
            Map<String, Long> liveOcupacion = maletas.stream()
                .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN)
                .filter(m -> kpiToday == null || m.getFechaIngreso() == null || !m.getFechaIngreso().isAfter(kpiToday))
                .collect(Collectors.groupingBy(Maleta::getUbicacionActual, Collectors.counting()));
            ocupacionPromedio = aeropuertos.stream()
                .mapToDouble(a -> {
                    if (a.getCapacidadAlmacen() == 0) return 0.0;
                    long bagCount = liveOcupacion.getOrDefault(a.getCodigoIATA(), 0L);
                    return bagCount * 100.0d / a.getCapacidadAlmacen();
                })
                .average()
                .orElse(0.0d);
        }

        return KpisDTO.builder()
            .maletasEnTransito(maletasEnTransito)
            .maletasEntregadas(maletasEntregadas)
            .cumplimientoSLA(cumplimientoSla)
            .vuelosActivos(vuelosActivos)
            .slaVencidos(slaVencidos)
            .ocupacionPromedioAlmacen(ocupacionPromedio)
            .build();
    }

    private AeropuertoDTO toAeropuertoDto(Aeropuerto airport,
            Map<String, Long> maletasPorAlmacen,
            Map<String, Long> maletasPorDestino) {
        int capacidad = airport.getCapacidadAlmacen();
        int ocupacion = airport.getOcupacionActual();

        String semaforo;
        if (capacidad == 0) {
            semaforo = "verde";
        } else {
            double pct = (ocupacion * 100.0) / capacidad;
            double ambarThreshold = params == null ? 85.0 : params.getUmbralSemaforoAmbar();
            double verdeThreshold = params == null ? 60.0 : params.getUmbralSemaforoVerde();
            if (pct >= ambarThreshold) {
                semaforo = "rojo";
            } else if (pct >= verdeThreshold) {
                semaforo = "ambar";
            } else {
                semaforo = "verde";
            }
        }

        double ocupProm = airport.getOcupacionMuestras() == 0 ? 0.0
            : airport.getOcupacionPorcentajeSuma() / airport.getOcupacionMuestras();
        double ocupMax = capacidad > 0
            ? (airport.getOcupacionMaximaBolsas() * 100.0 / capacidad) : 0.0;

        // compute next departure/arrival for this airport relative to current simulated time
        String nextDepStr = null;
        String nextArrStr = null;
        try {
            if (fechaSimulada != null && vuelos != null) {
                java.time.LocalDateTime now = fechaSimulada;
                java.util.Optional<java.time.LocalDateTime> nd = vuelos.stream()
                    .filter(v -> v.getOrigen() != null && v.getOrigen().equals(airport.getCodigoIATA()))
                    .filter(v -> !v.isCancelado())
                    .map(v -> {
                        java.time.LocalDateTime candidate = java.time.LocalDateTime.of(now.toLocalDate(), v.getHoraSalida());
                        if (candidate.isBefore(now) || candidate.isEqual(now)) candidate = candidate.plusDays(1);
                        return candidate;
                    })
                    .min(java.util.Comparator.comparingLong(d -> java.time.Duration.between(now, d).toMillis()));
                if (nd.isPresent()) nextDepStr = TS_FORMAT.format(nd.get());

                java.util.Optional<java.time.LocalDateTime> na = vuelos.stream()
                    .filter(v -> v.getDestino() != null && v.getDestino().equals(airport.getCodigoIATA()))
                    .filter(v -> !v.isCancelado())
                    .map(v -> {
                        java.time.LocalDateTime candidate = java.time.LocalDateTime.of(now.toLocalDate(), v.getHoraLlegada());
                        if (candidate.isBefore(now) || candidate.isEqual(now)) candidate = candidate.plusDays(1);
                        return candidate;
                    })
                    .min(java.util.Comparator.comparingLong(d -> java.time.Duration.between(now, d).toMillis()));
                if (na.isPresent()) nextArrStr = TS_FORMAT.format(na.get());
            }
        } catch (Exception ex) {
            // ignore and keep nulls
        }

        return AeropuertoDTO.builder()
            .codigoIATA(airport.getCodigoIATA())
            .nombre(airport.getNombre())
            .ciudad(airport.getCiudad())
            .continente(airport.getContinente())
            .lat(airport.getLat())
            .lng(airport.getLng())
            .huso(airport.getHuso())
            .capacidadAlmacen(capacidad)
            .ocupacionActual(ocupacion)
            .ocupacionInicioDia(airport.getOcupacionInicioDia())
            .semaforo(semaforo)
            .maletasRecibidas(airport.getMaletasRecibidas())
            .maletasEnviadas(airport.getMaletasEnviadas())
            .ocupacionPromedio(ocupProm)
            .ocupacionMaxima(ocupMax)
            .maletasEnAlmacenLocal(maletasPorAlmacen.getOrDefault(airport.getCodigoIATA(), 0L).intValue())
            .maletasEnTransitoEntrantes(maletasPorDestino.getOrDefault(airport.getCodigoIATA(), 0L).intValue())
                .nextDeparture(nextDepStr)
                .nextArrival(nextArrStr)
            .build();
    }

    private VueloDTO toVueloDto(Vuelo vuelo, Map<String, List<PlanDeViaje>> plansByFlight, Map<String, Envio> envioById) {
        List<PlanDeViaje> relatedPlans = plansByFlight.getOrDefault(vuelo.getCodigoVuelo(), List.of());
        boolean usedByAnyPlan = !relatedPlans.isEmpty();
        
        int maletasAsignadas = relatedPlans.stream()
            .map(p -> envioById.get(p.getIdEnvio()))
            .filter(e -> e != null && e.getEstado() != EstadoEnvio.ENTREGADO && e.getEstado() != EstadoEnvio.CANCELADO)
            .mapToInt(Envio::getCantidadMaletas)
            .sum();

        return VueloDTO.builder()
            .codigoVuelo(vuelo.getCodigoVuelo())
            .origen(vuelo.getOrigen())
            .destino(vuelo.getDestino())
            .tipo(vuelo.getTipo())
            .estado(resolveVueloEstado(vuelo, usedByAnyPlan))
            .cargaActual(vuelo.getCargaActual())
            .maletasAsignadas(maletasAsignadas)
            .capacidadTotal(vuelo.getCapacidadTotal())
            .fraction(resolveFraction(vuelo, relatedPlans))
            .horaSalida(vuelo.getHoraSalida().toString())
            .horaLlegada(vuelo.getHoraLlegada().toString())
            .enUso(usedByAnyPlan)
            .build();
    }

    private EnvioDTO toEnvioDto(Envio envio, boolean includePlanDetail, PlanDeViaje plan) {
        if (plan == null) {
             plan = planes.stream()
                .filter(p -> p.getIdEnvio().equals(envio.getIdEnvio()))
                .max(Comparator.comparingInt(PlanDeViaje::getVersion))
                .orElse(null);
        }
        LocalDateTime deadline = envio.getFechaHoraIngreso().plusDays(envio.getSla());

        return EnvioDTO.builder()
            .idEnvio(envio.getIdEnvio())
            .codigoAerolinea(envio.getCodigoAerolinea())
            .aeropuertoOrigen(envio.getAeropuertoOrigen())
            .aeropuertoDestino(envio.getAeropuertoDestino())
            .cantidadMaletas(envio.getCantidadMaletas())
            .estado(envio.getEstado().name())
            .sla(envio.getSla())
            .fechaHoraIngreso(envio.getFechaHoraIngreso().format(TS_FORMAT))
            .planResumen(buildPlanResumen(envio, plan))
            .tiempoRestante(formatRemainingTime(deadline))
            .planDetalle(includePlanDetail ? plan : null)
            .build();
    }

    private String buildPlanResumen(Envio envio, PlanDeViaje plan) {
        if (plan == null || plan.getEscalas() == null || plan.getEscalas().isEmpty()) {
            return envio.getAeropuertoOrigen() + " -> " + envio.getAeropuertoDestino() + " (no route)";
        }
        List<String> hubs = plan.getEscalas().stream()
            .map(escala -> escala.getCodigoAeropuerto())
            .filter(code -> !code.equals(envio.getAeropuertoDestino()))
            .distinct()
            .toList();

        if (hubs.isEmpty()) {
            return envio.getAeropuertoOrigen() + " -> " + envio.getAeropuertoDestino();
        }
        return envio.getAeropuertoOrigen() + " -> " + envio.getAeropuertoDestino() + " via " + String.join(", ", hubs);
    }

    private String formatRemainingTime(LocalDateTime deadline) {
        if (fechaSimulada == null) {
            return "N/A";
        }
        Duration remaining = Duration.between(fechaSimulada, deadline);
        if (remaining.isNegative()) {
            return "vencido " + Math.abs(remaining.toHours()) + "h";
        }
        long days = remaining.toDays();
        long hours = remaining.minusDays(days).toHours();
        return days + "d " + hours + "h";
    }

    private String resolveVueloEstado(Vuelo vuelo, boolean inUse) {
        if (vuelo.isCancelado()) {
            return "cancelado";
        }
        if (inUse && vuelo.getCargaActual() == 0 && diaActual > 1) {
            return "completado";
        }
        return "activo";
    }

    private double resolveFraction(Vuelo vuelo, List<PlanDeViaje> relatedPlans) {
        if (fechaSimulada == null || relatedPlans.isEmpty()) {
            return 0.0d;
        }
        // Simplified midpoint fraction for animation performance
        return 0.5d;
    }

    private void addOperationLog(String message) {
        String value = LocalDateTime.now().format(TS_FORMAT) + " | " + message;
        logBuffer.addLast(value);
        while (logBuffer.size() > MAX_LOG_ENTRIES) {
            logBuffer.removeFirst();
        }
        this.logOperaciones = new ArrayList<>(logBuffer);
        log.info(message);
    }

    private List<Aeropuerto> deepCopyAeropuertos(List<Aeropuerto> source) {
        return source.stream().map(a -> Aeropuerto.builder()
            .codigoIATA(a.getCodigoIATA())
            .nombre(a.getNombre())
            .ciudad(a.getCiudad())
            .pais(a.getPais())
            .continente(a.getContinente())
            .huso(a.getHuso())
            .capacidadAlmacen(a.getCapacidadAlmacen())
            .lat(a.getLat())
            .lng(a.getLng())
            .ocupacionActual(a.getOcupacionActual())
            .build()).collect(Collectors.toCollection(ArrayList::new));
    }

    private List<Vuelo> deepCopyVuelos(List<Vuelo> source) {
        return source.stream().map(v -> Vuelo.builder()
            .codigoVuelo(v.getCodigoVuelo())
            .origen(v.getOrigen())
            .destino(v.getDestino())
            .horaSalida(v.getHoraSalida())
            .horaLlegada(v.getHoraLlegada())
            .capacidadTotal(v.getCapacidadTotal())
            .tipo(v.getTipo())
            .cargaActual(v.getCargaActual())
            .cancelado(v.isCancelado())
            .build()).collect(Collectors.toCollection(ArrayList::new));
    }

    private List<Envio> deepCopyEnvios(List<Envio> source) {
        return source.stream().map(e -> Envio.builder()
            .idEnvio(e.getIdEnvio())
            .codigoAerolinea(e.getCodigoAerolinea())
            .aeropuertoOrigen(e.getAeropuertoOrigen())
            .aeropuertoDestino(e.getAeropuertoDestino())
            .fechaHoraIngreso(e.getFechaHoraIngreso())
            .cantidadMaletas(e.getCantidadMaletas())
            .sla(e.getSla())
            .estado(e.getEstado())
            .build()).collect(Collectors.toCollection(ArrayList::new));
    }

    private List<Maleta> generarMaletas(List<Envio> enviosInput) {
        List<Maleta> generated = new ArrayList<>();
        for (Envio envio : enviosInput) {
            for (int i = 1; i <= envio.getCantidadMaletas(); i++) {
                generated.add(Maleta.builder()
                    .idMaleta(envio.getIdEnvio() + "-" + i)
                    .idEnvio(envio.getIdEnvio())
                    .ubicacionActual(envio.getAeropuertoOrigen())
                    .estado(EstadoMaleta.EN_ALMACEN)
                    .fechaIngreso(envio.getFechaHoraIngreso().toLocalDate())
                    .build());
            }
        }
        return generated;
    }

    private java.time.LocalTime parseHoraInicio(String horaInicio) {
        if (horaInicio == null || horaInicio.isBlank()) return java.time.LocalTime.MIDNIGHT;
        try {
            return java.time.LocalTime.parse(horaInicio);
        } catch (Exception e) {
            return java.time.LocalTime.MIDNIGHT;
        }
    }

    private int resolveDias(ParametrosSimulacion p) {
        if (p.getDias() != null && p.getDias() > 0) {
            return p.getDias();
        }
        if (p.getDiasSimulacion() > 0) {
            return p.getDiasSimulacion();
        }
        throw new IllegalArgumentException("dias must be greater than zero");
    }

    private int computeDiasColapso(LocalDate fechaInicio, List<Envio> envios) {
        LocalDate lastDate = envios.stream()
            .map(Envio::getFechaHoraIngreso)
            .map(LocalDateTime::toLocalDate)
            .max(LocalDate::compareTo)
            .orElse(fechaInicio);
        return (int) Math.max(1, lastDate.toEpochDay() - fechaInicio.toEpochDay() + 1);
    }

    private static class DeliveryStats {
        private final int delivered;
        private final int slaOk;
        private final int slaBreach;

        private DeliveryStats(int delivered, int slaOk, int slaBreach) {
            this.delivered = delivered;
            this.slaOk = slaOk;
            this.slaBreach = slaBreach;
        }
    }
}
