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
public class LiveStateDTO {

    private List<LiveAeropuertoDTO> aeropuertos;
    private List<LiveVueloDTO> vuelos;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class LiveAeropuertoDTO {
        private String codigoIATA;
        private String nombre;
        private String ciudad;
        private String continente;
        private double lat;
        private double lng;
        private int capacidadAlmacen;
        private int maletasPendientes;
        private double ocupacionPct;
        private String semaforo;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class LiveVueloDTO {
        private String codigoVuelo;
        private String origen;
        private String destino;
        private String horaSalida;
        private String horaLlegada;
        private String tipo;
        private int capacidadTotal;
        private double fraction;
        private Integer husOrigen;
        private boolean enUso;
    }
}
