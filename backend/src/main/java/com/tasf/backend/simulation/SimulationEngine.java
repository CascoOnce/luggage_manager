package com.tasf.backend.simulation;

import com.tasf.backend.algorithm.AirportTimeline;
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
import com.tasf.backend.dto.EscalaResumenDTO;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
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
    // Flights cancelled with aplicaDesde=MANANA: applied at the start of the next simulated day.
    private final Set<String> vuelosCancelacionDiferida = new HashSet<>();
    private List<MetricaAlgoritmo> metricas = new ArrayList<>();
    private int diaActual;
    private LocalDateTime fechaSimulada;
    // Wall-clock timestamp (epoch ms) when the current simulated day started animating.
    // Server-side anchor so ANY client (including one that joins mid-simulation on a
    // different browser/machine) can compute the correct intraday clock position —
    // relying on client localStorage doesn't work since it isn't shared across browsers.
    private long diaInicioTimestampUtc;
    private boolean enEjecucion;
    private boolean finalizada;
    private List<String> logOperaciones = new ArrayList<>();

    private ColapsoPunto colapsoPunto = null;

    // Rolling planning state — persist across planning cycles
    private AirportTimeline sharedTimeline;
    private Map<String, Integer> sharedFlightLoads;
    private LocalDateTime horizonPointer;

    private final Deque<String> logBuffer = new ArrayDeque<>();
    private final Map<String, String> maletaVueloActual = new HashMap<>();
    private final List<ThroughputDiaDTO> throughputHistorial = new ArrayList<>();

    // Static schedule index: sorted departure/arrival LocalTimes per airport, built once
    // per simulation from the (immutable) flight timetable. Lets toAeropuertoDto compute the
    // next departure/arrival in O(log flights_at_airport) instead of scanning ALL vuelos per
    // airport on every getEstado() call (was O(aeropuertos × vuelos) = ~172k ops each time).
    private Map<String, List<LocalTime>> depTimesByAirport = new HashMap<>();
    private Map<String, List<LocalTime>> arrTimesByAirport = new HashMap<>();

    // Non-blocking cache: updated at end of each avanzarDia/inicializar/detener/reiniciar.
    // Allows /state polling to return immediately without contending on the synchronized lock.
    // NOTE: the cached copy is intentionally LIGHT (envios omitted) — /state polling carries
    // only enviosVersion, and the frontend refetches /envios lazily when that value changes.
    private volatile SimulationStateDTO cachedState;
    private volatile boolean initialized = false;

    // Monotonic (never reset) version bumped whenever `envios` materially change: day
    // advance, (re)planning batches, cancellations, uploads. Drives lazy envio refetch.
    private volatile long enviosVersion = 0;

    // Background planning: avanzarDia() submits next-day batch planning here so the
    // HTTP response returns fast. Each batch acquires the instance lock independently,
    // so polling (cachedState read) and the next step (wait then lock) are not blocked.
    private final ExecutorService planningExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "bg-planner");
        t.setDaemon(true);
        return t;
    });
    private volatile Future<?> backgroundPlanningFuture;

    public SimulationEngine(DataLoaderService dataLoaderService, PlanningService planningService, SimulationPersistenceService persistenceService) {
        this.dataLoaderService = dataLoaderService;
        this.planningService = planningService;
        this.persistenceService = persistenceService;
    }

    public synchronized void inicializar(ParametrosSimulacion params, List<Envio> todosLosEnvios) {
        reset();
        this.params = params;
        this.initialized = true;
        this.aeropuertos = deepCopyAeropuertos(dataLoaderService.getAeropuertos());
        this.vuelos = deepCopyVuelos(dataLoaderService.getVuelos());
        buildScheduleIndex();

        // Resolve the number of days requested by the user
        int filterDias = resolveDias(params);

        // Apply date-window filter: fechaHoraIngreso >= inicioExacto AND fecha < fechaInicio + dias
        // inicioExacto uses horaInicio so shipments registered before the start hour on day 1
        // are excluded — prevents pre-loaded flights appearing on the map at t=0.
        // When esColapso=true there is no upper bound.
        LocalDate fechaInicio = params.getFechaInicio();
        LocalDateTime inicioExacto = fechaInicio.atTime(parseHoraInicio(params.getHoraInicio()));
        boolean esColapso = Boolean.TRUE.equals(params.getEsColapso());

        // Colapso runs open-ended over a saturated network — wider Sc batches (K=150) trade
        // reaction speed for bigger batches per replan. Normal sim keeps K=120 (Tmax=60min calib).
        params.setK(esColapso ? 150 : 120);

        List<Envio> filteredEnvios;
        if (esColapso) {
            filteredEnvios = todosLosEnvios.stream()
                .filter(e -> !e.getFechaHoraIngreso().isBefore(inicioExacto))
                .collect(Collectors.toCollection(ArrayList::new));
        } else {
            LocalDate dateEnd = fechaInicio.plusDays(filterDias);
            filteredEnvios = todosLosEnvios.stream()
                .filter(e -> {
                    LocalDateTime dt = e.getFechaHoraIngreso();
                    return !dt.isBefore(inicioExacto) && dt.toLocalDate().isBefore(dateEnd);
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
        this.maletas = new ArrayList<>();  // populated lazily per batch in aplicarResultadoPlanificacion
        this.planes = new ArrayList<>();
        this.cancelaciones = new ArrayList<>();
        this.metricas = new ArrayList<>();
        this.fechaSimulada = params.getFechaInicio().atTime(parseHoraInicio(params.getHoraInicio()));

        this.envios.forEach(envio -> envio.setEstado(EstadoEnvio.PENDIENTE));

        // Rolling planning: set horizon pointer to simulation start then plan ALL batches
        // covering day 1. Planning the full first day (instead of a single batch) means the
        // frontend renders day-1 flights gradually by schedule (isActiveAtMinute) instead of
        // showing a near-empty map that floods when the first avanzarDia() runs.
        this.horizonPointer = params.getFechaInicio().atTime(parseHoraInicio(params.getHoraInicio()));
        LocalDateTime endOfDay1 = params.getFechaInicio().plusDays(1).atStartOfDay();
        PlanningResult planning = null;
        int rutasEvaluadasInit = 0;
        // enEjecucion/diaActual must be set BEFORE the day-1 planning loop (not after) so that
        // checkColapsoInmediato() — invoked from aplicarResultadoPlanificacion() on each batch —
        // can actually detect and record a collapse that happens while still planning day 1.
        this.diaActual = 1;
        this.diaInicioTimestampUtc = System.currentTimeMillis();
        this.enEjecucion = true;
        this.finalizada = false;
        while (horizonPointer != null && horizonPointer.isBefore(endOfDay1)) {
            planning = planificarSiguienteBloque();
            aplicarResultadoPlanificacion(planning);
            rutasEvaluadasInit += Optional.ofNullable(planning.getMetrica())
                .map(MetricaAlgoritmo::getRutasEvaluadas).orElse(0);
            if (!enEjecucion) {
                break; // checkColapsoInmediato() ya cerró la simulación
            }
        }

        // Skip day-1 visual/occupancy bookkeeping if checkColapsoInmediato() already closed the
        // simulation mid-loop above: the simulation has already ended at that point, so
        // interpolating occupancy forward to endOfDay1 (a point in time the run never actually
        // reached) would show a day that won't be rendered and could misrepresent when/how the
        // collapse happened.
        if (colapsoPunto == null) {
            // Day 1 warehouses START empty: envíos arrive throughout the day, so 0% at t=0 is correct.
            aeropuertos.forEach(a -> a.setOcupacionInicioDia(0));
            // Set the end-of-day interpolation endpoint to the full planned volume so the
            // frontend animation shows the warehouse gradually filling up during the day.
            // Using endOfDay1 counts all Day-1 maletas regardless of their fechaHoraIngreso time.
            updateWarehouseOccupation(endOfDay1);
        }

        String algoritmoInicial = params.getAlgoritmo() != null ? params.getAlgoritmo() : "N/A";
        addOperationLog("Simulation initialized - Day 1 - " + this.envios.size()
            + " envios - algorithm: " + algoritmoInicial
            + " - routes evaluated: " + rutasEvaluadasInit);
        bumpEnviosVersion();
        this.cachedState = buildLightEstado();
    }

    public SimulationStateDTO avanzarDia() {
        // Wait for background planning from the previous step BEFORE locking.
        // This avoids deadlock (we don't hold the lock while waiting).
        Future<?> pending = backgroundPlanningFuture;
        if (pending != null && !pending.isDone()) {
            try {
                pending.get(10, TimeUnit.SECONDS);
            } catch (Exception e) {
                log.warn("Background planning not yet complete, proceeding with available plans: {}", e.getMessage());
            }
        }
        return doAvanzarDia();
    }

    private synchronized SimulationStateDTO doAvanzarDia() {
        if (!enEjecucion || params == null) {
            return getEstado();
        }

        addOperationLog("Processing day " + diaActual);

        // Vuelos have only LocalTime (daily repeating schedule). Cancellations from a
        // previous simulated day must be reset so that the same flight can operate again.
        vuelos.forEach(v -> v.setCancelado(false));

        // Apply cancellations that were scheduled (aplicaDesde=MANANA) for today.
        if (!vuelosCancelacionDiferida.isEmpty()) {
            LocalDate hoy = fechaSimulada.toLocalDate();
            for (Vuelo v : vuelos) {
                if (vuelosCancelacionDiferida.remove(v.getCodigoVuelo())) {
                    v.setCancelado(true);
                    aplicarCancelacion(v, hoy, "Cancelación manual programada", "CAN-PROG");
                }
            }
        }

        // The current day's batches were already planned ahead of time — by inicializar()
        // for day 1, or by the previous avanzarDia()'s look-ahead for later days. This means
        // the state returned by each step already carries the flights for the day the frontend
        // is about to animate, so days advance 1:1 with the visual clock (no duplicate day-1
        // frame, and the final day animates before the redirect to resultados).

        // Sample the day's realistic PEAK occupancy (still held in ocupacionActual from the
        // prior look-ahead planning / inicializar) for the historical-average KPI — do this
        // BEFORE the raw recount below overwrites it. ocupacionInicioDia is no longer set from
        // a raw count here: the peak projection now sets both endpoints to a steady honest value.
        accumulateOccupationSample();
        // Raw recount: initializes the per-airport counter that processDeliveries decrements.
        updateWarehouseOccupation(null);

        // Build lookup maps once per day — shared across all passes and processDeliveries.
        Map<String, Envio> envioById = envios.stream().collect(Collectors.toMap(Envio::getIdEnvio, e -> e, (a, b) -> a));
        Map<String, Vuelo> vueloByCode = vuelos.stream().collect(Collectors.toMap(Vuelo::getCodigoVuelo, v -> v, (a, b) -> a));
        Map<String, Aeropuerto> airportByCode = aeropuertos.stream().collect(Collectors.toMap(Aeropuerto::getCodigoIATA, a -> a, (a, b) -> a));
        Map<String, List<Maleta>> maletasByEnvio = maletas.stream().collect(Collectors.groupingBy(Maleta::getIdEnvio));

        // Run up to 3 passes so that same-day connections work correctly.
        // Every simulated day (including the last) is processed in full — 00:00→24:00 —
        // so that N días = N×24h. Previously the last day was truncated at horaInicio,
        // which made the window span only N-1 days (e.g. 96h for a 5-day run).
        LocalTime endLimit = null;

        for (int pass = 0; pass < 3; pass++) {
            processDepartures(envioById, vueloByCode, airportByCode, maletasByEnvio, endLimit);
            processArrivals(vueloByCode, airportByCode, maletasByEnvio, endLimit);
        }
        DeliveryStats deliveryStats = processDeliveries(envioById, airportByCode, maletasByEnvio);

        logDepartureDiagnostics(vueloByCode);

        // End of the day just processed = start of the next calendar day (24h boundary),
        // for every day including the last.
        LocalDateTime currentStepEndTime = params.getFechaInicio().plusDays(diaActual).atStartOfDay();
        checkSlaViolations(maletasByEnvio, currentStepEndTime);

        // Post-processing: recalculate actual warehouse state for internal accuracy
        // (colapso checks, KPIs, etc). ocupacionInicioDia is NOT changed — it stays
        // at the pre-processing value for visual continuity.
        updateWarehouseOccupation(null);
        checkColapsoInmediato();

        throughputHistorial.add(ThroughputDiaDTO.builder()
            .dia(diaActual)
            .maletasProcesadas(deliveryStats.delivered)
            .slaOk(deliveryStats.slaOk)
            .slaBreach(deliveryStats.slaBreach)
            .build());

        if (params.getPorcentajeCancelacionAleatoria() > 0) {
            cancelRandomFlightsAndReplan();
        }

        // Envio estados settled for this day (processing + any random-cancel replanning) →
        // publish a new version so pollers refetch the envios table.
        bumpEnviosVersion();

        if (colapsoPunto == null && diaActual >= params.getDiasSimulacion()) {
            // Simulation ends at the end of the last full day = start of day N+1 (N×24h window).
            LocalDateTime simEndTime = params.getFechaInicio().plusDays(params.getDiasSimulacion()).atStartOfDay();
            updateWarehouseOccupation(simEndTime);
            this.finalizada = true;
            this.enEjecucion = false;
            applySimulationEnd(simEndTime);
            addOperationLog("Simulation completed - Day " + diaActual);
            persistenceService.persistSimulationResults(
                List.copyOf(planes),
                List.copyOf(metricas),
                List.copyOf(logOperaciones),
                List.copyOf(envios)
            );
            bumpEnviosVersion();  // applySimulationEnd changed estados
            SimulationStateDTO full = getEstado();
            this.cachedState = full.toBuilder().envios(List.of()).build();
            return full;
        }

        // Advance to next simulated day. Background thread plans that day's batches
        // so this method returns fast and the frontend isn't frozen waiting for planning.
        diaActual++;
        this.diaInicioTimestampUtc = System.currentTimeMillis();
        // Day 2+ always start at midnight — only day 1 uses horaInicio.
        this.fechaSimulada = params.getFechaInicio().plusDays(diaActual - 1).atStartOfDay();

        final LocalDateTime endOfDay = params.getFechaInicio().plusDays(diaActual).atStartOfDay();
        // Full response (with envios) goes back to the /step caller; cache stays light.
        SimulationStateDTO snap = getEstado();
        this.cachedState = snap.toBuilder().envios(List.of()).build();

        // Submit background planning — each batch acquires the instance lock independently,
        // so polling (cachedState volatile read) can interleave between batches.
        backgroundPlanningFuture = planningExecutor.submit(() -> {
            try {
                boolean more = true;
                while (more) {
                    more = planNextBatch(endOfDay);
                }
            } catch (Exception e) {
                log.error("Background planning error: {}", e.getMessage(), e);
            }
        });

        return snap;
    }

    /** Plans one batch for the given day-end boundary. Acquires + releases the instance
     *  lock per call so polling and step can interleave between batches. */
    private synchronized boolean planNextBatch(LocalDateTime endOfDay) {
        if (!enEjecucion || horizonPointer == null || !horizonPointer.isBefore(endOfDay)) {
            return false;
        }
        PlanningResult batchResult = planificarSiguienteBloque();
        aplicarResultadoPlanificacion(batchResult);
        bumpEnviosVersion();  // new plans/maletas → envios table changed
        addOperationLog("Rolling plan: batch up to " + horizonPointer + " — " + batchResult.getPlanes().size() + " new plans");
        // Skip the occupancy interpolation if aplicarResultadoPlanificacion() above already
        // triggered checkColapsoInmediato() and closed the simulation: same reasoning as the
        // matching guard in inicializar() — endOfDay is a point in time the run never actually
        // reached, so interpolating occupancy forward to it would misrepresent the collapse.
        // getEstado() still runs unconditionally so cachedState reflects the collapse.
        if (colapsoPunto == null) {
            // Use endOfDay as ref so that new-day bags (fechaHoraIngreso > midnight) are counted.
            // Without this, currentOccupation == ocupacionInicioDia and the frontend interpolation is flat.
            updateWarehouseOccupation(endOfDay);
        }
        // Background path — cache light directly (never build the ~21k envios here).
        this.cachedState = buildLightEstado();
        return horizonPointer != null && horizonPointer.isBefore(endOfDay);
    }

    public synchronized SimulationStateDTO reiniciar() {
        if (params == null) {
            return getEstado();
        }
        // Reset aeropuertos and vuelos to clean state (clears accumulated stats/loads)
        this.aeropuertos = deepCopyAeropuertos(dataLoaderService.getAeropuertos());
        this.vuelos = deepCopyVuelos(dataLoaderService.getVuelos());
        buildScheduleIndex();

        // Reset envio states to PLANIFICADO
        this.envios.forEach(e -> e.setEstado(EstadoEnvio.PLANIFICADO));

        // Rebuild maletas from envios (resets ubicacion to origin and estado to EN_ALMACEN)
        this.maletas = generarMaletas(this.envios);
        // Restore RETRASADA state for envíos that had no route in the original planning.
        Set<String> retrasadosReinicio = this.envios.stream()
            .filter(e -> e.getEstado() == EstadoEnvio.RETRASADO)
            .map(Envio::getIdEnvio)
            .collect(Collectors.toSet());
        this.maletas.stream()
            .filter(m -> retrasadosReinicio.contains(m.getIdEnvio()))
            .forEach(m -> m.setEstado(EstadoMaleta.RETRASADA));

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
        this.diaInicioTimestampUtc = System.currentTimeMillis();
        this.fechaSimulada = params.getFechaInicio().atTime(parseHoraInicio(params.getHoraInicio()));
        this.enEjecucion = true;
        this.finalizada = false;

        // Same fix as inicializar(): Day 1 starts empty, interpolation endpoint = planned volume.
        aeropuertos.forEach(a -> a.setOcupacionInicioDia(0));
        LocalDateTime endOfDay1Restart = params.getFechaInicio().plusDays(1).atStartOfDay();
        updateWarehouseOccupation(endOfDay1Restart);
        addOperationLog("Simulation restarted - Day 1 - reusing previous plans");
        bumpEnviosVersion();
        SimulationStateDTO full = getEstado();
        this.cachedState = full.toBuilder().envios(List.of()).build();
        return full;
    }

    public synchronized SimulationStateDTO detener() {
        if (params == null || finalizada) {
            return getEstado();
        }
        this.enEjecucion = false;
        this.finalizada = true;
        applySimulationEnd(fechaSimulada);
        addOperationLog("Simulation stopped manually - Day " + diaActual);
        persistenceService.persistSimulationResults(
            List.copyOf(planes),
            List.copyOf(metricas),
            List.copyOf(logOperaciones),
            List.copyOf(envios)
        );
        bumpEnviosVersion();
        SimulationStateDTO full = getEstado();
        this.cachedState = full.toBuilder().envios(List.of()).build();
        return full;
    }

    private void applySimulationEnd(LocalDateTime simulationEndTime) {
        Map<String, PlanDeViaje> latestPlans = buildLatestPlanByEnvio();

        envios.stream()
            .filter(e -> e.getEstado() != EstadoEnvio.ENTREGADO && e.getEstado() != EstadoEnvio.RETRASADO)
            .filter(e -> !isCrossWindow(e, simulationEndTime, latestPlans))
            .forEach(e -> {
                LocalDateTime deadline = e.getFechaHoraIngreso().plusDays(e.getSla());
                if (!deadline.isAfter(simulationEndTime)) {
                    e.setEstado(EstadoEnvio.RETRASADO);
                }
            });

        maletas.stream()
            .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN || m.getEstado() == EstadoMaleta.EN_VUELO)
            .forEach(m -> m.setEstado(EstadoMaleta.RETRASADA));

        long auditEvaluable = envios.stream()
            .filter(e -> !e.getFechaHoraIngreso().plusDays(e.getSla()).isAfter(simulationEndTime))
            .count();
        long auditEntregado = envios.stream()
            .filter(e -> e.getEstado() == EstadoEnvio.ENTREGADO)
            .filter(e -> !e.getFechaHoraIngreso().plusDays(e.getSla()).isAfter(simulationEndTime))
            .count();
        long auditRetrasado = envios.stream()
            .filter(e -> e.getEstado() == EstadoEnvio.RETRASADO)
            .filter(e -> !e.getFechaHoraIngreso().plusDays(e.getSla()).isAfter(simulationEndTime))
            .count();
        long auditInProgress = envios.stream()
            .filter(e -> e.getEstado() != EstadoEnvio.ENTREGADO && e.getEstado() != EstadoEnvio.RETRASADO)
            .filter(e -> !e.getFechaHoraIngreso().plusDays(e.getSla()).isAfter(simulationEndTime))
            .count();
        double auditSla = auditEvaluable == 0 ? 0.0
            : Math.round(auditEntregado * 1000.0 / auditEvaluable) / 10.0;
        log.info("[SLA AUDIT] simulationEndTime={} Evaluable={} ENTREGADO={} RETRASADO={} IN_PROGRESS={} SLA={}%",
            simulationEndTime, auditEvaluable, auditEntregado, auditRetrasado, auditInProgress, auditSla);
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
        // Same as inicializar: mark unroutable bags RETRASADA so warehouse counts stay accurate.
        maletas.stream()
            .filter(m -> sinRuta.contains(m.getIdEnvio()))
            .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN)
            .forEach(m -> m.setEstado(EstadoMaleta.RETRASADA));

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
        bumpEnviosVersion();
        this.cachedState = buildLightEstado();
    }

    public SimulationStateDTO getCachedEstado() {
        return cachedState;
    }

    /** Bump the envio version whenever envios/plans/estados change (drives lazy client refetch). */
    private void bumpEnviosVersion() {
        this.enviosVersion++;
    }

    public synchronized SimulationStateDTO getEstado() {
        return buildEstado(true);
    }

    /** Builds a LIGHT state (envios omitted) for the frequently-polled /state cache. */
    private SimulationStateDTO buildLightEstado() {
        return buildEstado(false);
    }

    private SimulationStateDTO buildEstado(boolean includeEnvios) {

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
                .enviosVersion(enviosVersion)
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
        Map<String, Integer> husoByAirport = aeropuertos.stream()
            .collect(Collectors.toMap(Aeropuerto::getCodigoIATA, Aeropuerto::getHuso, (a, b) -> a));

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
            .diaInicioTimestampUtc(diaInicioTimestampUtc)
            .horaInicioMin((int) parseHoraInicio(params.getHoraInicio()).toSecondOfDay() / 60)
            .algoritmo(params.getAlgoritmo())
            .metrica(metricas.isEmpty() ? null : metricas.get(metricas.size() - 1))
            .enEjecucion(enEjecucion)
            .finalizada(finalizada)
            .aeropuertos(aeropuertos.stream().map(a -> toAeropuertoDto(a, maletasPorAlmacen, maletasPorDestino)).toList())
            .vuelos(vuelos.stream().map(v -> toVueloDto(v, plansByFlight, envioById, husoByAirport)).toList())
            // Heavy list (~21k) — only built for full responses (start/step/cancel); the polled
            // light state omits it and the client refetches /envios when enviosVersion changes.
            .envios(includeEnvios
                ? envios.stream().map(e -> toEnvioDto(e, false, latestPlanByEnvio.get(e.getIdEnvio()))).toList()
                : List.of())
            .enviosVersion(enviosVersion)
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
        this.initialized = false;
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
        this.sharedTimeline = new AirportTimeline();
        this.sharedFlightLoads = new HashMap<>();
        this.horizonPointer = null;
    }

    public boolean estaInicializada() {
        return initialized;
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
        Map<String, Integer> husoByAirport = aeropuertos.stream()
            .collect(Collectors.toMap(Aeropuerto::getCodigoIATA, Aeropuerto::getHuso, (a, b) -> a));
        return vuelos.stream().map(v -> toVueloDto(v, plansByFlight, envioById, husoByAirport)).toList();
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

    public synchronized com.tasf.backend.dto.AirportInventoryDTO getAirportInventory(String iata, Integer nowMinUtc) {
        Map<String, Envio> envioById = envios.stream()
            .collect(Collectors.toMap(Envio::getIdEnvio, e -> e, (a, b) -> a));

        // Point-in-time inventory: a bag is physically in `iata`'s warehouse right now iff its
        // plan's capacity window for that airport covers `ref`. Reuses the same projection as
        // updateWarehouseOccupation() so the list is consistent with the occupancy percentage.
        // `maletas`/EstadoMaleta is NOT usable here: avanzarDia() resolves a whole simulated day
        // in one shot (endLimit=null) before the frontend finishes animating it, so bag state is
        // already fast-forwarded to end-of-day while the UI is still mid-day.
        final LocalDateTime ref = (nowMinUtc != null && fechaSimulada != null)
            ? fechaSimulada.toLocalDate().atStartOfDay().plusMinutes(nowMinUtc)
            : fechaSimulada;

        Map<String, PlanDeViaje> latestPlan = buildLatestPlanByEnvio();
        Map<String, Long> activeBagCountByEnvio = maletas.stream()
            .filter(m -> m.getEstado() != EstadoMaleta.ENTREGADA && m.getEstado() != EstadoMaleta.CANCELADA)
            .collect(Collectors.groupingBy(Maleta::getIdEnvio, Collectors.counting()));

        // Bags are shown while physically waiting in a warehouse in any of the 3 states:
        //  · origen  — ingresó, espera su primer vuelo        (windowsForPlan: origin window)
        //  · escala  — llegó a un hub, espera la conexión     (windowsForPlan: hub windows)
        //  · destino — llegó al destino final, espera recojo  (llegadaFinal + minutosRecogidaDestino)
        // Estado ENTREGADO/EN_TRANSITO NO se filtra: avanzarDia() resuelve el día completo antes
        // de que el frontend lo anime, así que el estado va adelantado — la presencia se deriva
        // de las ventanas del plan contra `ref`, no del EstadoEnvio.
        final int recogida = params != null ? params.getMinutosRecogidaDestino() : 15;
        List<com.tasf.backend.dto.EnvioSummaryDTO> enAlmacen = new ArrayList<>();
        for (Envio e : envios) {
            if (e.getEstado() == EstadoEnvio.CANCELADO) continue;
            long qty = activeBagCountByEnvio.getOrDefault(e.getIdEnvio(), 0L);
            int displayQty = (int) (qty > 0 ? qty : e.getCantidadMaletas());
            if (displayQty <= 0) continue;
            PlanDeViaje plan = latestPlan.get(e.getIdEnvio());

            boolean presente;
            if (plan == null) {
                // PENDIENTE (no plan yet): bags sit at the origin from fechaHoraIngreso onward.
                presente = iata.equals(e.getAeropuertoOrigen())
                    && (ref == null || !e.getFechaHoraIngreso().isAfter(ref));
            } else {
                // windowsForPlan now covers origen + escalas + destino (bounded by `recogida`),
                // same helper updateWarehouseOccupation() uses — keeps the list and the % aligned.
                presente = WarehouseOccupationCalculator
                    .windowsForPlan(plan, e.getAeropuertoOrigen(), e.getFechaHoraIngreso(), recogida)
                    .stream()
                    .anyMatch(w -> iata.equals(w.airport())
                        && (ref == null || !w.from().isAfter(ref))
                        && (w.to() == null || ref == null || w.to().isAfter(ref)));
            }
            if (!presente) continue;

            enAlmacen.add(com.tasf.backend.dto.EnvioSummaryDTO.builder()
                .idEnvio(e.getIdEnvio())
                .aeropuertoOrigen(e.getAeropuertoOrigen())
                .aeropuertoDestino(e.getAeropuertoDestino())
                .cantidadMaletas(displayQty)
                .estado(e.getEstado().name())
                .planificado(plan != null)
                .build());
        }
        enAlmacen.sort(Comparator.comparing(com.tasf.backend.dto.EnvioSummaryDTO::getIdEnvio));

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
                        int qty = plan.getCantidadMaletas() > 0 ? plan.getCantidadMaletas() : e.getCantidadMaletas();
                        entrando.add(com.tasf.backend.dto.EnvioSummaryDTO.builder()
                            .idEnvio(plan.getIdEnvio())
                            .aeropuertoOrigen(e.getAeropuertoOrigen())
                            .aeropuertoDestino(e.getAeropuertoDestino())
                            .cantidadMaletas(qty)
                            .estado(e.getEstado().name())
                            .codigoVuelo(esc.getCodigoVuelo())
                            .hora(esc.getHoraLlegadaEst().toLocalTime().toString().substring(0, 5))
                            .build());
                    }
                    if (esc.getHoraSalidaEst() != null && esc.getHoraSalidaEst().toLocalDate().equals(today)) {
                        int qty = plan.getCantidadMaletas() > 0 ? plan.getCantidadMaletas() : e.getCantidadMaletas();
                        saliendo.add(com.tasf.backend.dto.EnvioSummaryDTO.builder()
                            .idEnvio(plan.getIdEnvio())
                            .aeropuertoOrigen(e.getAeropuertoOrigen())
                            .aeropuertoDestino(e.getAeropuertoDestino())
                            .cantidadMaletas(qty)
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
            Map<String, Aeropuerto> airportByCode, Map<String, List<Maleta>> maletasByEnvio, LocalTime endLimit) {
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
                if (endLimit != null && escala.getHoraSalidaEst().toLocalTime().isAfter(endLimit)) {
                    continue;
                }
                Vuelo vuelo = vueloByCode.get(escala.getCodigoVuelo());
                if (vuelo == null || vuelo.isCancelado()) {
                    continue;
                }

                String legOrigin = vuelo.getOrigen();
                final int planVersion = plan.getVersion();
                List<Maleta> maletasEnvio = maletasByEnvio.getOrDefault(envio.getIdEnvio(), List.of()).stream()
                    .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN || m.getEstado() == EstadoMaleta.RETRASADA)
                    .filter(m -> legOrigin.equals(m.getUbicacionActual()))
                    .filter(m -> m.getPlanVersion() == planVersion)
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
            Map<String, List<Maleta>> maletasByEnvio, LocalTime endLimit) {
        LocalDate today = fechaSimulada.toLocalDate();

        for (PlanDeViaje plan : planes) {
            for (var escala : plan.getEscalas()) {
                if (!escala.getHoraLlegadaEst().toLocalDate().equals(today)) {
                    continue;
                }
                if (endLimit != null && escala.getHoraLlegadaEst().toLocalTime().isAfter(endLimit)) {
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
                    maleta.setFechaHoraLlegadaUbicacion(escala.getHoraLlegadaEst());
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

    /**
     * DIAGNOSTIC (temporary): explains the "warehouses overflow while flights fly empty" symptom.
     * Logs, for the day just processed:
     *  - maleta state counts,
     *  - STUCK bags: EN_ALMACEN bags that had a flight scheduled to depart today from their
     *    current location (mirrors processDepartures' filter exactly). If STUCK &gt; 0 after the
     *    3 passes, departures FAILED to board them → execution bug. If STUCK ≈ 0, the backlog is
     *    timing/capacity (routes depart on later days), i.e. congestion, not a departure bug.
     *  - flight capacity used vs available for today's departing legs.
     */
    private void logDepartureDiagnostics(Map<String, Vuelo> vueloByCode) {
        LocalDate today = fechaSimulada.toLocalDate();
        Map<String, PlanDeViaje> latest = buildLatestPlanByEnvio();

        long enAlmacen = 0, enVuelo = 0, entregada = 0, retrasada = 0;
        for (Maleta m : maletas) {
            switch (m.getEstado()) {
                case EN_ALMACEN -> enAlmacen++;
                case EN_VUELO -> enVuelo++;
                case ENTREGADA -> entregada++;
                case RETRASADA -> retrasada++;
                default -> { }
            }
        }

        long stuck = 0;
        Map<String, List<Maleta>> byEnvio = maletas.stream()
            .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN)
            .collect(Collectors.groupingBy(Maleta::getIdEnvio));
        for (Map.Entry<String, List<Maleta>> e : byEnvio.entrySet()) {
            PlanDeViaje p = latest.get(e.getKey());
            if (p == null) continue;
            for (Escala esc : p.getEscalas()) {
                if (esc.getHoraSalidaEst() == null || !esc.getHoraSalidaEst().toLocalDate().equals(today)) continue;
                Vuelo v = vueloByCode.get(esc.getCodigoVuelo());
                if (v == null || v.isCancelado()) continue;
                String legOrigin = v.getOrigen();
                for (Maleta m : e.getValue()) {
                    if (legOrigin.equals(m.getUbicacionActual()) && m.getPlanVersion() == p.getVersion()) {
                        stuck++;
                    }
                }
            }
        }

        // Flight fill for legs departing today (how full the used flights actually are).
        Set<String> flightsToday = latest.values().stream()
            .flatMap(p -> p.getEscalas().stream())
            .filter(esc -> esc.getHoraSalidaEst() != null && esc.getHoraSalidaEst().toLocalDate().equals(today))
            .map(Escala::getCodigoVuelo)
            .collect(Collectors.toSet());
        int capToday = flightsToday.stream().map(vueloByCode::get).filter(java.util.Objects::nonNull)
            .mapToInt(Vuelo::getCapacidadTotal).sum();
        int loadToday = flightsToday.stream().map(vueloByCode::get).filter(java.util.Objects::nonNull)
            .mapToInt(Vuelo::getCargaActual).sum();

        log.info("[DIAG day {}] maletas: EN_ALMACEN={} EN_VUELO={} ENTREGADA={} RETRASADA={} | STUCK(should-have-departed)={} | flightsToday={} fill={}/{} ({}%)",
            diaActual, enAlmacen, enVuelo, entregada, retrasada, stuck, flightsToday.size(), loadToday, capToday,
            capToday == 0 ? 0 : Math.round(loadToday * 100.0 / capToday));

        // GROUND TRUTH: real instantaneous EN_ALMACEN count per airport (raw, no projection).
        Map<String, Long> realByAirport = maletas.stream()
            .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN && m.getUbicacionActual() != null)
            .collect(Collectors.groupingBy(Maleta::getUbicacionActual, Collectors.counting()));
        Map<String, Integer> capByAirport = aeropuertos.stream()
            .collect(Collectors.toMap(Aeropuerto::getCodigoIATA, Aeropuerto::getCapacidadAlmacen, (a, b) -> a));
        String top = realByAirport.entrySet().stream()
            .sorted((x, y) -> {
                double px = x.getValue() * 100.0 / Math.max(1, capByAirport.getOrDefault(x.getKey(), 1));
                double py = y.getValue() * 100.0 / Math.max(1, capByAirport.getOrDefault(y.getKey(), 1));
                return Double.compare(py, px);
            })
            .limit(6)
            .map(en -> String.format("%s %d/%d(%.0f%%)", en.getKey(), en.getValue(),
                capByAirport.getOrDefault(en.getKey(), 0),
                en.getValue() * 100.0 / Math.max(1, capByAirport.getOrDefault(en.getKey(), 1))))
            .collect(Collectors.joining(", "));
        log.info("[DIAG day {}] OCUPACION REAL por almacen (top): {}", diaActual, top);
    }

    private boolean isCrossWindow(Envio envio, LocalDateTime simEnd, Map<String, PlanDeViaje> latestPlans) {
        if (simEnd == null) return false;
        PlanDeViaje plan = latestPlans.get(envio.getIdEnvio());
        if (plan == null) return false;
        return plan.getEscalas().stream()
            .filter(e -> !e.isCompletada() && e.getHoraLlegadaEst() != null)
            .anyMatch(e -> e.getHoraLlegadaEst().isAfter(simEnd));
    }

    private void checkSlaViolations(Map<String, List<Maleta>> maletasByEnvio, LocalDateTime currentStepEndTime) {
        Map<String, PlanDeViaje> latestPlans = buildLatestPlanByEnvio();
        int newViolations = 0;

        for (Envio envio : envios) {
            if (envio.getEstado() == EstadoEnvio.ENTREGADO) {
                continue;
            }
            if (isCrossWindow(envio, currentStepEndTime, latestPlans)) {
                continue;
            }
            LocalDateTime deadline = envio.getFechaHoraIngreso().plusDays(envio.getSla());
            if (!currentStepEndTime.isBefore(deadline) && envio.getEstado() != EstadoEnvio.RETRASADO) {
                envio.setEstado(EstadoEnvio.RETRASADO);
                maletasByEnvio.getOrDefault(envio.getIdEnvio(), List.of()).stream()
                    .filter(m -> m.getEstado() != EstadoMaleta.ENTREGADA)
                    .forEach(m -> m.setEstado(EstadoMaleta.RETRASADA));
                newViolations++;
            }
        }

        if (newViolations > 0) {
            addOperationLog("WARNING " + newViolations + " new SLA violations on day " + diaActual);
        }
    }

    /** Cualquier envío RETRASADO (SLA vencido en tránsito, o sin ruta viable por saturación
     *  de vuelos/almacén) es colapso operativo — termina la simulación de inmediato,
     *  en cualquier modo. Idempotente: no hace nada si ya colapsó o si no está corriendo. */
    private void checkColapsoInmediato() {
        if (colapsoPunto != null || !enEjecucion) {
            return;
        }
        Optional<Envio> primerRetrasado = envios.stream()
            .filter(e -> e.getEstado() == EstadoEnvio.RETRASADO)
            .findFirst();
        if (primerRetrasado.isEmpty()) {
            return;
        }

        long totalRetrasados = envios.stream().filter(e -> e.getEstado() == EstadoEnvio.RETRASADO).count();
        double pct = envios.isEmpty() ? 0.0 : totalRetrasados * 100.0 / envios.size();
        String aerMasCritico = aeropuertos.stream()
            .filter(a -> a.getCapacidadAlmacen() > 0)
            .max(Comparator.comparingDouble(a -> (double) a.getOcupacionActual() / a.getCapacidadAlmacen()))
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
            "[COLAPSO] Operación colapsó en Día %d — envío %s sin cumplir SLA (%.1f%% del total retrasado)",
            diaActual, primerRetrasado.get().getIdEnvio(), pct));

        this.finalizada = true;
        this.enEjecucion = false;
        applySimulationEnd(fechaSimulada);
        persistenceService.persistSimulationResults(
            List.copyOf(planes),
            List.copyOf(metricas),
            List.copyOf(logOperaciones),
            List.copyOf(envios)
        );
    }

    private void cancelRandomFlightsAndReplan() {
        LocalDate today = fechaSimulada == null ? null : fechaSimulada.toLocalDate();
        if (today == null) return;

        List<Vuelo> cancelledToday = detectCancellations(today);
        for (Vuelo vuelo : cancelledToday) {
            aplicarCancelacion(vuelo, today, "Incidencia aleatoria", "CAN");
        }
    }

    // Shared by random cancellation, manual same-day cancellation, and manual
    // next-day cancellation once it's applied at the start of that day.
    private void aplicarCancelacion(Vuelo vuelo, LocalDate today, String motivo, String idPrefix) {
        List<Maleta> affected = rescueBags(vuelo, today);
        int sinRuta = 0;
        String resultado;
        if (!affected.isEmpty()) {
            addOperationLog(String.format("[INCIDENCIA] Vuelo %s cancelado (%s). Rescatadas %d maletas. Iniciando replanificación...",
                vuelo.getCodigoVuelo(), motivo, affected.size()));
            sinRuta = replanificarConStats(affected, true);
            resultado = sinRuta == 0 ? "REROUTADO" : "PARCIAL";
        } else {
            addOperationLog(String.format("[INCIDENCIA] Vuelo %s cancelado (%s). Sin maletas afectadas hoy.", vuelo.getCodigoVuelo(), motivo));
            resultado = "SIN_AFECTADOS";
        }
        cancelaciones.add(Cancelacion.builder()
            .id(idPrefix + "-" + vuelo.getCodigoVuelo() + "-" + System.nanoTime())
            .codigoVuelo(vuelo.getCodigoVuelo())
            .fecha(today)
            .hora(LocalTime.now())
            .motivo(motivo)
            .maletasAfectadas(affected.size())
            .enviosSinRuta(sinRuta)
            .resultado(resultado)
            .build());
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

    public synchronized void cancelarVueloManualmente(String codigoVuelo, String aplicaDesde) {
        if (!enEjecucion) return;

        Vuelo vuelo = vuelos.stream()
            .filter(v -> v.getCodigoVuelo().equals(codigoVuelo))
            .findFirst()
            .orElse(null);

        if (vuelo == null || vuelo.isCancelado() || vuelosCancelacionDiferida.contains(codigoVuelo)) return;

        if ("MANANA".equalsIgnoreCase(aplicaDesde)) {
            vuelosCancelacionDiferida.add(codigoVuelo);
            addOperationLog("[INCIDENCIA] Vuelo " + codigoVuelo + " programado para cancelarse el día siguiente.");
            bumpEnviosVersion();
            this.cachedState = buildLightEstado();
            return;
        }

        LocalDate today = fechaSimulada.toLocalDate();

        // Reject if the flight is currently airborne
        boolean stillAirborne = maletaVueloActual.values().stream()
            .anyMatch(code -> vuelo.getCodigoVuelo().equals(code));
        if (stillAirborne) {
            addOperationLog("[ADVERTENCIA] Vuelo " + codigoVuelo + " está en vuelo. Cancelación ignorada.");
            return;
        }

        vuelo.setCancelado(true);
        aplicarCancelacion(vuelo, today, "Cancelación manual", "CAN-MANUAL");

        // Refresh the cache so subsequent polls reflect the cancellation immediately.
        bumpEnviosVersion();
        this.cachedState = buildLightEstado();
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
        bumpEnviosVersion();
        this.cachedState = buildLightEstado();
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
        updateWarehouseOccupation(fechaSimulada);
    }

    private void updateWarehouseOccupation(LocalDateTime ref) {
        // ── Actual mode (ref == null): count every EN_ALMACEN bag as-is (internal accuracy). ──
        if (ref == null) {
            Map<String, Long> counts = maletas.stream()
                .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN)
                .collect(Collectors.groupingBy(Maleta::getUbicacionActual, Collectors.counting()));
            for (Aeropuerto a : aeropuertos) {
                a.setOcupacionActual(counts.getOrDefault(a.getCodigoIATA(), 0L).intValue());
            }
            return;
        }

        // ── Projection mode (ref != null): real event-driven occupancy, continuous across days. ──
        // Each active envío's assigned plan is walked leg-by-leg (mirroring
        // RouteCandidate.getCapacityWindows()) to produce arrival(+qty)/departure(-qty) events
        // per airport. No reset at day boundaries: baseline for the day is the true cumulative
        // stock carried over from prior days, not a recomputed "peak of day".
        final Map<String, PlanDeViaje> latestPlan = buildLatestPlanByEnvio();
        final java.time.ZoneOffset UTC = java.time.ZoneOffset.UTC;

        Map<String, Long> activeBagCountByEnvio = maletas.stream()
            .filter(m -> m.getEstado() != EstadoMaleta.ENTREGADA && m.getEstado() != EstadoMaleta.CANCELADA)
            .collect(Collectors.groupingBy(Maleta::getIdEnvio, Collectors.counting()));
        Map<String, Long> deliveredBagCountByEnvio = maletas.stream()
            .filter(m -> m.getEstado() == EstadoMaleta.ENTREGADA)
            .collect(Collectors.groupingBy(Maleta::getIdEnvio, Collectors.counting()));
        final int recogidaMinutos = params != null ? params.getMinutosRecogidaDestino() : 15;

        Map<String, List<long[]>> eventsByAirport = new HashMap<>();
        for (Envio envio : envios) {
            if (envio.getEstado() == EstadoEnvio.CANCELADO) continue;
            PlanDeViaje plan = latestPlan.get(envio.getIdEnvio());

            // Delivered: only the destino "esperando recojo" window applies — bags already
            // left origin/hubs. windowsForPlan's own destino window won't fire here because
            // processDeliveries flips estado to ENTREGADO in the same avanzarDia pass as
            // arrival, so this branch derives the window straight from the plan's last leg.
            if (envio.getEstado() == EstadoEnvio.ENTREGADO) {
                long deliveredQty = deliveredBagCountByEnvio.getOrDefault(envio.getIdEnvio(), 0L);
                if (deliveredQty == 0 || plan == null) continue;
                List<Escala> escs = plan.getEscalas();
                if (escs == null || escs.isEmpty()) continue;
                Escala last = escs.get(escs.size() - 1);
                if (last.getHoraLlegadaEst() == null) continue;
                List<long[]> list = eventsByAirport.computeIfAbsent(last.getCodigoAeropuerto(), k -> new ArrayList<>());
                list.add(new long[]{last.getHoraLlegadaEst().toEpochSecond(UTC), deliveredQty});
                list.add(new long[]{last.getHoraLlegadaEst().plusMinutes(recogidaMinutos).toEpochSecond(UTC), -deliveredQty});
                continue;
            }

            long qty = activeBagCountByEnvio.getOrDefault(envio.getIdEnvio(), 0L);

            // PENDIENTE envíos without maletas/plan: the bags are physically at the origin
            // airport warehouse from fechaHoraIngreso but haven't been generated yet (no
            // plan assigned). Emit an open-ended arrival event so the warehouse projection
            // counts them correctly. Without this, PENDIENTE envíos are invisible and the
            // occupation under-reports actual warehouse usage.
            if (qty == 0 || plan == null) {
                long pendienteQty = envio.getCantidadMaletas();
                if (pendienteQty > 0) {
                    List<long[]> list = eventsByAirport.computeIfAbsent(envio.getAeropuertoOrigen(), k -> new ArrayList<>());
                    list.add(new long[]{envio.getFechaHoraIngreso().toEpochSecond(UTC), pendienteQty});
                    // No departure event: bags sit indefinitely until planned/departed
                }
                continue;
            }
            for (WarehouseOccupationCalculator.CapacityWindow w : WarehouseOccupationCalculator
                    .windowsForPlan(plan, envio.getAeropuertoOrigen(), envio.getFechaHoraIngreso(), recogidaMinutos)) {
                List<long[]> list = eventsByAirport.computeIfAbsent(w.airport(), k -> new ArrayList<>());
                list.add(new long[]{w.from().toEpochSecond(UTC), qty});
                if (w.to() != null) {
                    list.add(new long[]{w.to().toEpochSecond(UTC), -qty});
                }
            }
        }

        // The projected day is the one containing the last instant BEFORE `ref`. Callers pass
        // `ref` either as the EXCLUSIVE end-of-day boundary (next midnight, e.g. endOfDay1 =
        // fechaInicio.plusDays(1)) or as the live fechaSimulada (mid-day). Using
        // ref.toLocalDate() directly keyed every event to the NEXT day for the midnight
        // callers, so the frontend (which evaluates at minute-of-current-day) saw a garbage
        // timeline and the baseline swallowed the whole current day. Subtracting one second
        // maps a midnight boundary back to the day it closes while leaving a mid-day ref on
        // its own day.
        LocalDateTime dayStart = ref.minusSeconds(1).toLocalDate().atStartOfDay();
        long dayStartEpoch = dayStart.toEpochSecond(UTC);
        long dayEndEpoch = dayStart.plusDays(1).toEpochSecond(UTC);
        long nowEpoch = ref.toEpochSecond(UTC);

        for (Aeropuerto a : aeropuertos) {
            List<long[]> evts = eventsByAirport.getOrDefault(a.getCodigoIATA(), List.of());
            WarehouseOccupationCalculator.DayProjection proj =
                WarehouseOccupationCalculator.projectAirport(evts, dayStartEpoch, dayEndEpoch, nowEpoch);
            a.setOcupacionInicioDia(proj.baseline());
            a.setOcupacionActual(proj.ocupacionActual());
            a.setEventosOcupacionDia(proj.eventos());
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
        Set<String> codigosCancelados = vuelos.stream()
            .filter(Vuelo::isCancelado)
            .map(Vuelo::getCodigoVuelo)
            .collect(Collectors.toSet());
        Map<String, PlanDeViaje> latestPlanKpis = new HashMap<>();
        for (PlanDeViaje p : planes) {
            PlanDeViaje cur = latestPlanKpis.get(p.getIdEnvio());
            if (cur == null || p.getVersion() > cur.getVersion()) {
                latestPlanKpis.put(p.getIdEnvio(), p);
            }
        }
        Set<String> vuelosEnUso = latestPlanKpis.values().stream()
            .flatMap(p -> p.getEscalas().stream())
            .filter(e -> e.getHoraSalidaEst() != null && today != null &&
                e.getHoraSalidaEst().toLocalDate().equals(today))
            .map(Escala::getCodigoVuelo)
            .filter(code -> !codigosCancelados.contains(code))
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
            // Include PENDIENTE envíos (no maletas yet) at their origin airport
            Set<String> enviosConMaletas = maletas.stream().map(Maleta::getIdEnvio).collect(Collectors.toSet());
            for (Envio e : envios) {
                if (e.getEstado() != EstadoEnvio.PENDIENTE) continue;
                if (enviosConMaletas.contains(e.getIdEnvio())) continue;
                if (kpiToday != null && e.getFechaHoraIngreso().toLocalDate().isAfter(kpiToday)) continue;
                liveOcupacion.merge(e.getAeropuertoOrigen(), (long) e.getCantidadMaletas(), Long::sum);
            }
            ocupacionPromedio = aeropuertos.stream()
                .mapToDouble(a -> {
                    if (a.getCapacidadAlmacen() == 0) return 0.0;
                    long bagCount = liveOcupacion.getOrDefault(a.getCodigoIATA(), 0L);
                    return bagCount * 100.0d / a.getCapacidadAlmacen();
                })
                .average()
                .orElse(0.0d);
        }

        // Aggregate occupancy: sum(load) / sum(capacity) across the fleet/warehouses,
        // not an average of per-unit percentages (which biases towards small-capacity units).
        Map<String, Vuelo> vueloByCodeKpi = vuelos.stream()
            .collect(Collectors.toMap(Vuelo::getCodigoVuelo, v -> v, (a, b) -> a));
        long cargaFlota = 0;
        long capFlota = 0;
        for (String code : vuelosEnUso) {
            Vuelo v = vueloByCodeKpi.get(code);
            if (v != null) {
                cargaFlota += v.getCargaActual();
                capFlota += v.getCapacidadTotal();
            }
        }
        double ocupacionFlota = capFlota == 0 ? 0.0 : cargaFlota * 100.0 / capFlota;

        long cargaAlmacen = maletas.stream()
            .filter(m -> m.getEstado() == EstadoMaleta.EN_ALMACEN)
            .filter(m -> today == null || m.getFechaIngreso() == null || !m.getFechaIngreso().isAfter(today))
            .count();
        // PENDIENTE envíos have no maletas generated yet, but their bags are physically in the
        // origin warehouse. Count them so the global occupation KPI reflects actual warehouse usage.
        Set<String> enviosWithMaletas = maletas.stream().map(Maleta::getIdEnvio).collect(Collectors.toSet());
        long pendienteBags = envios.stream()
            .filter(e -> e.getEstado() == EstadoEnvio.PENDIENTE)
            .filter(e -> !enviosWithMaletas.contains(e.getIdEnvio()))
            .filter(e -> today == null || !e.getFechaHoraIngreso().toLocalDate().isAfter(today))
            .mapToLong(Envio::getCantidadMaletas)
            .sum();
        cargaAlmacen += pendienteBags;
        long capAlmacen = aeropuertos.stream().mapToLong(Aeropuerto::getCapacidadAlmacen).sum();
        double ocupacionAlmacenes = capAlmacen == 0 ? 0.0 : cargaAlmacen * 100.0 / capAlmacen;

        return KpisDTO.builder()
            .maletasEnTransito(maletasEnTransito)
            .maletasEntregadas(maletasEntregadas)
            .cumplimientoSLA(cumplimientoSla)
            .vuelosActivos(vuelosActivos)
            .slaVencidos(slaVencidos)
            .ocupacionPromedioAlmacen(ocupacionPromedio)
            .ocupacionFlota(ocupacionFlota)
            .ocupacionAlmacenes(ocupacionAlmacenes)
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

        // Next departure/arrival for this airport relative to current simulated time.
        // Uses the pre-sorted schedule index (built once per simulation) instead of
        // scanning every vuelo — O(flights_at_airport) rather than O(all vuelos).
        String nextDepStr = null;
        String nextArrStr = null;
        if (fechaSimulada != null) {
            LocalDateTime nd = nextScheduledAfter(depTimesByAirport.get(airport.getCodigoIATA()), fechaSimulada);
            if (nd != null) nextDepStr = TS_FORMAT.format(nd);
            LocalDateTime na = nextScheduledAfter(arrTimesByAirport.get(airport.getCodigoIATA()), fechaSimulada);
            if (na != null) nextArrStr = TS_FORMAT.format(na);
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
            .eventosOcupacionDia(airport.getEventosOcupacionDia().stream()
                .map(e -> com.tasf.backend.dto.OcupacionEventoDTO.builder()
                    .minuto(e.getMinuto())
                    .delta(e.getDelta())
                    .build())
                .toList())
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

    private VueloDTO toVueloDto(Vuelo vuelo, Map<String, List<PlanDeViaje>> plansByFlight, Map<String, Envio> envioById, Map<String, Integer> husoByAirport) {
        List<PlanDeViaje> relatedPlans = plansByFlight.getOrDefault(vuelo.getCodigoVuelo(), List.of());
        boolean usedByAnyPlan = !relatedPlans.isEmpty();
        
        LocalDate currentSimDate = this.fechaSimulada != null ? this.fechaSimulada.toLocalDate() : LocalDate.now();
        int maletasAsignadas = 0;
        boolean enUsoHoy = false;

        for (PlanDeViaje p : relatedPlans) {
            Envio e = envioById.get(p.getIdEnvio());
            if (e != null && e.getEstado() != EstadoEnvio.ENTREGADO && e.getEstado() != EstadoEnvio.CANCELADO) {
                boolean fliesToday = p.getEscalas().stream()
                    .anyMatch(esc -> vuelo.getCodigoVuelo().equals(esc.getCodigoVuelo()) &&
                                     esc.getHoraSalidaEst() != null &&
                                     (esc.getHoraSalidaEst().toLocalDate().equals(currentSimDate) ||
                                      (esc.getHoraLlegadaEst() != null && esc.getHoraLlegadaEst().toLocalDate().equals(currentSimDate))));
                if (fliesToday) {
                    maletasAsignadas += e.getCantidadMaletas();
                    enUsoHoy = true;
                }
            }
        }

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
            .husOrigen(husoByAirport.get(vuelo.getOrigen()))
            .husDestino(husoByAirport.get(vuelo.getDestino()))
            .enUso(enUsoHoy)
            .cancelacionProgramada(vuelosCancelacionDiferida.contains(vuelo.getCodigoVuelo()))
            .build();
    }

    private EnvioDTO toEnvioDto(Envio envio, boolean includePlanDetail, PlanDeViaje plan) {
        // `plan` is the authoritative latest plan for this envio, resolved by the caller from
        // a map built over ALL planes. When it is null the envio genuinely has no plan, so the
        // previous O(planes) fallback scan could never find one — it was pure wasted work.
        LocalDateTime deadline = envio.getFechaHoraIngreso().plusDays(envio.getSla());

        // escalasResumen is heavy (one list per envio × ~21k envios = the bulk of the
        // /state payload). Only the per-envio detail fetch needs it; the polled live
        // state omits it. EnviosScreen falls back to the backend estado when absent.
        List<EscalaResumenDTO> escalasResumen = List.of();
        List<String> vuelosAsignados = List.of();
        String fechaSalidaPrimerVuelo = null;
        String fechaLlegadaUltimoVuelo = null;
        if (plan != null && plan.getEscalas() != null && !plan.getEscalas().isEmpty()) {
            List<Escala> escalas = plan.getEscalas();
            
            if (escalas.get(0).getHoraSalidaEst() != null) {
                fechaSalidaPrimerVuelo = escalas.get(0).getHoraSalidaEst().format(TS_FORMAT);
            }
            if (escalas.get(escalas.size() - 1).getHoraLlegadaEst() != null) {
                fechaLlegadaUltimoVuelo = escalas.get(escalas.size() - 1).getHoraLlegadaEst().format(TS_FORMAT);
            }
            
            // Siempre enviamos los códigos de vuelo, es muy liviano y permite al frontend
            // calcular el estado EN_TRANSITO reactivamente
            vuelosAsignados = escalas.stream()
                .map(Escala::getCodigoVuelo)
                .collect(Collectors.toList());

            if (includePlanDetail) {
                int last = escalas.size() - 1;
                escalasResumen = new java.util.ArrayList<>();
                for (int i = 0; i <= last; i++) {
                    Escala e = escalas.get(i);
                    escalasResumen.add(EscalaResumenDTO.builder()
                        .horaSalidaEst(e.getHoraSalidaEst() != null ? e.getHoraSalidaEst().format(TS_FORMAT) : null)
                        .horaLlegadaEst(e.getHoraLlegadaEst() != null ? e.getHoraLlegadaEst().format(TS_FORMAT) : null)
                        .esUltima(i == last)
                        .build());
                }
            }
        }

        return EnvioDTO.builder()
            .idEnvio(envio.getIdEnvio())
            .codigoAerolinea(envio.getCodigoAerolinea())
            .aeropuertoOrigen(envio.getAeropuertoOrigen())
            .aeropuertoDestino(envio.getAeropuertoDestino())
            .cantidadMaletas(envio.getCantidadMaletas())
            .estado(envio.getEstado().name())
            .sla(envio.getSla())
            .fechaHoraIngreso(envio.getFechaHoraIngreso().format(TS_FORMAT))
            .fechaSalidaPrimerVuelo(fechaSalidaPrimerVuelo)
            .fechaLlegadaUltimoVuelo(fechaLlegadaUltimoVuelo)
            .planResumen(buildPlanResumen(envio, plan))
            .tiempoRestante(formatRemainingTime(deadline))
            .planDetalle(includePlanDetail ? plan : null)
            .escalasResumen(escalasResumen)
            .vuelosAsignados(vuelosAsignados)
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

    /** Build the sorted departure/arrival time index from the current flight timetable.
     *  Called once whenever vuelos is (re)loaded. Cancellations are intentionally ignored
     *  here — this only feeds the "next scheduled departure/arrival" display fields. */
    private void buildScheduleIndex() {
        Map<String, List<LocalTime>> dep = new HashMap<>();
        Map<String, List<LocalTime>> arr = new HashMap<>();
        for (Vuelo v : vuelos) {
            if (v.getOrigen() != null && v.getHoraSalida() != null) {
                dep.computeIfAbsent(v.getOrigen(), k -> new ArrayList<>()).add(v.getHoraSalida());
            }
            if (v.getDestino() != null && v.getHoraLlegada() != null) {
                arr.computeIfAbsent(v.getDestino(), k -> new ArrayList<>()).add(v.getHoraLlegada());
            }
        }
        dep.values().forEach(list -> list.sort(Comparator.naturalOrder()));
        arr.values().forEach(list -> list.sort(Comparator.naturalOrder()));
        this.depTimesByAirport = dep;
        this.arrTimesByAirport = arr;
    }

    /** Next occurrence of any time in the sorted list strictly after `now`, wrapping to the
     *  following day if all scheduled times are at or before `now`. Returns null if empty. */
    private LocalDateTime nextScheduledAfter(List<LocalTime> sortedTimes, LocalDateTime now) {
        if (sortedTimes == null || sortedTimes.isEmpty()) return null;
        LocalTime nowT = now.toLocalTime();
        for (LocalTime t : sortedTimes) {
            if (t.isAfter(nowT)) {
                return LocalDateTime.of(now.toLocalDate(), t);
            }
        }
        // All times are <= now → first one tomorrow.
        return LocalDateTime.of(now.toLocalDate().plusDays(1), sortedTimes.get(0));
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
        // Group plans by envioId, sorted by version — needed to assign planVersion to bags
        Map<String, List<PlanDeViaje>> plansByEnvio = planes.stream()
            .collect(Collectors.groupingBy(PlanDeViaje::getIdEnvio));

        List<Maleta> generated = new ArrayList<>();
        for (Envio envio : enviosInput) {
            List<PlanDeViaje> envioPlans = plansByEnvio
                .getOrDefault(envio.getIdEnvio(), List.of())
                .stream()
                .sorted(Comparator.comparingInt(PlanDeViaje::getVersion))
                .collect(Collectors.toList());

            int maletaIdx = 1;

            if (envioPlans.isEmpty() || envioPlans.stream().allMatch(p -> p.getCantidadMaletas() == 0)) {
                // Non-split plan: all bags go to version 1
                for (int i = 1; i <= envio.getCantidadMaletas(); i++) {
                    generated.add(Maleta.builder()
                        .idMaleta(envio.getIdEnvio() + "-" + i)
                        .idEnvio(envio.getIdEnvio())
                        .ubicacionActual(envio.getAeropuertoOrigen())
                        .estado(EstadoMaleta.EN_ALMACEN)
                        .fechaIngreso(envio.getFechaHoraIngreso().toLocalDate())
                        .fechaHoraLlegadaUbicacion(envio.getFechaHoraIngreso())
                        .planVersion(1)
                        .build());
                }
            } else {
                // Split plan: distribute bags according to cantidadMaletas per version
                for (PlanDeViaje plan : envioPlans) {
                    int count = plan.getCantidadMaletas();
                    for (int i = 0; i < count; i++) {
                        generated.add(Maleta.builder()
                            .idMaleta(envio.getIdEnvio() + "-" + maletaIdx++)
                            .idEnvio(envio.getIdEnvio())
                            .ubicacionActual(envio.getAeropuertoOrigen())
                            .estado(EstadoMaleta.EN_ALMACEN)
                            .fechaIngreso(envio.getFechaHoraIngreso().toLocalDate())
                            .fechaHoraLlegadaUbicacion(envio.getFechaHoraIngreso())
                            .planVersion(plan.getVersion())
                            .build());
                    }
                }
            }
        }
        return generated;
    }

    private PlanningResult planificarSiguienteBloque() {
        if (horizonPointer == null) {
            return PlanningResult.builder().planes(List.of()).enviosSinRuta(List.of()).build();
        }

        int scMinutos = params.getScMinutos();
        LocalDateTime windowEnd = horizonPointer.plusMinutes(scMinutos);

        // Batch: all PENDIENTE envios that entered before windowEnd.
        // Includes carry-overs from prior windows deferred due to capacity exhaustion.
        List<Envio> batch = this.envios.stream()
            .filter(e -> e.getFechaHoraIngreso().isBefore(windowEnd))
            .filter(e -> e.getEstado() == EstadoEnvio.PENDIENTE)
            .collect(Collectors.toList());

        // No flight may be assigned before this Sc window closes — bags collected during
        // the window are only routed once the window ends (see plan doc for rationale).
        this.params.setCurrentTimeUtc(windowEnd);

        long startMs = System.currentTimeMillis();
        PlanningResult result = planningService.planificarLote(
            batch, this.vuelos, this.aeropuertos, this.params,
            this.sharedTimeline, this.sharedFlightLoads
        );
        long taMs = System.currentTimeMillis() - startMs;

        int saMs = params.getSaMinutos() * 60_000; // Sa in ms
        if (taMs > saMs) {
            log.warn("Ta ({} ms) > Sa ({} ms) — planner too slow for selected Sa. Risk of solution degradation.", taMs, saMs);
        } else {
            log.info("Planning batch [{} → {}]: {} envios, Ta={} ms, Sa={} ms, Sc={} min",
                horizonPointer, windowEnd, batch.size(), taMs, saMs, scMinutos);
        }

        // Advance horizon
        this.horizonPointer = windowEnd;

        return result;
    }

    private void aplicarResultadoPlanificacion(PlanningResult planning) {
        this.planes.addAll(planning.getPlanes());
        if (planning.getMetrica() != null) {
            this.metricas.add(planning.getMetrica());
        }

        // Lazy bag generation: only create bags for envíos that received a plan this batch.
        // Envíos deferred (PENDIENTE, capacity full) get bags when they're routed in a later batch.
        // Envíos with empty candidate pool are already RETRASADO — no bags created.
        Set<String> yaGenerados = this.maletas.stream()
            .map(Maleta::getIdEnvio)
            .collect(Collectors.toSet());
        List<Maleta> nuevas = generarMaletasDeBatch(planning.getPlanes(), yaGenerados);
        this.maletas.addAll(nuevas);

        // SA already set each envio's estado correctly:
        //   - truly unroutable (empty pool)  → RETRASADO
        //   - capacity-failed (deferred)     → PENDIENTE (will retry in next batch)
        // Only sync maletas to RETRASADA for envíos the SA confirmed as RETRASADO,
        // so warehouse counts stay accurate without overriding deferred PENDIENTE bags.
        Set<String> sinRuta = new HashSet<>(planning.getEnviosSinRuta());
        Set<String> confirmedRetrasado = this.envios.stream()
            .filter(e -> sinRuta.contains(e.getIdEnvio()) && e.getEstado() == EstadoEnvio.RETRASADO)
            .map(Envio::getIdEnvio)
            .collect(Collectors.toSet());
        this.maletas.stream()
            .filter(m -> confirmedRetrasado.contains(m.getIdEnvio()))
            .forEach(m -> m.setEstado(EstadoMaleta.RETRASADA));

        checkColapsoInmediato();
    }

    private List<Maleta> generarMaletasDeBatch(List<PlanDeViaje> batchPlanes, Set<String> yaGenerados) {
        Map<String, List<PlanDeViaje>> porEnvio = batchPlanes.stream()
            .filter(p -> !yaGenerados.contains(p.getIdEnvio()))
            .collect(Collectors.groupingBy(PlanDeViaje::getIdEnvio));

        List<Maleta> result = new ArrayList<>();
        Map<String, Envio> envioById = this.envios.stream()
            .collect(Collectors.toMap(Envio::getIdEnvio, e -> e));

        for (Map.Entry<String, List<PlanDeViaje>> entry : porEnvio.entrySet()) {
            Envio envio = envioById.get(entry.getKey());
            if (envio == null) continue;
            List<PlanDeViaje> envioPlans = entry.getValue().stream()
                .sorted(Comparator.comparingInt(PlanDeViaje::getVersion))
                .collect(Collectors.toList());
            int idx = 1;
            for (PlanDeViaje plan : envioPlans) {
                int count = plan.getCantidadMaletas() > 0 ? plan.getCantidadMaletas() : envio.getCantidadMaletas();
                for (int i = 0; i < count; i++) {
                    result.add(Maleta.builder()
                        .idMaleta(envio.getIdEnvio() + "-" + idx++)
                        .idEnvio(envio.getIdEnvio())
                        .ubicacionActual(envio.getAeropuertoOrigen())
                        .estado(EstadoMaleta.EN_ALMACEN)
                        .fechaIngreso(envio.getFechaHoraIngreso().toLocalDate())
                        .fechaHoraLlegadaUbicacion(envio.getFechaHoraIngreso())
                        .planVersion(plan.getVersion())
                        .build());
                }
            }
        }
        return result;
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
