package com.tasf.backend.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OpsReporteDTO {
    private int totalEnvios;
    private int enviosPendientes;
    private int enviosEntregados;
    private int enviosViolados;
    private int totalMaletas;
    private double porcentajeCumplimientoSla;
    /** Timestamp del reporte en ISO-8601 UTC */
    private String generadoEn;
}
