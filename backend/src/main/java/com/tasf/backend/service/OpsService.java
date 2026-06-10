package com.tasf.backend.service;

import com.tasf.backend.domain.Aeropuerto;
import com.tasf.backend.domain.Envio;
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
import java.util.List;
import java.util.Map;
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
        // 1. Build airport occupation map: iata -> pending bags
        List<Object[]> rows = opsEnvioRepository.sumMaletasPendientesByAeropuerto(from);
        log.info("Ops pending bags query returned {} rows", rows.size());
        Map<String, Long> pendingByIata = new HashMap<>();
        for (Object[] row : rows) {
            String iata = (String) row[0];
            Long count = ((Number) row[1]).longValue();
            pendingByIata.put(iata, count);
        }

        // 1b. Build huso map: iata -> UTC offset
        Map<String, Integer> husoByIata = new HashMap<>();
        for (Aeropuerto a : dataLoaderService.getAeropuertos()) {
            husoByIata.put(a.getCodigoIATA(), a.getHuso());
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
            ocupacionPct = Math.max(0.0, ocupacionPct);

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

        // 3. Filter flights active in window [nowMin, nowMin + 60]
        LocalTime nowTime = from.toLocalTime();
        int nowMin = nowTime.getHour() * 60 + nowTime.getMinute();
        int endMin = nowMin + 60;

        List<LiveVueloDTO> vueloDTOs = new ArrayList<>();
        for (Vuelo v : dataLoaderService.getVuelos()) {
            if (dataLoaderService.isFlightCancelledForSession(v.getCodigoVuelo())) {
                continue;
            }
            int depMin = v.getHoraSalida().getHour() * 60 + v.getHoraSalida().getMinute();
            int arrMin = v.getHoraLlegada().getHour() * 60 + v.getHoraLlegada().getMinute();

            boolean overnight = depMin > arrMin;
            boolean include = false;

            if (!overnight) {
                boolean inFlight = depMin <= nowMin && arrMin >= nowMin;
                boolean departingSoon;
                if (endMin <= 1440) {
                    departingSoon = depMin >= nowMin && depMin <= endMin;
                } else {
                    departingSoon = (depMin >= nowMin) || (depMin <= endMin - 1440);
                }
                include = inFlight || departingSoon;
            } else {
                boolean activeOvernight = nowMin >= depMin || nowMin < arrMin;
                boolean departingSoon;
                if (endMin <= 1440) {
                    departingSoon = depMin >= nowMin && depMin <= endMin;
                } else {
                    departingSoon = (depMin >= nowMin) || (depMin <= endMin - 1440);
                }
                include = activeOvernight || departingSoon;
            }

            if (!include) {
                continue;
            }

            int duration = (arrMin - depMin + 1440) % 1440;
            double fraction = 0.0;
            if (duration > 0) {
                boolean hasDeparted;
                if (!overnight) {
                    hasDeparted = nowMin >= depMin;
                } else {
                    hasDeparted = nowMin >= depMin || nowMin < arrMin;
                }
                if (hasDeparted) {
                    int elapsed = (nowMin - depMin + 1440) % 1440;
                    fraction = Math.max(0.0, Math.min(1.0, (double) elapsed / duration));
                }
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

        List<Envio> domainEnvios = pendientes.stream()
                .map(this::toDomain)
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

        // Store each plan in the in-memory map
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
    // Helper: toDomain
    // -------------------------------------------------------------------------

    private Envio toDomain(EnvioEntity e) {
        return Envio.builder()
                .idEnvio(e.getIdPedido())
                .aeropuertoOrigen(e.getIataOrigen())
                .aeropuertoDestino(e.getIataDestino())
                .cantidadMaletas(e.getCantidadMaletas())
                .fechaHoraIngreso(e.getFechaHoraIngreso())
                .sla(e.getSla())
                .estado(EstadoEnvio.valueOf(e.getEstado()))
                .build();
    }
}
