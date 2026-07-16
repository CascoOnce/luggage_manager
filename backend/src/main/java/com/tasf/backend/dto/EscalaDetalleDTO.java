package com.tasf.backend.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One leg of a route with the data relevant for showing it on the map on demand:
 * flight code, origin/destination airports and estimated departure/arrival times.
 * Leg origin is derived (envío origin for the first leg, previous stop otherwise) since
 * the domain {@code Escala} only stores the leg's destination.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EscalaDetalleDTO {
    private int orden;
    private String codigoVuelo;
    private String aeropuertoOrigen;
    private String aeropuertoDestino;
    private String horaSalidaEst;
    private String horaLlegadaEst;
    private boolean completada;
}
