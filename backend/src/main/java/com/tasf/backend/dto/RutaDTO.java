package com.tasf.backend.dto;

import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A single route (one PlanDeViaje version) an envío's bags take. An envío split across
 * several routes has several RutaDTOs (one per version); a single maleta follows exactly
 * the version matching its planVersion.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RutaDTO {
    private int version;
    private int cantidadMaletas;
    private String aeropuertoOrigen;
    private String aeropuertoDestino;
    private List<EscalaDetalleDTO> escalas;
}
