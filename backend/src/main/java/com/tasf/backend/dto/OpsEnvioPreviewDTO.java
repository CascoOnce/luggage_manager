package com.tasf.backend.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class OpsEnvioPreviewDTO {
    /** ID del pedido tal como viene del archivo (ej. "SKBO-000000001"). Null para ingresos manuales. */
    private String idPedido;
    private String iataOrigen;
    private String iataDestino;
    private int cantidadMaletas;
    /** ISO-8601 en hora local del aeropuerto origen, ej. "2026-06-13T10:00:00". */
    private String fechaHoraIngreso;
    private int sla;
}
