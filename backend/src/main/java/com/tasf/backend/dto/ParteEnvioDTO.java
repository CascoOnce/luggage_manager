package com.tasf.backend.dto;

import com.tasf.backend.domain.PlanDeViaje;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Una parte de un envío partido (split). El envío conserva un solo id/código de aerolínea; cada
 * parte lleva un rango contiguo de maletas (codenvío-{desde}…codenvío-{hasta}) por su propia ruta.
 * Cuando el envío no está partido, hay una sola parte con todo el rango.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ParteEnvioDTO {
    private int parteNo;
    private int totalPartes;
    private int cantidadMaletas;
    /** Rango de maletas de esta parte (1-based, inclusivo): codenvío-{maletaDesde}…codenvío-{maletaHasta}. */
    private int maletaDesde;
    private int maletaHasta;
    private String planResumen;
    private PlanDeViaje planDetalle;
}
