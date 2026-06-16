package com.tasf.backend.algorithm;

import com.tasf.backend.domain.Vuelo;
import org.junit.jupiter.api.Test;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class RouteCandidateCapacityTest {

    @Test
    void directFlight_returnsSingleOriginWindow() {
        LocalDateTime fechaIngreso = LocalDateTime.of(2024, 1, 1, 6, 0);
        LocalDateTime departure = LocalDateTime.of(2024, 1, 1, 10, 0);
        LocalDateTime arrival = LocalDateTime.of(2024, 1, 1, 14, 0);

        Vuelo flight = Vuelo.builder()
            .codigoVuelo("AA100")
            .origen("SKBO")
            .destino("SPIM")
            .horaSalida(LocalTime.of(10, 0))
            .horaLlegada(LocalTime.of(14, 0))
            .capacidadTotal(300)
            .tipo("internacional")
            .build();

        RouteCandidate.Leg leg = new RouteCandidate.Leg(flight, departure, arrival);
        RouteCandidate route = new RouteCandidate(List.of(leg));

        List<RouteCandidate.CapacityWindow> windows = route.getCapacityWindows(fechaIngreso);

        assertThat(windows).hasSize(1);
        RouteCandidate.CapacityWindow w0 = windows.get(0);
        assertThat(w0.airport()).isEqualTo("SKBO");
        assertThat(w0.from()).isEqualTo(fechaIngreso);
        assertThat(w0.to()).isEqualTo(departure);
    }

    @Test
    void oneStopRoute_returnsOriginAndHubWindows() {
        LocalDateTime fechaIngreso = LocalDateTime.of(2024, 1, 1, 6, 0);

        LocalDateTime dep0 = LocalDateTime.of(2024, 1, 1, 10, 0);
        LocalDateTime arr0 = LocalDateTime.of(2024, 1, 1, 14, 0);
        LocalDateTime dep1 = LocalDateTime.of(2024, 1, 1, 18, 0);
        LocalDateTime arr1 = LocalDateTime.of(2024, 1, 1, 22, 0);

        Vuelo flight0 = Vuelo.builder()
            .codigoVuelo("AA100")
            .origen("SKBO")
            .destino("MMMX")
            .horaSalida(LocalTime.of(10, 0))
            .horaLlegada(LocalTime.of(14, 0))
            .capacidadTotal(300)
            .tipo("internacional")
            .build();

        Vuelo flight1 = Vuelo.builder()
            .codigoVuelo("AA200")
            .origen("MMMX")
            .destino("SPIM")
            .horaSalida(LocalTime.of(18, 0))
            .horaLlegada(LocalTime.of(22, 0))
            .capacidadTotal(300)
            .tipo("internacional")
            .build();

        RouteCandidate.Leg leg0 = new RouteCandidate.Leg(flight0, dep0, arr0);
        RouteCandidate.Leg leg1 = new RouteCandidate.Leg(flight1, dep1, arr1);
        RouteCandidate route = new RouteCandidate(List.of(leg0, leg1));

        List<RouteCandidate.CapacityWindow> windows = route.getCapacityWindows(fechaIngreso);

        assertThat(windows).hasSize(2);

        RouteCandidate.CapacityWindow w0 = windows.get(0);
        assertThat(w0.airport()).isEqualTo("SKBO");
        assertThat(w0.from()).isEqualTo(fechaIngreso);
        assertThat(w0.to()).isEqualTo(dep0);

        RouteCandidate.CapacityWindow w1 = windows.get(1);
        assertThat(w1.airport()).isEqualTo("MMMX");
        assertThat(w1.from()).isEqualTo(arr0);
        assertThat(w1.to()).isEqualTo(dep1);
    }
}
