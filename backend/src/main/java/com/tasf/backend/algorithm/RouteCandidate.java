package com.tasf.backend.algorithm;

import com.tasf.backend.domain.Escala;
import com.tasf.backend.domain.Envio;
import com.tasf.backend.domain.ParametrosSimulacion;
import com.tasf.backend.domain.PlanDeViaje;
import com.tasf.backend.domain.Vuelo;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

class RouteCandidate {
    private final List<Leg> legs;

    RouteCandidate(List<Leg> legs) {
        this.legs = Collections.unmodifiableList(new ArrayList<>(legs));
    }

    List<Leg> getLegs() {
        return legs;
    }

    LocalDateTime getFinalArrival() {
        return legs.get(legs.size() - 1).arrival();
    }

    String getPrimaryFlightCode() {
        return legs.get(0).flight().getCodigoVuelo();
    }

    String getSignature() {
        return legs.stream()
            .map(leg -> leg.flight().getCodigoVuelo())
            .collect(Collectors.joining("|"));
    }

    List<String> getIntermediateAirports() {
        if (legs.size() <= 1) {
            return List.of();
        }
        List<String> hubs = new ArrayList<>();
        for (int i = 0; i < legs.size() - 1; i++) {
            hubs.add(legs.get(i).flight().getDestino());
        }
        return hubs;
    }

    List<CapacityWindow> getCapacityWindows(LocalDateTime fechaIngreso) {
        if (legs.isEmpty()) return List.of();
        List<CapacityWindow> windows = new ArrayList<>();
        // Use day-granular boundaries: the simulation snapshots warehouse counts once per
        // day (start of day, before departures), so a bag occupies warehouse space for every
        // calendar day from its registration date through its departure date (inclusive).
        // Using midnight boundaries here makes the timeline peak match the simulation count.
        windows.add(new CapacityWindow(
            legs.get(0).flight().getOrigen(),
            fechaIngreso.toLocalDate().atStartOfDay(),
            legs.get(0).departure().toLocalDate().plusDays(1).atStartOfDay()
        ));
        for (int i = 0; i < legs.size() - 1; i++) {
            // Hub: bag arrives during day-N passes (AFTER the start-of-day snapshot), so
            // the first snapshot that counts it is day N+1. Departure is also post-snapshot,
            // so the last snapshot counting it is the departure day (to = departure+1 start).
            windows.add(new CapacityWindow(
                legs.get(i).flight().getDestino(),
                legs.get(i).arrival().toLocalDate().plusDays(1).atStartOfDay(),
                legs.get(i + 1).departure().toLocalDate().plusDays(1).atStartOfDay()
            ));
        }
        return windows;
    }

    PlanDeViaje toPlan(Envio envio, String algorithmName, int version, ParametrosSimulacion params) {
        List<Escala> escalas = new ArrayList<>();
        for (int i = 0; i < legs.size(); i++) {
            Leg leg = legs.get(i);
            escalas.add(Escala.builder()
                .orden(i + 1)
                .codigoAeropuerto(leg.flight().getDestino())
                .horaLlegadaEst(leg.arrival())
                .horaSalidaEst(leg.departure())
                .codigoVuelo(leg.flight().getCodigoVuelo())
                .completada(false)
                .build());
        }

        return PlanDeViaje.builder()
            .idPlan(envio.getIdEnvio() + "-v" + version)
            .idEnvio(envio.getIdEnvio())
            .version(Math.min(version, 5))
            .esActivo(true)
            .escalas(escalas)
            .fechaCreacion(LocalDateTime.now())
            .build();
    }

    record Leg(Vuelo flight, LocalDateTime departure, LocalDateTime arrival) {
    }

    record CapacityWindow(String airport, LocalDateTime from, LocalDateTime to) {
    }
}
