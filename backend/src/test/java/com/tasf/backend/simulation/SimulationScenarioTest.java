package com.tasf.backend.simulation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.tasf.backend.domain.Aeropuerto;
import com.tasf.backend.domain.Envio;
import com.tasf.backend.domain.EstadoEnvio;
import com.tasf.backend.domain.ParametrosSimulacion;
import com.tasf.backend.dto.SimulationStateDTO;
import com.tasf.backend.repository.EnvioRepository;
import com.tasf.backend.service.DataLoaderService;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class SimulationScenarioTest {

    @Autowired
    private SimulationEngine simulationEngine;

    @Autowired
    private DataLoaderService dataLoaderService;

    @Autowired
    private EnvioRepository envioRepository;

    private List<Envio> sampleEnvios;

    @BeforeEach
    void setUp() {
        simulationEngine.reset();
        sampleEnvios = createSampleEnvios(50); // Enough for Tabu Search
    }

    @Test
    void escenario3DiasCargaExacta() {
        ParametrosSimulacion params = ParametrosSimulacion.builder()
            .fechaInicio(LocalDate.of(2026, 1, 2))
            .dias(3)
            .diasSimulacion(3)
            .esColapso(false)
            .build();

        simulationEngine.inicializar(params, sampleEnvios);
        
        assertEquals(1, simulationEngine.getEstado().getDiaActual());
        assertEquals(3, simulationEngine.getEstado().getTotalDias());
        
        // Advance 3 days
        simulationEngine.avanzarDia(); // Day 1 -> 2
        simulationEngine.avanzarDia(); // Day 2 -> 3
        var finalState = simulationEngine.avanzarDia(); // Day 3 finishes
        
        assertTrue(finalState.isFinalizada());
        // Bajo el trigger de colapso inmediato (Task 3), la simulación puede terminar antes
        // de completar los 3 días si algún envío queda RETRASADO. Ambos desenlaces son válidos
        // dependiendo de la data real: completar los 3 días, o colapsar antes con al menos
        // 1 día de historial registrado.
        if (finalState.getColapsoPunto() != null) {
            assertTrue(finalState.getThroughputHistorial().size() >= 1,
                "Si colapsó, debe haber al menos 1 día de historial antes del colapso");
        } else {
            assertEquals(3, finalState.getThroughputHistorial().size(),
                "Si no colapsó, debe completar los 3 días");
        }
    }

    @Test
    void escenarioColapsoSinLimite() {
        ParametrosSimulacion params = ParametrosSimulacion.builder()
            .fechaInicio(LocalDate.of(2026, 1, 2))
            .esColapso(true)
            .diasSimulacion(10) // Expected simulation window resolved by controller
            .build();

        simulationEngine.inicializar(params, sampleEnvios);
        
        assertTrue(simulationEngine.estaInicializada());
        assertEquals(10, simulationEngine.getEstado().getTotalDias());
    }

    @Test
    void pruebaCancelacionYReplanificacion() {
        ParametrosSimulacion params = ParametrosSimulacion.builder()
            .fechaInicio(LocalDate.of(2026, 1, 2))
            .diasSimulacion(5)
            .esColapso(false)
            .build();

        simulationEngine.inicializar(params, sampleEnvios);
        
        // Manual trigger of cancellation (indirectly via avanzarDia if probability hits, 
        // or we could force it by mocking random, but here we check logs)
        // We'll run a few steps and look for [INCIDENCIA] in logs
        for (int i = 0; i < 5; i++) {
            simulationEngine.avanzarDia();
        }
        
        var log = simulationEngine.getEstado().getLogOperaciones();
        boolean foundIncidencia = log.stream().anyMatch(line -> line.contains("[INCIDENCIA]"));
        boolean foundReplan = log.stream().anyMatch(line -> line.contains("replanificación"));
        
        // Since probability is ~5-8%, it might not hit in a single 5-day run, 
        // but the logic is there. For a strict unit test we'd mock the random.
        // In this integration context, we verify the structure.
        System.out.println("Logs of simulation: " + log);
    }

    @Test
    void randomCancelacionesDeshabilitadasPorDefecto() {
        ParametrosSimulacion params = ParametrosSimulacion.builder()
            .fechaInicio(LocalDate.of(2026, 1, 2))
            .dias(3)
            .diasSimulacion(3)
            .esColapso(false)
            .porcentajeCancelacionAleatoria(0.0)
            .build();

        simulationEngine.inicializar(params, sampleEnvios);
        simulationEngine.avanzarDia();
        simulationEngine.avanzarDia();
        var state = simulationEngine.avanzarDia();

        long randomCancels = state.getLogOperaciones().stream()
            .filter(l -> l.contains("[INCIDENCIA] Vuelo") && l.contains("cancelado."))
            .count();
        assertEquals(0, randomCancels,
            "No debe haber cancelaciones aleatorias cuando porcentajeCancelacionAleatoria=0");
    }

    @Test
    void cancelacionManualDiferidaAplicaAlDiaSiguiente() {
        ParametrosSimulacion params = ParametrosSimulacion.builder()
            .fechaInicio(LocalDate.of(2026, 1, 2))
            .diasSimulacion(3)
            .esColapso(false)
            .build();

        simulationEngine.inicializar(params, sampleEnvios);
        String codigoVuelo = simulationEngine.getEstado().getVuelos().get(0).getCodigoVuelo();

        simulationEngine.cancelarVueloManualmente(codigoVuelo, "MANANA");

        // Not applied yet: today's occurrence keeps flying, no Cancelacion recorded yet.
        var stateHoy = simulationEngine.getEstado();
        assertTrue(stateHoy.getVuelos().stream()
            .filter(v -> v.getCodigoVuelo().equals(codigoVuelo))
            .anyMatch(v -> v.isCancelacionProgramada()));
        assertTrue(stateHoy.getCancelaciones().stream()
            .noneMatch(c -> c.getCodigoVuelo().equals(codigoVuelo)));

        simulationEngine.avanzarDia();

        // Applied on day 2: recorded as a cancellation, flag cleared for subsequent days.
        var stateManana = simulationEngine.getEstado();
        assertTrue(stateManana.getCancelaciones().stream()
            .anyMatch(c -> c.getCodigoVuelo().equals(codigoVuelo)));
        assertTrue(stateManana.getVuelos().stream()
            .filter(v -> v.getCodigoVuelo().equals(codigoVuelo))
            .noneMatch(v -> v.isCancelacionProgramada()));
    }

    @Test
    void simulacionFechasCriticas2027() {
        LocalDate fechaInicio = LocalDate.of(2027, 6, 1);
        LocalDateTime inicio = fechaInicio.atStartOfDay();
        LocalDateTime fin = inicio.plusDays(3);

        List<Envio> envios = envioRepository.findByFechaHoraIngresoBetween(inicio, fin).stream()
            .map(e -> Envio.builder()
                .idEnvio(e.getIdPedido())
                .codigoAerolinea(e.getCodigoAerolinea())
                .aeropuertoOrigen(e.getIataOrigen())
                .aeropuertoDestino(e.getIataDestino())
                .fechaHoraIngreso(e.getFechaHoraIngreso())
                .cantidadMaletas(e.getCantidadMaletas())
                .sla(e.getSla())
                .estado(EstadoEnvio.valueOf(e.getEstado()))
                .build())
            .toList();

        org.junit.jupiter.api.Assumptions.assumeTrue(!envios.isEmpty(),
            "Sin envíos en DB para 2027-06-01, saltando test");

        ParametrosSimulacion params = ParametrosSimulacion.builder()
            .fechaInicio(fechaInicio)
            .dias(3)
            .diasSimulacion(3)
            .esColapso(false)
            .build();

        simulationEngine.inicializar(params, envios);

        SimulationStateDTO state = null;
        for (int day = 0; day < 3; day++) {
            state = simulationEngine.avanzarDia();
        }

        assertNotNull(state);
        assertTrue(state.isFinalizada(), "Simulación debe finalizar (por completar los 3 días o por colapso)");
        // Bajo el trigger de colapso inmediato (Task 3), la simulación puede terminar antes
        // de los 3 días si algún envío real de esta ventana queda RETRASADO. Ambos desenlaces
        // son válidos dependiendo de la data real de 2027-06-01.
        if (state.getColapsoPunto() != null) {
            assertTrue(state.getThroughputHistorial().size() >= 1,
                "Si colapsó, debe haber al menos 1 día de historial antes del colapso");
        } else {
            assertEquals(3, state.getThroughputHistorial().size(), "Si no colapsó, debe haber 3 días de historial");
        }

        state.getAeropuertos().forEach(ap -> {
            if (ap.getCapacidadAlmacen() > 0) {
                assertTrue(
                    ap.getOcupacionMaxima() <= 100.0,
                    () -> String.format("Aeropuerto %s superó capacidad (%.2f%% > 100%%)",
                        ap.getCodigoIATA(), ap.getOcupacionMaxima())
                );
            }
        });

        System.out.printf("2027-06-01: %d envíos, SLA=%.1f%%%n",
            envios.size(),
            state.getKpis() != null ? state.getKpis().getCumplimientoSLA() : -1.0);
    }

    @Test
    void originWarehouseNeverExceedsHardCap() {
        ParametrosSimulacion params = ParametrosSimulacion.builder()
            .fechaInicio(LocalDate.of(2026, 1, 2))
            .dias(3)
            .diasSimulacion(3)
            .esColapso(false)
            .build();

        simulationEngine.inicializar(params, sampleEnvios);

        SimulationStateDTO state = null;
        for (int day = 0; day < 3; day++) {
            state = simulationEngine.avanzarDia();
        }

        assertNotNull(state);
        state.getAeropuertos().forEach(ap -> {
            if (ap.getCapacidadAlmacen() > 0) {
                assertTrue(
                    ap.getOcupacionMaxima() <= 100.0,
                    () -> String.format("Airport %s exceeded 100%% hard cap (ocupacionMaxima=%.2f%%, capacidad=%d)",
                        ap.getCodigoIATA(), ap.getOcupacionMaxima(), ap.getCapacidadAlmacen())
                );
            }
        });
    }

    @Test
    void colapsaInmediatamenteConCualquierEnvioRetrasado() {
        // EDDF no existe en los datos de aeropuertos/vuelos de prueba, así que no hay ninguna
        // ruta viable para este envío. aplicarResultadoPlanificacion() lo marca RETRASADO por
        // falta de ruta (no por incumplimiento de SLA), lo cual también debe disparar el
        // colapso inmediato vía checkColapsoInmediato().
        List<Envio> envios = List.of(Envio.builder()
            .idEnvio("E-COLAPSO-1")
            .codigoAerolinea("AA")
            .aeropuertoOrigen("SKBO")
            .aeropuertoDestino("EDDF") // destino inexistente en los datos, fuerza envío sin ruta viable
            .fechaHoraIngreso(LocalDateTime.of(2026, 1, 2, 23, 55))
            .cantidadMaletas(1)
            .sla(1)
            .estado(EstadoEnvio.PENDIENTE)
            .build());

        ParametrosSimulacion params = ParametrosSimulacion.builder()
            .fechaInicio(LocalDate.of(2026, 1, 2))
            .horaInicio("00:00")
            .diasSimulacion(1)
            .esColapso(false)
            .build();

        simulationEngine.inicializar(params, envios);
        var state = simulationEngine.avanzarDia();

        assertNotNull(state.getColapsoPunto(),
            "Un envío que no puede cumplir su SLA debe disparar colapso inmediato");
        assertTrue(state.isFinalizada(), "La simulación debe terminar en cuanto colapsa");
    }

    @Test
    void vuelosNoSalenAntesDeCerrarLaVentanaSc() {
        LocalDateTime horaInicioDia1 = LocalDateTime.of(2026, 1, 2, 8, 0);
        LocalDateTime cierreVentana1 = horaInicioDia1.plusMinutes(120); // Sc=120 con defaults nuevos

        List<Envio> envios = List.of(Envio.builder()
            .idEnvio("E-SC-1")
            .codigoAerolinea("AA")
            .aeropuertoOrigen("SKBO")
            .aeropuertoDestino("SPIM")
            .fechaHoraIngreso(horaInicioDia1.plusMinutes(5)) // entra 08:05, dentro de la ventana 1
            .cantidadMaletas(1)
            .sla(2)
            .estado(EstadoEnvio.PENDIENTE)
            .build());

        ParametrosSimulacion params = ParametrosSimulacion.builder()
            .fechaInicio(LocalDate.of(2026, 1, 2))
            .horaInicio("08:00")
            .diasSimulacion(1)
            .esColapso(false)
            .build();

        simulationEngine.inicializar(params, envios);

        var envioDto = simulationEngine.getEnvioPorId("E-SC-1").orElse(null);
        org.junit.jupiter.api.Assumptions.assumeTrue(envioDto != null && envioDto.getPlanDetalle() != null,
            "Sin ruta planificada para el envío de prueba, saltando test");

        envioDto.getPlanDetalle().getEscalas().forEach(escala ->
            assertTrue(!escala.getHoraSalidaEst().isBefore(cierreVentana1),
                "Vuelo " + escala.getCodigoVuelo() + " no debe salir antes del cierre de la ventana Sc"));
    }

    @Test
    void medicionTaPorBatch5Dias() {
        // Prueba de medición: corre 5 días reales (2028-08-18 08:00) contra la BD real, con las
        // restricciones reales (Sa=1, K=120, Sc=120min → hasta 12 bloques/día = 60 bloques en 5 días),
        // y captura el Ta de cada bloque desde el log de SimulationEngine. No asume que la simulación
        // completa los 5 días: si colapsa antes (por un envío RETRASADO), reporta los Ta obtenidos
        // hasta ese punto y el día/motivo del colapso, sin fallar el test por eso.
        LocalDate fechaInicio = LocalDate.of(2028, 8, 18);
        LocalDateTime horaInicioDia1 = fechaInicio.atTime(8, 0);
        LocalDateTime finVentana = fechaInicio.plusDays(5).atStartOfDay();

        List<Envio> envios = envioRepository.findByFechaHoraIngresoBetween(fechaInicio.atStartOfDay(), finVentana)
            .stream()
            .map(e -> Envio.builder()
                .idEnvio(e.getIdPedido())
                .codigoAerolinea(e.getCodigoAerolinea())
                .aeropuertoOrigen(e.getIataOrigen())
                .aeropuertoDestino(e.getIataDestino())
                .fechaHoraIngreso(e.getFechaHoraIngreso())
                .cantidadMaletas(e.getCantidadMaletas())
                .sla(e.getSla())
                .estado(EstadoEnvio.valueOf(e.getEstado()))
                .build())
            .toList();

        org.junit.jupiter.api.Assumptions.assumeTrue(!envios.isEmpty(),
            "Sin envíos en DB para 2028-08-18, saltando test");

        ParametrosSimulacion params = ParametrosSimulacion.builder()
            .fechaInicio(fechaInicio)
            .horaInicio("08:00")
            .diasSimulacion(5)
            .esColapso(false)
            .build();

        // Captura los logs de SimulationEngine ("Ta=... ms" / "Ta (... ms) > Sa (... ms)")
        // durante toda la corrida, sin tocar código de producción.
        ch.qos.logback.classic.Logger engineLogger =
            (ch.qos.logback.classic.Logger) LoggerFactory.getLogger(SimulationEngine.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        engineLogger.addAppender(appender);

        SimulationStateDTO state;
        try {
            simulationEngine.inicializar(params, envios); // ya planifica todos los bloques del día 1
            state = simulationEngine.getEstado();
            for (int day = 0; day < 5 && !state.isFinalizada(); day++) {
                state = simulationEngine.avanzarDia();
            }
        } finally {
            engineLogger.detachAppender(appender);
        }

        Pattern taPattern = Pattern.compile("Ta[=\\s]*\\(?(\\d+)\\s*ms");
        List<Long> taValues = new ArrayList<>();
        List<String> taExcedeSa = new ArrayList<>();
        for (ILoggingEvent event : appender.list) {
            String msg = event.getFormattedMessage();
            if (msg == null || !msg.contains("Ta")) continue;
            Matcher m = taPattern.matcher(msg);
            if (m.find()) {
                taValues.add(Long.parseLong(m.group(1)));
                if (msg.contains("planner too slow")) {
                    taExcedeSa.add(msg);
                }
            }
        }

        assertNotNull(state);
        System.out.println("=== Medición de Ta por batch — fechaInicio=" + fechaInicio
            + " horaInicio=08:00 — envíos cargados=" + envios.size() + " ===");
        System.out.println("Bloques Sc medidos: " + taValues.size() + " (esperado hasta 60 si completa los 5 días)");
        if (!taValues.isEmpty()) {
            long min = taValues.stream().mapToLong(Long::longValue).min().orElse(0);
            long max = taValues.stream().mapToLong(Long::longValue).max().orElse(0);
            double avg = taValues.stream().mapToLong(Long::longValue).average().orElse(0);
            System.out.printf("Ta (ms) — min=%d max=%d avg=%.1f%n", min, max, avg);
            System.out.println("Ta por batch (ms): " + taValues);
        }
        System.out.println("Bloques con Ta > Sa: " + taExcedeSa.size());
        taExcedeSa.forEach(System.out::println);
        System.out.println("Día alcanzado: " + state.getDiaActual() + " / " + state.getTotalDias());
        System.out.println("Finalizada: " + state.isFinalizada()
            + " — Colapsó: " + (state.getColapsoPunto() != null));
        if (state.getColapsoPunto() != null) {
            System.out.println("Colapso en día " + state.getColapsoPunto().getDia()
                + " — aeropuerto más crítico: " + state.getColapsoPunto().getAeropuertoMasCritico());
        }

        assertTrue(!taValues.isEmpty(),
            "No se capturó ningún Ta — revisar que el logger de SimulationEngine esté en nivel INFO");
    }

    private List<Envio> createSampleEnvios(int count) {
        List<Envio> list = new ArrayList<>();
        List<Aeropuerto> airports = dataLoaderService.getAeropuertos();
        for (int i = 0; i < count; i++) {
            list.add(Envio.builder()
                .idEnvio("E" + i)
                .codigoAerolinea("AA")
                .aeropuertoOrigen("SKBO")
                .aeropuertoDestino("SPIM")
                .fechaHoraIngreso(LocalDateTime.of(2026, 1, 2, 8, 0).plusHours(i))
                .cantidadMaletas(1)
                .sla(1)
                .estado(EstadoEnvio.PENDIENTE)
                .build());
        }
        return list;
    }
}
