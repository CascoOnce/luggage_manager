package com.tasf.backend.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CancelacionDTO {
    private String id;
    private String codigoVuelo;
    private String fecha;
    private String hora;
    private String motivo;
    private int maletasAfectadas;
    private int enviosSinRuta;
    private String resultado;
}
