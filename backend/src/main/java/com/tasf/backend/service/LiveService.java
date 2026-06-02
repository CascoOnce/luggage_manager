package com.tasf.backend.service;

import com.tasf.backend.domain.Aeropuerto;
import com.tasf.backend.domain.Vuelo;
import com.tasf.backend.dto.LiveStateDTO;
import com.tasf.backend.dto.LiveStateDTO.LiveAeropuertoDTO;
import com.tasf.backend.dto.LiveStateDTO.LiveVueloDTO;
import com.tasf.backend.repository.EnvioRepository;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class LiveService {

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("HH:mm");

    private final DataLoaderService dataLoaderService;
    private final EnvioRepository envioRepository;

    public LiveService(DataLoaderService dataLoaderService, EnvioRepository envioRepository) {
        this.dataLoaderService = dataLoaderService;
        this.envioRepository = envioRepository;
    }

    public LiveStateDTO getLiveState(LocalDateTime from) {
        // 1. Build airport occupation map: iata -> pending bags
        List<Object[]> rows = envioRepository.sumMaletasPendientesByAeropuerto(from);
        Map<String, Long> pendingByIata = new HashMap<>();
        for (Object[] row : rows) {
            String iata = (String) row[0];
            Long count = ((Number) row[1]).longValue();
            pendingByIata.put(iata, count);
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

        // 3. Filter flights active in window [nowMin, nowMin + 60]
        LocalTime nowTime = from.toLocalTime();
        int nowMin = nowTime.getHour() * 60 + nowTime.getMinute();
        int endMin = nowMin + 60;

        List<LiveVueloDTO> vueloDTOs = new ArrayList<>();
        for (Vuelo v : dataLoaderService.getVuelos()) {
            int depMin = v.getHoraSalida().getHour() * 60 + v.getHoraSalida().getMinute();
            int arrMin = v.getHoraLlegada().getHour() * 60 + v.getHoraLlegada().getMinute();

            boolean overnight = depMin > arrMin;
            boolean include = false;

            if (!overnight) {
                // Normal flight: in-flight if depMin <= nowMin && arrMin >= nowMin
                boolean inFlight = depMin <= nowMin && arrMin >= nowMin;
                // Departing soon: check current-day window and next-day spillover
                boolean departingSoon;
                if (endMin <= 1440) {
                    departingSoon = depMin >= nowMin && depMin <= endMin;
                } else {
                    // window crosses midnight
                    departingSoon = (depMin >= nowMin) || (depMin <= endMin - 1440);
                }
                include = inFlight || departingSoon;
            } else {
                // Overnight: active if nowMin >= depMin OR nowMin < arrMin, or departing soon
                boolean activeOvernight = nowMin >= depMin || nowMin < arrMin;
                boolean departingSoon;
                if (endMin <= 1440) {
                    departingSoon = depMin >= nowMin && depMin <= endMin;
                } else {
                    // window crosses midnight
                    departingSoon = (depMin >= nowMin) || (depMin <= endMin - 1440);
                }
                include = activeOvernight || departingSoon;
            }

            if (!include) {
                continue;
            }

            // Calculate flight progress fraction
            int duration = (arrMin - depMin + 1440) % 1440;
            double fraction = 0.0;
            if (duration > 0) {
                // Only set fraction > 0 if flight has already departed
                boolean hasDeparted;
                if (!overnight) {
                    hasDeparted = nowMin >= depMin;
                } else {
                    // Overnight: has departed if nowMin >= depMin OR flight rolled over midnight
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
                    .build());
        }

        return LiveStateDTO.builder()
                .aeropuertos(aeropuertoDTOs)
                .vuelos(vueloDTOs)
                .build();
    }
}
