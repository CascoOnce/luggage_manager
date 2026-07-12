package com.tasf.backend.domain;

import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Aeropuerto {
    private String codigoIATA;
    private String nombre;
    private String ciudad;
    private String pais;
    private String continente;
    private int huso;
    private int capacidadAlmacen;
    private double lat;
    private double lng;
    @Builder.Default
    private int ocupacionActual = 0;
    @Builder.Default
    private int maletasRecibidas = 0;
    @Builder.Default
    private int maletasEnviadas = 0;
    @Builder.Default
    private double ocupacionPorcentajeSuma = 0.0;
    @Builder.Default
    private int ocupacionMuestras = 0;
    @Builder.Default
    private int ocupacionMaximaBolsas = 0;
    /** Real cumulative warehouse stock carried over to the start of the current simulated
     *  day (not a projected peak) — see WarehouseOccupationCalculator.projectAirport(). */
    @Builder.Default
    private int ocupacionInicioDia = 0;
    @Builder.Default
    private List<OcupacionEvento> eventosOcupacionDia = List.of();
}
