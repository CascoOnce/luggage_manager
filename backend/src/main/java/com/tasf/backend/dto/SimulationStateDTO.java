package com.tasf.backend.dto;

import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import com.tasf.backend.domain.ColapsoPunto;
import com.tasf.backend.domain.MetricaAlgoritmo;

@Data
@Builder(toBuilder = true)
@NoArgsConstructor
@AllArgsConstructor
public class SimulationStateDTO {
    private int diaActual;
    private int totalDias;
    private String fechaSimulada;
    private long diaInicioTimestampUtc;
    private int horaInicioMin;
    // Instant día 1 arranca (fechaInicio + horaInicio) y la duración de cada ventana Sc
    // (rolling-planning), en minutos — el frontend los usa para replicar scWindowEnd() y
    // ocultar "Planificado" hasta que la ventana Sc del envío haya cerrado.
    private String origenSimulacionUtc;
    private int scMinutos;
    private String algoritmo;
    private MetricaAlgoritmo metrica;
    private boolean enEjecucion;
    private boolean finalizada;
    private List<AeropuertoDTO> aeropuertos;
    private List<VueloDTO> vuelos;
    private List<EnvioDTO> envios;
    // Monotonic counter that changes whenever `envios` materially change (day advance,
    // (re)planning, cancellations). The frequently-polled /state omits the heavy envios
    // list and carries only this version; the frontend refetches /envios lazily when it
    // sees a new value, instead of shipping ~21k envios on every 2s poll.
    private long enviosVersion;
    private KpisDTO kpis;
    private List<ThroughputDiaDTO> throughputHistorial;
    private List<String> logOperaciones;
    private ColapsoPunto colapsoPunto;
    private List<CancelacionDTO> cancelaciones;
}
