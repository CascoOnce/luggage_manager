package com.tasf.backend.dto;

import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EnvioSummaryDTO {
    private String idEnvio;
    private String aeropuertoOrigen;
    private String aeropuertoDestino;
    private int cantidadMaletas;
    private String estado;
    private String codigoVuelo;
    private String hora;
    /** SLA en días (1 mismo continente, 2 intercontinental). */
    private Integer sla;
    /** true si el envío tiene un plan de ruta calculado. */
    private Boolean planificado;
    /** Full route: [origin, stop1, ..., destination]. Present when planned. */
    private List<String> rutaCompleta;
}
