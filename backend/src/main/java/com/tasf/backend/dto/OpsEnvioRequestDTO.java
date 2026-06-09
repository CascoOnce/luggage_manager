package com.tasf.backend.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OpsEnvioRequestDTO {
    /** IATA del aeropuerto de origen (4 letras, ej. "SKBO") */
    private String iataOrigen;

    /** IATA del aeropuerto de destino (4 letras, ej. "LEMD") */
    private String iataDestino;

    /** Número de maletas del envío */
    private int cantidadMaletas;

    /**
     * Fecha y hora de ingreso en la zona horaria del aeropuerto origen.
     * Formato ISO-8601 con offset: "2026-06-08T14:30:00-05:00"
     * El backend convierte a UTC antes de persistir.
     */
    private String fechaHoraIngreso;
}
