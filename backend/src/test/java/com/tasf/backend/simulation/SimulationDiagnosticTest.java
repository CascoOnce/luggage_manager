package com.tasf.backend.simulation;

import com.tasf.backend.domain.Envio;
import com.tasf.backend.domain.EstadoEnvio;
import com.tasf.backend.domain.ParametrosSimulacion;
import com.tasf.backend.dto.AeropuertoDTO;
import com.tasf.backend.dto.KpisDTO;
import com.tasf.backend.dto.SimulationStateDTO;
import com.tasf.backend.repository.EnvioRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.List;

@SpringBootTest
@ActiveProfiles("local")
class SimulationDiagnosticTest {

    // ── Configuración ──────────────────────────────────────────────────────────
    private static final LocalDate FECHA_INICIO = LocalDate.of(2027, 6, 1);
    private static final String HORA_INICIO = "08:00";
    private static final int DIAS = 3;
    private static final String ALGORITMO = "SA";
    // ──────────────────────────────────────────────────────────────────────────

    @Autowired
    private SimulationEngine simulationEngine;

    @Autowired
    private EnvioRepository envioRepository;

    @BeforeEach
    void setUp() {
        simulationEngine.reset();
    }

    @Test
    void diagnosticoSimulacionCompleta() {
        LocalDateTime inicio = FECHA_INICIO.atTime(8, 0);
        LocalDateTime fin = FECHA_INICIO.plusDays(DIAS).atStartOfDay();

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

        System.out.println("\n╔══════════════════════════════════════════════════════════════╗");
        System.out.printf("║  DIAGNÓSTICO — %s  %s  %d días  alg=%s%n", FECHA_INICIO, HORA_INICIO, DIAS, ALGORITMO);
        System.out.printf("║  Envíos cargados de DB: %d%n", envios.size());
        System.out.println("╚══════════════════════════════════════════════════════════════╝");

        if (envios.isEmpty()) {
            System.out.println("  ⚠  Sin envíos para ese rango. Verifica fechas en la DB.");
            return;
        }

        ParametrosSimulacion params = ParametrosSimulacion.builder()
            .algoritmo(ALGORITMO)
            .fechaInicio(FECHA_INICIO)
            .horaInicio(HORA_INICIO)
            .dias(DIAS)
            .diasSimulacion(DIAS)
            .esColapso(false)
            .build();

        simulationEngine.inicializar(params, envios);
        imprimirEstado(simulationEngine.getEstado());

        for (int dia = 2; dia <= DIAS; dia++) {
            SimulationStateDTO estado = simulationEngine.avanzarDia();
            imprimirEstado(estado);
        }

        System.out.println("\n══════════════════════════════════════════════════════════════");
        System.out.println("  FIN SIMULACIÓN");
        System.out.println("══════════════════════════════════════════════════════════════\n");
    }

    private void imprimirEstado(SimulationStateDTO estado) {
        KpisDTO kpis = estado.getKpis();
        List<AeropuertoDTO> aeropuertos = estado.getAeropuertos();

        long planificados = estado.getEnvios().stream()
            .filter(e -> !e.getEstado().equals("PENDIENTE")).count();
        long pendientes = estado.getEnvios().stream()
            .filter(e -> e.getEstado().equals("PENDIENTE")).count();
        long entregados = estado.getEnvios().stream()
            .filter(e -> e.getEstado().equals("ENTREGADO")).count();
        long retrasados = estado.getEnvios().stream()
            .filter(e -> e.getEstado().equals("RETRASADO")).count();
        long sinRuta = estado.getEnvios().stream()
            .filter(e -> e.getEstado().equals("SIN_RUTA")).count();

        long batchLogs = estado.getLogOperaciones().stream()
            .filter(l -> l.contains("Rolling plan")).count();

        System.out.printf("%n┌─── DÍA %d (%s) ──────────────────────────────────────────────%n",
            estado.getDiaActual(), estado.getFechaSimulada());
        System.out.printf("│  Envíos total      : %d%n", estado.getEnvios().size());
        System.out.printf("│  Planificados      : %d%n", planificados);
        System.out.printf("│  Pendientes        : %d%n", pendientes);
        System.out.printf("│  Entregados        : %d%n", entregados);
        System.out.printf("│  Retrasados        : %d%n", retrasados);
        System.out.printf("│  Sin ruta          : %d%n", sinRuta);
        System.out.printf("│  Batches rolling   : %d%n", batchLogs);

        if (kpis != null) {
            System.out.printf("│  SLA cumplimiento  : %.1f%%%n", kpis.getCumplimientoSLA());
            System.out.printf("│  SLA vencidos      : %d%n", kpis.getSlaVencidos());
            System.out.printf("│  Maletas en tráns. : %d%n", kpis.getMaletasEnTransito());
            System.out.printf("│  Maletas entregadas: %d%n", kpis.getMaletasEntregadas());
            System.out.printf("│  Ocup. prom. almac.: %.1f%%%n", kpis.getOcupacionPromedioAlmacen());
        }

        System.out.println("│");
        System.out.println("│  Aeropuertos (top 8 por ocupación):");
        System.out.println("│  ┌──────────┬──────────────────┬──────────┬────────┬────────┐");
        System.out.println("│  │ IATA     │ Nombre           │  Ocup    │   Cap  │  %     │");
        System.out.println("│  ├──────────┼──────────────────┼──────────┼────────┼────────┤");

        aeropuertos.stream()
            .filter(a -> a.getCapacidadAlmacen() > 0)
            .sorted(Comparator.comparingDouble((AeropuertoDTO a) ->
                (double) a.getOcupacionActual() / a.getCapacidadAlmacen()).reversed())
            .limit(8)
            .forEach(a -> {
                double pct = a.getCapacidadAlmacen() > 0
                    ? (double) a.getOcupacionActual() / a.getCapacidadAlmacen() * 100 : 0;
                String alerta = pct > 100 ? " ❌" : pct > 90 ? " ⚠" : pct > 70 ? " ~" : "";
                System.out.printf("│  │ %-8s │ %-16s │ %8d │ %6d │ %5.1f%%%s%n",
                    a.getCodigoIATA(),
                    truncar(a.getNombre(), 16),
                    a.getOcupacionActual(),
                    a.getCapacidadAlmacen(),
                    pct,
                    alerta);
            });

        System.out.println("│  └──────────┴──────────────────┴──────────┴────────┴────────┘");

        long superanCap = aeropuertos.stream()
            .filter(a -> a.getCapacidadAlmacen() > 0
                && a.getOcupacionActual() > a.getCapacidadAlmacen())
            .count();
        if (superanCap > 0) {
            System.out.printf("│  ❌ %d aeropuerto(s) superan capacidad máxima (tope duro violado)%n", superanCap);
        }

        System.out.println("└──────────────────────────────────────────────────────────────");
    }

    private String truncar(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max - 1) + "…";
    }
}
