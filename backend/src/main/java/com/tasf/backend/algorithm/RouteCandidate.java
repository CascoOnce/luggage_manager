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
        // from = exact arrival datetime (bag only counted once it physically arrives).
        // to   = start of day AFTER departure: the daily snapshot runs before departures,
        //        so a bag departing on day D is still counted in day D's snapshot.
        windows.add(new CapacityWindow(
            legs.get(0).flight().getOrigen(),
            fechaIngreso,
            legs.get(0).departure().toLocalDate().plusDays(1).atStartOfDay()
        ));
        for (int i = 0; i < legs.size() - 1; i++) {
            windows.add(new CapacityWindow(
                legs.get(i).flight().getDestino(),
                legs.get(i).arrival(),
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
