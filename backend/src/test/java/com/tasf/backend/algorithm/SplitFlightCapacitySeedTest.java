package com.tasf.backend.algorithm;

import com.tasf.backend.domain.Aeropuerto;
import com.tasf.backend.domain.Envio;
import com.tasf.backend.domain.ParametrosSimulacion;
import com.tasf.backend.domain.PlanDeViaje;
import com.tasf.backend.domain.Vuelo;
import org.junit.jupiter.api.Test;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Regression guard for the split-shipment flight over-assignment bug.
 *
 * Symptom (reported): a 180-bag shipment splits 150+30; the 30 land on flight AA100.
 * A later, separately-planned 150-bag shipment was routed onto AA100 too, so the flight
 * showed 180/150 — capacity exceeded.
 *
 * Root cause: OpsService.planificar() re-plans only PENDIENTE shipments and seeded the SA
 * algorithm with an EMPTY flightLoads map, so the planner was blind to bags already committed
 * by earlier PLANIFICADO shipments. The fix seeds flightLoads from those committed plans (keyed
 * exactly like {@code SimulatedAnnealingAlgorithm.flightDayKey}: "codigoVuelo|departureDate").
 *
 * These tests lock the contract the fix relies on: a pre-seeded flightLoads entry must reduce the
 * capacity available to the shipment being planned.
 */
class SplitFlightCapacitySeedTest {

    private Vuelo directFlight() {
        return Vuelo.builder()
            .codigoVuelo("AA100")
            .origen("SKBO").destino("SPIM")
            .horaSalida(LocalTime.of(10, 0))
            .horaLlegada(LocalTime.of(14, 0))
            .capacidadTotal(150)
            .tipo("continental")
            .build();
    }

    private List<Aeropuerto> airports() {
        // Large warehouses so only flight capacity constrains the assignment under test.
        return List.of(
            Aeropuerto.builder().codigoIATA("SKBO").continente("SA").capacidadAlmacen(100000).huso(0).build(),
            Aeropuerto.builder().codigoIATA("SPIM").continente("SA").capacidadAlmacen(100000).huso(0).build()
        );
    }

    private Envio envio(String id, int bags) {
        return Envio.builder()
            .idEnvio(id)
            .aeropuertoOrigen("SKBO").aeropuertoDestino("SPIM")
            .fechaHoraIngreso(LocalDateTime.of(2024, 1, 1, 6, 0))
            .cantidadMaletas(bags)
            .sla(1)
            .build();
    }

    private ParametrosSimulacion params() {
        return ParametrosSimulacion.builder()
            .algoritmo("SIMULATED_ANNEALING")
            .minutosEscalaMinima(10)
            .minutosRecogidaDestino(15)
            .minutosPreparacionOrigen(10)
            .saMinutos(1).k(1)
            .build();
    }

    private int totalBags(List<PlanDeViaje> plans, String envioId) {
        return plans.stream()
            .filter(p -> p.getIdEnvio().equals(envioId))
            .mapToInt(PlanDeViaje::getCantidadMaletas)
            .sum();
    }

    @Test
    void emptySeed_assignsFullShipment() {
        SimulatedAnnealingAlgorithm algo = new SimulatedAnnealingAlgorithm();

        List<PlanDeViaje> plans = algo.planificarConEstado(
            List.of(envio("E1", 150)), List.of(directFlight()), airports(),
            params(), new AirportTimeline(), new HashMap<>());

        assertThat(totalBags(plans, "E1")).isEqualTo(150);
    }

    @Test
    void seededFlightLoad_capsSecondShipmentToRemainingCapacity() {
        SimulatedAnnealingAlgorithm algo = new SimulatedAnnealingAlgorithm();

        // 30 bags already committed to AA100's 2024-01-01 departure by an earlier shipment
        // that is NOT being re-planned in this batch. earliestDeparture = ingreso(06:00)+prep(10)
        // = 06:10 → nextDateTimeForFlight → 2024-01-01 10:00, so the key is "AA100|2024-01-01".
        Map<String, Integer> seed = new HashMap<>();
        seed.put("AA100|2024-01-01", 30);

        List<PlanDeViaje> plans = algo.planificarConEstado(
            List.of(envio("E2", 150)), List.of(directFlight()), airports(),
            params(), new AirportTimeline(), seed);

        // Only 120 seats remain (150 - 30). The shipment must NOT be over-assigned onto AA100.
        assertThat(totalBags(plans, "E2")).isEqualTo(120);
    }
}
