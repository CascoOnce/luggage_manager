package com.tasf.backend.simulation;

import static org.assertj.core.api.Assertions.assertThat;

import com.tasf.backend.domain.Escala;
import com.tasf.backend.domain.OcupacionEvento;
import com.tasf.backend.domain.PlanDeViaje;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class WarehouseOccupationCalculatorTest {

    @Test
    void windowsForPlan_singleHop_coversOriginOnly_notDeliveredDestination() {
        // Single hop SKBO -> SPIM (SPIM is the final destination). The bag is delivered on
        // arrival at SPIM (processDeliveries removes it same-pass), so SPIM must NOT get an
        // occupancy window — only the origin, where the bag waits for its flight.
        LocalDateTime ingreso = LocalDateTime.of(2026, 7, 12, 0, 0);
        Escala escala = Escala.builder()
            .orden(1)
            .codigoAeropuerto("SPIM")
            .horaLlegadaEst(LocalDateTime.of(2026, 7, 12, 2, 0))
            .horaSalidaEst(LocalDateTime.of(2026, 7, 12, 1, 0))
            .codigoVuelo("XX100")
            .build();
        PlanDeViaje plan = PlanDeViaje.builder().idEnvio("E1").escalas(List.of(escala)).build();

        List<WarehouseOccupationCalculator.CapacityWindow> windows =
            WarehouseOccupationCalculator.windowsForPlan(plan, "SKBO", ingreso);

        assertThat(windows).hasSize(1);
        assertThat(windows.get(0).airport()).isEqualTo("SKBO");
        assertThat(windows.get(0).from()).isEqualTo(ingreso);
        assertThat(windows.get(0).to()).isEqualTo(escala.getHoraSalidaEst());
        // Regression guard: the final destination must never be emitted (it inflated
        // destination-only airports like LATI with an open-ended [arrival, ∞) window).
        assertThat(windows).noneMatch(w -> w.airport().equals("SPIM"));
    }

    @Test
    void windowsForPlan_twoHops_coversOriginAndHub_notDeliveredDestination() {
        LocalDateTime ingreso = LocalDateTime.of(2026, 7, 12, 0, 0);
        Escala hub = Escala.builder()
            .orden(1)
            .codigoAeropuerto("PANC")
            .horaLlegadaEst(LocalDateTime.of(2026, 7, 12, 2, 0))
            .horaSalidaEst(LocalDateTime.of(2026, 7, 12, 1, 0))
            .codigoVuelo("XX100")
            .build();
        Escala destino = Escala.builder()
            .orden(2)
            .codigoAeropuerto("SPIM")
            .horaLlegadaEst(LocalDateTime.of(2026, 7, 12, 6, 0))
            .horaSalidaEst(LocalDateTime.of(2026, 7, 12, 4, 0))
            .codigoVuelo("XX200")
            .build();
        PlanDeViaje plan = PlanDeViaje.builder().idEnvio("E2").escalas(List.of(hub, destino)).build();

        List<WarehouseOccupationCalculator.CapacityWindow> windows =
            WarehouseOccupationCalculator.windowsForPlan(plan, "SKBO", ingreso);

        // Origin + intermediate hub only; the delivered destination (SPIM) is not emitted.
        assertThat(windows).hasSize(2);

        assertThat(windows.get(0).airport()).isEqualTo("SKBO");
        assertThat(windows.get(0).from()).isEqualTo(ingreso);
        assertThat(windows.get(0).to()).isEqualTo(hub.getHoraSalidaEst());

        assertThat(windows.get(1).airport()).isEqualTo("PANC");
        assertThat(windows.get(1).from()).isEqualTo(hub.getHoraLlegadaEst());
        assertThat(windows.get(1).to()).isEqualTo(destino.getHoraSalidaEst());

        assertThat(windows).noneMatch(w -> w.airport().equals("SPIM"));
    }

    @Test
    void projectAirport_spimExample_matchesExpectedSteps() {
        // SPIM, capacity 200: +50@30min, +30@45min, +80@90min, +20@110min, all within day 1.
        LocalDateTime dayStart = LocalDateTime.of(2026, 7, 12, 0, 0);
        long dayStartEpoch = dayStart.toEpochSecond(ZoneOffset.UTC);
        long dayEndEpoch = dayStart.plusDays(1).toEpochSecond(ZoneOffset.UTC);
        List<long[]> events = List.of(
            new long[]{dayStartEpoch + 30 * 60, 50},
            new long[]{dayStartEpoch + 45 * 60, 30},
            new long[]{dayStartEpoch + 90 * 60, 80},
            new long[]{dayStartEpoch + 110 * 60, 20}
        );

        WarehouseOccupationCalculator.DayProjection proj = WarehouseOccupationCalculator.projectAirport(
            events, dayStartEpoch, dayEndEpoch, dayStartEpoch + 110 * 60);

        assertThat(proj.baseline()).isZero();
        assertThat(proj.eventos()).containsExactly(
            new OcupacionEvento(30, 50),
            new OcupacionEvento(45, 30),
            new OcupacionEvento(90, 80),
            new OcupacionEvento(110, 20)
        );
        assertThat(proj.ocupacionActual()).isEqualTo(180); // 50+30+80+20, 200 cap => 90%
    }

    @Test
    void projectAirport_carriesBaselineAcrossDayBoundary() {
        // A bag arrived day 1 at 23:50 and hasn't departed by day 2's start: baseline day 2 = 1.
        LocalDateTime day1Start = LocalDateTime.of(2026, 7, 12, 0, 0);
        LocalDateTime day2Start = day1Start.plusDays(1);
        long day1StartEpoch = day1Start.toEpochSecond(ZoneOffset.UTC);
        long day2StartEpoch = day2Start.toEpochSecond(ZoneOffset.UTC);
        long day2EndEpoch = day2Start.plusDays(1).toEpochSecond(ZoneOffset.UTC);
        List<long[]> events = List.of(
            new long[]{day1StartEpoch + 23 * 3600 + 50 * 60, 1} // arrives 23:50 day 1, still there
        );

        WarehouseOccupationCalculator.DayProjection proj = WarehouseOccupationCalculator.projectAirport(
            events, day2StartEpoch, day2EndEpoch, day2StartEpoch);

        assertThat(proj.baseline()).isEqualTo(1);
        assertThat(proj.eventos()).isEmpty();
        assertThat(proj.ocupacionActual()).isEqualTo(1);
    }
}
