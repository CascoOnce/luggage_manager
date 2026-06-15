package com.tasf.backend.service;

import com.tasf.backend.domain.Aeropuerto;
import com.tasf.backend.domain.Envio;
import com.tasf.backend.domain.Escala;
import com.tasf.backend.domain.EstadoEnvio;
import com.tasf.backend.domain.ParametrosSimulacion;
import com.tasf.backend.domain.PlanDeViaje;
import com.tasf.backend.domain.PlanningResult;
import com.tasf.backend.domain.Vuelo;
import com.tasf.backend.dto.AirportInventoryDTO;
import com.tasf.backend.dto.EnvioSummaryDTO;
import com.tasf.backend.dto.LiveStateDTO;
import com.tasf.backend.dto.LiveStateDTO.LiveAeropuertoDTO;
import com.tasf.backend.dto.LiveStateDTO.LiveVueloDTO;
import com.tasf.backend.dto.OpsEnvioRequestDTO;
import com.tasf.backend.dto.OpsReporteDTO;
import com.tasf.backend.entity.EnvioEntity;
import com.tasf.backend.ops.repository.OpsEnvioRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OpsService {

    private static final Logger log = LoggerFactory.getLogger(OpsService.class);
    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("HH:mm");

    private final DataLoaderService dataLoaderService;
    private final PlanningService planningService;
    private final OpsEnvioRepository opsEnvioRepository;

    private final ConcurrentHashMap<String, PlanDeViaje> planesPorEnvio = new ConcurrentHashMap<>();
    // idEnvio -> bag count, captured at planning time (plans don't carry bag counts).
    private final ConcurrentHashMap<String, Integer> maletasPorEnvio = new ConcurrentHashMap<>();
    // idEnvio -> warehouse entry time (UTC), captured at planning time.
    private final ConcurrentHashMap<String, LocalDateTime> ingresoPorEnvio = new ConcurrentHashMap<>();
    // idEnvio -> orden of the current/next escala to process (1-based).
    private final ConcurrentHashMap<String, Integer> ordenActualByEnvio = new ConcurrentHashMap<>();

    public OpsService(
            DataLoaderService dataLoaderService,
            PlanningService planningService,
            OpsEnvioRepository opsEnvioRepository) {
        this.dataLoaderService = dataLoaderService;
        this.planningService = planningService;
        this.opsEnvioRepository = opsEnvioRepository;
    }

    // -------------------------------------------------------------------------
    // 1. getLiveState
    // -------------------------------------------------------------------------

    @Transactional(value = "opsTransactionManager", readOnly = true)
    public LiveStateDTO getLiveState(LocalDateTime from) {
        // Warehouse occupation (cheap; reused by the lightweight occupancy endpoint).
        List<LiveAeropuertoDTO> aeropuertoDTOs = computeOccupation(from);

        // Maps and now-of-day needed for the flights section below.
        Map<String, Integer> husoByIata = new HashMap<>();
        for (Aeropuerto a : dataLoaderService.getAeropuertos()) {
            husoByIata.put(a.getCodigoIATA(), a.getHuso());
        }
        int nowMin = from.toLocalTime().getHour() * 60 + from.toLocalTime().getMinute();

        // 2b. Collect flight codes currently used in planned routes
        Set<String> flightsInUso = new HashSet<>();
        for (PlanDeViaje plan : planesPorEnvio.values()) {
            if (plan.getEscalas() != null) {
                for (Escala e : plan.getEscalas()) {
                    if (e.getCodigoVuelo() != null) {
                        flightsInUso.add(e.getCodigoVuelo());
                    }
                }
            }
        }

        // 2c. Compute actual bag load per flight from EN_VUELO envíos
        Map<String, Integer> cargaPorVuelo = new HashMap<>();
        for (EnvioEntity envio : opsEnvioRepository.findAllByEstado("EN_VUELO")) {
            PlanDeViaje plan = planesPorEnvio.get(envio.getIdPedido());
            if (plan == null || plan.getEscalas() == null) continue;
            int orden = ordenActualByEnvio.getOrDefault(envio.getIdPedido(), 1);
            plan.getEscalas().stream()
                    .filter(e -> e.getOrden() == orden && e.getCodigoVuelo() != null)
                    .findFirst()
                    .ifPresent(e -> cargaPorVuelo.merge(e.getCodigoVuelo(),
                            envio.getCantidadMaletas(), Integer::sum));
        }

        // 3. Show only flights currently airborne. Flight times are a daily-repeating
        //    schedule (time-of-day, no date), so an overnight flight (dep > arr) is
        //    airborne when now is past departure OR before arrival.
        List<LiveVueloDTO> vueloDTOs = new ArrayList<>();
        for (Vuelo v : dataLoaderService.getVuelos()) {
            if (dataLoaderService.isFlightCancelledForSession(v.getCodigoVuelo())) {
                continue;
            }
            int depLocal = v.getHoraSalida().getHour() * 60 + v.getHoraSalida().getMinute();
            int arrLocal = v.getHoraLlegada().getHour() * 60 + v.getHoraLlegada().getMinute();
            int depMin = Math.floorMod(depLocal - husoByIata.getOrDefault(v.getOrigen(), 0) * 60, 1440);
            int arrMin = Math.floorMod(arrLocal - husoByIata.getOrDefault(v.getDestino(), 0) * 60, 1440);

            boolean overnight = depMin > arrMin;

            // Currently airborne. Overnight flights wrap past midnight.
            boolean inFlight = overnight
                    ? (depMin <= nowMin || nowMin <= arrMin)
                    : (depMin <= nowMin && nowMin <= arrMin);
            if (!inFlight) {
                continue;
            }

            int duration = (arrMin - depMin + 1440) % 1440;
            double fraction = 0.0;
            if (duration > 0 && inFlight) {
                int elapsed = (nowMin - depMin + 1440) % 1440;
                fraction = Math.max(0.0, Math.min(1.0, (double) elapsed / duration));
            }

            vueloDTOs.add(LiveVueloDTO.builder()
                    .codigoVuelo(v.getCodigoVuelo())
                    .origen(v.getOrigen())
                    .destino(v.getDestino())
                    .horaSalida(v.getHoraSalida().format(TIME_FMT))
                    .horaLlegada(v.getHoraLlegada().format(TIME_FMT))
                    .tipo(v.getTipo())
                    .capacidadTotal(v.getCapacidadTotal())
                    .cargaActual(cargaPorVuelo.getOrDefault(v.getCodigoVuelo(), 0))
                    .fraction(fraction)
                    .husOrigen(husoByIata.get(v.getOrigen()))
                    .husDestino(husoByIata.get(v.getDestino()))
                    .enUso(flightsInUso.contains(v.getCodigoVuelo()))
                    .build());
        }

        return LiveStateDTO.builder()
                .aeropuertos(aeropuertoDTOs)
                .vuelos(vueloDTOs)
                .build();
    }

    // -------------------------------------------------------------------------
    // 1b. computeOccupation — warehouse occupancy only (no flights). Cheap enough
    //     to poll frequently for a real-time airport view.
    // -------------------------------------------------------------------------

    @Transactional(value = "opsTransactionManager", readOnly = true)
    public List<LiveAeropuertoDTO> computeOccupation(LocalDateTime from) {
        // In ops mode, bags stay PENDIENTE until the simulation runs. Draining by
        // planned departure would remove bags from the count the moment the flight
        // time passes, even though the bag never actually boarded. Count all
        // PENDIENTE bags regardless of ingress time or planned departures.
        Map<String, Long> pendingByIata = new HashMap<>();
        for (Object[] row : opsEnvioRepository.sumAllMaletasPendientesByAeropuerto()) {
            pendingByIata.put((String) row[0], ((Number) row[1]).longValue());
        }

        List<LiveAeropuertoDTO> aeropuertoDTOs = new ArrayList<>();
        for (Aeropuerto a : dataLoaderService.getAeropuertos()) {
            long pending = pendingByIata.getOrDefault(a.getCodigoIATA(), 0L);
            int maletasPendientes = (int) Math.min(pending, Integer.MAX_VALUE);

            double ocupacionPct = 0.0;
            if (a.getCapacidadAlmacen() > 0) {
                ocupacionPct = (double) maletasPendientes / a.getCapacidadAlmacen() * 100.0;
            }
            ocupacionPct = Math.max(0.0, Math.min(100.0, ocupacionPct));

            String semaforo;
            if (ocupacionPct < 70.0) {
                semaforo = "GREEN";
            } else if (ocupacionPct < 90.0) {
                semaforo = "AMBER";
            } else {
                semaforo = "RED";
            }

            aeropuertoDTOs.add(LiveAeropuertoDTO.builder()
                    .codigoIATA(a.getCodigoIATA())
                    .nombre(a.getNombre())
                    .ciudad(a.getCiudad())
                    .continente(a.getContinente())
                    .lat(a.getLat())
                    .lng(a.getLng())
                    .capacidadAlmacen(a.getCapacidadAlmacen())
                    .maletasPendientes(maletasPendientes)
                    .ocupacionPct(ocupacionPct)
                    .semaforo(semaforo)
                    .build());
        }
        return aeropuertoDTOs;
    }

    // -------------------------------------------------------------------------
    // 2. addEnvio
    // -------------------------------------------------------------------------

    @Transactional("opsTransactionManager")
    public EnvioEntity addEnvio(OpsEnvioRequestDTO dto) {
        // Parse ISO-8601 with offset and convert to UTC
        OffsetDateTime offsetDt = OffsetDateTime.parse(dto.getFechaHoraIngreso());
        LocalDateTime fechaUtc = offsetDt.withOffsetSameInstant(ZoneOffset.UTC).toLocalDateTime();

        // Calculate SLA: 1 if same continent, 2 if different
        Map<String, String> continentByIata = new HashMap<>();
        for (Aeropuerto a : dataLoaderService.getAeropuertos()) {
            continentByIata.put(a.getCodigoIATA(), a.getContinente());
        }
        String continenteOrigen = continentByIata.get(dto.getIataOrigen());
        String continenteDestino = continentByIata.get(dto.getIataDestino());
        int sla = (continenteOrigen != null && continenteOrigen.equals(continenteDestino)) ? 1 : 2;

        // Generate unique idPedido
        String idPedido = "OPS-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();

        EnvioEntity entity = EnvioEntity.builder()
                .idPedido(idPedido)
                .idCliente(dto.getIdCliente())
                .iataOrigen(dto.getIataOrigen())
                .iataDestino(dto.getIataDestino())
                .cantidadMaletas(dto.getCantidadMaletas())
                .fechaHoraIngreso(fechaUtc)
                .sla(sla)
                .estado("PENDIENTE")
                .build();

        return opsEnvioRepository.save(entity);
    }

    // -------------------------------------------------------------------------
    // 3. planificar
    // -------------------------------------------------------------------------

    public PlanningResult planificar() {
        List<EnvioEntity> pendientes = opsEnvioRepository.findAllPendientesOrdenados();
        if (pendientes.isEmpty()) {
            log.info("No PENDIENTE envios to plan.");
            return PlanningResult.builder()
                    .planes(Collections.emptyList())
                    .enviosSinRuta(Collections.emptyList())
                    .build();
        }

        Map<String, Integer> husoByIata = new HashMap<>();
        for (Aeropuerto a : dataLoaderService.getAeropuertos()) {
            husoByIata.put(a.getCodigoIATA(), a.getHuso());
        }
        List<Envio> domainEnvios = pendientes.stream()
                .map(e -> toDomain(e, husoByIata))
                .toList();

        ParametrosSimulacion params = ParametrosSimulacion.builder()
                .algoritmo("SIMULATED_ANNEALING")
                .minutosEscalaMinima(10)
                .minutosRecogidaDestino(10)
                .umbralSemaforoVerde(60)
                .umbralSemaforoAmbar(85)
                .fechaInicio(LocalDate.now())
                .build();

        PlanningResult result = planningService.planificar(
                domainEnvios,
                dataLoaderService.getVuelos(),
                dataLoaderService.getAeropuertos(),
                params);

        // Store each plan in the in-memory map, plus its bag count and entry time for the drain.
        for (EnvioEntity e : pendientes) {
            maletasPorEnvio.put(e.getIdPedido(), e.getCantidadMaletas());
            ingresoPorEnvio.put(e.getIdPedido(), e.getFechaHoraIngreso());
            ordenActualByEnvio.remove(e.getIdPedido()); // reset leg progress on re-plan
        }
        for (PlanDeViaje plan : result.getPlanes()) {
            planesPorEnvio.put(plan.getIdEnvio(), plan);
        }

        log.info("Planned {} envios; {} without route", result.getPlanes().size(),
                result.getEnviosSinRuta().size());
        return result;
    }

    // -------------------------------------------------------------------------
    // 4. getEnvios
    // -------------------------------------------------------------------------

    @Transactional(value = "opsTransactionManager", readOnly = true)
    public List<EnvioEntity> getEnvios() {
        return opsEnvioRepository.findAllByOrderByFechaHoraIngresoDesc();
    }

    // -------------------------------------------------------------------------
    // 5. getPlan
    // -------------------------------------------------------------------------

    public PlanDeViaje getPlan(String idPedido) {
        return planesPorEnvio.get(idPedido);
    }

    // -------------------------------------------------------------------------
    // 6. getReporte
    // -------------------------------------------------------------------------

    @Transactional(value = "opsTransactionManager", readOnly = true)
    public OpsReporteDTO getReporte() {
        List<EnvioEntity> all = opsEnvioRepository.findAll();
        int total = all.size();
        int pendientes = 0;
        int entregados = 0;
        int violados = 0;
        int totalMaletas = 0;

        for (EnvioEntity e : all) {
            totalMaletas += e.getCantidadMaletas();
            switch (e.getEstado()) {
                case "PENDIENTE" -> pendientes++;
                case "ENTREGADO" -> entregados++;
                case "VIOLADO" -> violados++;
                default -> { /* other states not counted separately */ }
            }
        }

        double porcentaje = 0.0;
        if (total > 0) {
            porcentaje = Math.round(((double) entregados / total * 100.0) * 10.0) / 10.0;
        }

        return OpsReporteDTO.builder()
                .totalEnvios(total)
                .enviosPendientes(pendientes)
                .enviosEntregados(entregados)
                .enviosViolados(violados)
                .totalMaletas(totalMaletas)
                .porcentajeCumplimientoSla(porcentaje)
                .generadoEn(LocalDateTime.now(ZoneOffset.UTC).toString())
                .build();
    }

    // -------------------------------------------------------------------------
    // 7. batchSave
    // -------------------------------------------------------------------------

    @Transactional("opsTransactionManager")
    public List<EnvioEntity> batchSave(List<OpsEnvioRequestDTO> dtos) {
        Map<String, String> continentByIata = new HashMap<>();
        for (Aeropuerto a : dataLoaderService.getAeropuertos()) {
            continentByIata.put(a.getCodigoIATA(), a.getContinente());
        }

        List<EnvioEntity> saved = new ArrayList<>();
        for (OpsEnvioRequestDTO dto : dtos) {
            boolean hasId = dto.getIdPedido() != null && !dto.getIdPedido().isBlank();

            LocalDateTime fechaUtc;
            try {
                OffsetDateTime offsetDt = OffsetDateTime.parse(dto.getFechaHoraIngreso());
                // Store as UTC (consistent with addEnvio; downstream query/toDomain assume UTC)
                fechaUtc = offsetDt.withOffsetSameInstant(ZoneOffset.UTC).toLocalDateTime();
            } catch (Exception ex) {
                // Already naive local time (from file preview) — treat as UTC
                fechaUtc = LocalDateTime.parse(dto.getFechaHoraIngreso());
            }

            String continenteOrigen = continentByIata.get(dto.getIataOrigen());
            String continenteDestino = continentByIata.get(dto.getIataDestino());
            int sla = (continenteOrigen != null && continenteOrigen.equals(continenteDestino)) ? 1 : 2;

            String idPedido;
            if (hasId) {
                idPedido = dto.getIdPedido();
            } else {
                // Sequential ID per origin airport: IATA-000000001
                long count = opsEnvioRepository.countByIataOrigen(dto.getIataOrigen().toUpperCase());
                idPedido = dto.getIataOrigen().toUpperCase() + "-" + String.format("%09d", count + 1);
            }

            EnvioEntity entity = EnvioEntity.builder()
                    .idPedido(idPedido)
                    .idCliente(dto.getIdCliente())
                    .iataOrigen(dto.getIataOrigen())
                    .iataDestino(dto.getIataDestino())
                    .cantidadMaletas(dto.getCantidadMaletas())
                    .fechaHoraIngreso(fechaUtc)
                    .sla(sla)
                    .estado("PENDIENTE")
                    .build();

            saved.add(opsEnvioRepository.save(entity));
        }
        return saved;
    }

    // -------------------------------------------------------------------------
    // 8. getAirportInventory (ops mode)
    // -------------------------------------------------------------------------

    @Transactional(value = "opsTransactionManager", readOnly = true)
    public AirportInventoryDTO getAirportInventory(String iata) {
        String upper = iata.toUpperCase();

        // En almacén: PENDIENTE envíos whose origin is this airport.
        // Mark each with whether it has a route plan (planificado).
        List<EnvioSummaryDTO> enAlmacen = opsEnvioRepository
                .findAllByEstadoAndIataOrigen("PENDIENTE", upper)
                .stream()
                .map(e -> {
                    boolean hasPlan = planesPorEnvio.containsKey(e.getIdPedido());
                    List<String> ruta = null;
                    if (hasPlan) {
                        PlanDeViaje plan = planesPorEnvio.get(e.getIdPedido());
                        if (plan.getEscalas() != null && !plan.getEscalas().isEmpty()) {
                            ruta = new ArrayList<>();
                            ruta.add(e.getIataOrigen());
                            List<Escala> ordenadas = plan.getEscalas().stream()
                                    .sorted(Comparator.comparingInt(Escala::getOrden))
                                    .toList();
                            for (Escala esc : ordenadas) {
                                ruta.add(esc.getCodigoAeropuerto());
                            }
                        }
                    }
                    return EnvioSummaryDTO.builder()
                            .idEnvio(e.getIdPedido())
                            .aeropuertoOrigen(e.getIataOrigen())
                            .aeropuertoDestino(e.getIataDestino())
                            .cantidadMaletas(e.getCantidadMaletas())
                            .estado(e.getEstado())
                            .sla(e.getSla())
                            .planificado(hasPlan)
                            .rutaCompleta(ruta)
                            .build();
                })
                .sorted(Comparator.comparing(EnvioSummaryDTO::getIdEnvio))
                .collect(Collectors.toList());

        // Build a lookup of idPedido -> entity for plan processing
        Map<String, EnvioEntity> entityById = opsEnvioRepository.findAll().stream()
                .collect(Collectors.toMap(EnvioEntity::getIdPedido, e -> e, (a, b) -> a));

        List<EnvioSummaryDTO> entrando = new ArrayList<>();
        List<EnvioSummaryDTO> saliendo = new ArrayList<>();

        for (PlanDeViaje plan : planesPorEnvio.values()) {
            EnvioEntity ent = entityById.get(plan.getIdEnvio());
            if (ent == null || plan.getEscalas() == null || plan.getEscalas().isEmpty()) continue;

            // Escalas are ordered; each escala.codigoAeropuerto is the DESTINATION of a leg.
            // The leg origin is envío.iataOrigen for the first leg, and the previous
            // escala's codigoAeropuerto for later legs. So we reconstruct leg origins here.
            List<Escala> escalas = new ArrayList<>(plan.getEscalas());
            escalas.sort(Comparator.comparingInt(Escala::getOrden));

            String prevAeropuerto = ent.getIataOrigen();
            for (Escala esc : escalas) {
                String legOrigen = prevAeropuerto;
                String legDestino = esc.getCodigoAeropuerto();

                // Saliendo: this airport is the origin of this leg
                if (upper.equalsIgnoreCase(legOrigen) && esc.getHoraSalidaEst() != null) {
                    saliendo.add(summaryFromPlan(plan, ent, esc.getCodigoVuelo(),
                            esc.getHoraSalidaEst()));
                }
                // Entrando: this airport is the destination of this leg
                if (upper.equalsIgnoreCase(legDestino) && esc.getHoraLlegadaEst() != null) {
                    entrando.add(summaryFromPlan(plan, ent, esc.getCodigoVuelo(),
                            esc.getHoraLlegadaEst()));
                }

                prevAeropuerto = legDestino;
            }
        }

        entrando.sort(Comparator.comparing(EnvioSummaryDTO::getHora, Comparator.nullsLast(Comparator.naturalOrder())));
        saliendo.sort(Comparator.comparing(EnvioSummaryDTO::getHora, Comparator.nullsLast(Comparator.naturalOrder())));

        // Sin ruta: PENDIENTE envíos with origin here that have no plan after planificar
        List<EnvioSummaryDTO> sinRuta = enAlmacen.stream()
                .filter(e -> Boolean.FALSE.equals(e.getPlanificado()))
                .collect(Collectors.toList());

        return AirportInventoryDTO.builder()
                .iata(upper)
                .enAlmacen(enAlmacen)
                .planificadosEntrando(entrando)
                .planificadosSaliendo(saliendo)
                .sinRuta(sinRuta)
                .build();
    }

    private EnvioSummaryDTO summaryFromPlan(PlanDeViaje plan, EnvioEntity ent,
            String codigoVuelo, LocalDateTime hora) {
        return EnvioSummaryDTO.builder()
                .idEnvio(plan.getIdEnvio())
                .aeropuertoOrigen(ent.getIataOrigen())
                .aeropuertoDestino(ent.getIataDestino())
                .cantidadMaletas(ent.getCantidadMaletas())
                .estado(ent.getEstado())
                .sla(ent.getSla())
                .planificado(true)
                .codigoVuelo(codigoVuelo)
                .hora(hora.toLocalTime().toString().substring(0, 5))
                .build();
    }

    // -------------------------------------------------------------------------
    // 9. procesarSalidas — called by OpsScheduler every ~30s.
    //    Transitions PENDIENTE envíos to EN_VUELO when horaSalidaEst <= now.
    // -------------------------------------------------------------------------

    @Transactional("opsTransactionManager")
    public void procesarSalidas() {
        if (planesPorEnvio.isEmpty()) return;
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);

        for (EnvioEntity envio : opsEnvioRepository.findAllByEstado("PENDIENTE")) {
            PlanDeViaje plan = planesPorEnvio.get(envio.getIdPedido());
            if (plan == null || plan.getEscalas() == null || plan.getEscalas().isEmpty()) continue;

            int orden = ordenActualByEnvio.getOrDefault(envio.getIdPedido(), 1);
            plan.getEscalas().stream()
                    .filter(e -> e.getOrden() == orden)
                    .findFirst()
                    .ifPresent(escala -> {
                        if (!escala.getHoraSalidaEst().isAfter(now)) {
                            envio.setEstado("EN_VUELO");
                            opsEnvioRepository.save(envio);
                            log.info("Salida: {} en vuelo {} (escala {})",
                                    envio.getIdPedido(), escala.getCodigoVuelo(), orden);
                        }
                    });
        }
    }

    // -------------------------------------------------------------------------
    // 10. procesarLlegadas — called by OpsScheduler every ~30s (after salidas).
    //     Transitions EN_VUELO envíos: intermediate stop → PENDIENTE at new iataOrigen,
    //     or final destination → ENTREGADO.
    // -------------------------------------------------------------------------

    @Transactional("opsTransactionManager")
    public void procesarLlegadas() {
        if (planesPorEnvio.isEmpty()) return;
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);

        for (EnvioEntity envio : opsEnvioRepository.findAllByEstado("EN_VUELO")) {
            PlanDeViaje plan = planesPorEnvio.get(envio.getIdPedido());
            if (plan == null || plan.getEscalas() == null || plan.getEscalas().isEmpty()) continue;

            int orden = ordenActualByEnvio.getOrDefault(envio.getIdPedido(), 1);
            List<Escala> escalas = plan.getEscalas().stream()
                    .sorted(Comparator.comparingInt(Escala::getOrden))
                    .toList();

            escalas.stream()
                    .filter(e -> e.getOrden() == orden)
                    .findFirst()
                    .ifPresent(escala -> {
                        if (!escala.getHoraLlegadaEst().isAfter(now)) {
                            boolean hayMasEscalas = escalas.stream()
                                    .anyMatch(e -> e.getOrden() == orden + 1);
                            if (hayMasEscalas) {
                                // Intermediate stop: bag waits at this airport for next leg
                                envio.setEstado("PENDIENTE");
                                envio.setIataOrigen(escala.getCodigoAeropuerto());
                                ordenActualByEnvio.put(envio.getIdPedido(), orden + 1);
                                log.info("Llegada intermedia: {} en {} (próxima escala {})",
                                        envio.getIdPedido(), escala.getCodigoAeropuerto(), orden + 1);
                            } else {
                                envio.setEstado("ENTREGADO");
                                log.info("Entregado: {}", envio.getIdPedido());
                            }
                            opsEnvioRepository.save(envio);
                        }
                    });
        }
    }

    // -------------------------------------------------------------------------
    // Helper: toDomain
    // -------------------------------------------------------------------------

    private Envio toDomain(EnvioEntity e, Map<String, Integer> husoByIata) {
        // fechaHoraIngreso is stored as UTC. The planning algorithm compares it
        // directly against local flight times, so convert to origin airport local time.
        int huso = husoByIata.getOrDefault(e.getIataOrigen(), 0);
        LocalDateTime fechaLocal = e.getFechaHoraIngreso().plusHours(huso);

        return Envio.builder()
                .idEnvio(e.getIdPedido())
                .aeropuertoOrigen(e.getIataOrigen())
                .aeropuertoDestino(e.getIataDestino())
                .cantidadMaletas(e.getCantidadMaletas())
                .fechaHoraIngreso(fechaLocal)
                .sla(e.getSla())
                .estado(EstadoEnvio.valueOf(e.getEstado()))
                .build();
    }
}
