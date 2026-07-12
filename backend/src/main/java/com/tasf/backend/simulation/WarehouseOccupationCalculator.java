package com.tasf.backend.simulation;

import com.tasf.backend.domain.Escala;
import com.tasf.backend.domain.OcupacionEvento;
import com.tasf.backend.domain.PlanDeViaje;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/** Pure, Spring-free projection of a shipment's assigned route into per-airport
 *  warehouse occupancy windows and day-scoped events. No DB/Spring dependency —
 *  fully unit-testable, and reused by SimulationEngine.updateWarehouseOccupation(). */
final class WarehouseOccupationCalculator {

    private WarehouseOccupationCalculator() {
    }

    /** A bag occupies `airport`'s warehouse during [from, to). `to == null` means it
     *  never leaves within any bounded horizon (still at its final destination). */
    record CapacityWindow(String airport, LocalDateTime from, LocalDateTime to) {
    }

    record DayProjection(int baseline, List<OcupacionEvento> eventos, int ocupacionActual) {
    }

    /** Mirrors RouteCandidate.getCapacityWindows()/toPlan(): escalas[i] is the leg landing
     *  at escalas[i].codigoAeropuerto at horaLlegadaEst, having departed the previous stop
     *  (or `origen` for i=0) at escalas[i].horaSalidaEst. */
    static List<CapacityWindow> windowsForPlan(PlanDeViaje plan, String origen, LocalDateTime fechaIngreso) {
        List<Escala> escalas = plan.getEscalas();
        if (escalas == null || escalas.isEmpty()) return List.of();

        List<CapacityWindow> windows = new ArrayList<>();
        windows.add(new CapacityWindow(origen, fechaIngreso, escalas.get(0).getHoraSalidaEst()));
        for (int i = 0; i < escalas.size() - 1; i++) {
            windows.add(new CapacityWindow(
                escalas.get(i).getCodigoAeropuerto(),
                escalas.get(i).getHoraLlegadaEst(),
                escalas.get(i + 1).getHoraSalidaEst()
            ));
        }
        Escala last = escalas.get(escalas.size() - 1);
        windows.add(new CapacityWindow(last.getCodigoAeropuerto(), last.getHoraLlegadaEst(), null));
        return windows;
    }

    /** `events` are raw {epochSecond, delta} pairs for one airport, any order.
     *  baseline = cumulative delta strictly before dayStartEpoch.
     *  eventos = events within [dayStartEpoch, dayEndEpoch), minute-relative to dayStartEpoch.
     *  ocupacionActual = cumulative delta up to and including nowEpoch. */
    static DayProjection projectAirport(List<long[]> events, long dayStartEpoch, long dayEndEpoch, long nowEpoch) {
        List<long[]> sorted = new ArrayList<>(events);
        sorted.sort((a, b) -> a[0] != b[0] ? Long.compare(a[0], b[0]) : Long.compare(a[1], b[1]));

        int baseline = 0;
        int ocupacionActual = 0;
        List<OcupacionEvento> eventos = new ArrayList<>();
        for (long[] e : sorted) {
            if (e[0] < dayStartEpoch) {
                baseline += (int) e[1];
            }
            if (e[0] <= nowEpoch) {
                ocupacionActual += (int) e[1];
            }
            if (e[0] >= dayStartEpoch && e[0] < dayEndEpoch) {
                eventos.add(new OcupacionEvento((int) ((e[0] - dayStartEpoch) / 60), (int) e[1]));
            }
        }
        return new DayProjection(baseline, eventos, Math.max(0, ocupacionActual));
    }
}
