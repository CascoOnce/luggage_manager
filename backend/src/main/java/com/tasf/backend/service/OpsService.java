package com.tasf.backend.service;

import com.tasf.backend.domain.Aeropuerto;
import com.tasf.backend.domain.Envio;
import com.tasf.backend.domain.Escala;
import com.tasf.backend.domain.EstadoEnvio;
import com.tasf.backend.domain.ParametrosSimulacion;
import com.tasf.backend.domain.PlanDeViaje;
import com.tasf.backend.domain.PlanningResult;
import com.tasf.backend.domain.Vuelo;
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
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
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
        // 0. Build huso map: iata -> UTC offset, and flight lookup by code (for drain)
        Map<String, Integer> husoByIata = new HashMap<>();
        for (Aeropuerto a : dataLoaderService.getAeropuertos()) {
            husoByIata.put(a.getCodigoIATA(), a.getHuso());
        }
        Map<String, Vuelo> vueloByCodigo = new HashMap<>();
        for (Vuelo v : dataLoaderService.getVuelos()) {
            vueloByCodigo.put(v.getCodigoVuelo(), v);
        }

        // Current instant expressed as UTC minutes-of-day (frontend sends UTC).
        int nowMin = from.toLocalTime().getHour() * 60 + from.toLocalTime().getMinute();

        // 1. Warehouse occupation (drain model). Base count comes from a DB aggregate
        //    (GROUP BY in SQL — fast even on huge tables; never loads rows into memory),
        //    then we drain bags whose planned first leg has already departed. Plans live
        //    in memory and are few, so the drain loop is cheap.
        Map<String, Long> pendingByIata = new HashMap<>();
        for (Object[] row : opsEnvioRepository.sumMaletasPendientesByAeropuerto(from)) {
            pendingByIata.put((String) row[0], ((Number) row[1]).longValue());
        }
        for (PlanDeViaje plan : planesPorEnvio.values()) {
            if (plan.getEscalas() == null || plan.getEscalas().isEmpty()) {
                continue;
            }
            Escala first = plan.getEscalas().get(0);
            for (Escala esc : plan.getEscalas()) {
                if (esc.getOrden() < first.getOrden()) {
                    first = esc;
                }
            }
            Vuelo v = first.getCodigoVuelo() != null ? vueloByCodigo.get(first.getCodigoVuelo()) : null;
            if (v == null) {
                continue;
            }
            int depMin = v.getHoraSalida().getHour() * 60 + v.getHoraSalida().getMinute();
            int depUtcMin = Math.floorMod(depMin - husoByIata.getOrDefault(v.getOrigen(), 0) * 60, 1440);
            if (depUtcMin <= nowMin) {
                // First leg already left -> bag no longer in the origin warehouse.
                int maletas = maletasPorEnvio.getOrDefault(plan.getIdEnvio(), 0);
                pendingByIata.computeIfPresent(v.getOrigen(), (k, val) -> Math.max(0L, val - maletas));
            }
        }

        // 2. Build LiveAeropuertoDTO list
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

        // Store each plan in the in-memory map, plus its bag count for warehouse drain.
        for (EnvioEntity e : pendientes) {
            maletasPorEnvio.put(e.getIdPedido(), e.getCantidadMaletas());
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

            LocalDateTime fechaLocal;
            try {
                OffsetDateTime offsetDt = OffsetDateTime.parse(dto.getFechaHoraIngreso());
                // Store as local time (consistent with file-uploaded envíos)
                fechaLocal = offsetDt.toLocalDateTime();
            } catch (Exception ex) {
                // Already naive local time (from file preview)
                fechaLocal = LocalDateTime.parse(dto.getFechaHoraIngreso());
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
                    .iataOrigen(dto.getIataOrigen())
                    .iataDestino(dto.getIataDestino())
                    .cantidadMaletas(dto.getCantidadMaletas())
                    .fechaHoraIngreso(fechaLocal)
                    .sla(sla)
                    .estado("PENDIENTE")
                    .build();

            saved.add(opsEnvioRepository.save(entity));
        }
        return saved;
    }

    // -------------------------------------------------------------------------
    // 8. deleteEnvio
    // -------------------------------------------------------------------------

    @Transactional("opsTransactionManager")
    public void deleteEnvio(Long id) {
        opsEnvioRepository.deleteById(id);
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
