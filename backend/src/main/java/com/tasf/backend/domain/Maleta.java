package com.tasf.backend.domain;

import java.time.LocalDate;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Maleta {
    private String idMaleta;
    private String idEnvio;
    private String ubicacionActual;
    private EstadoMaleta estado;
    /** Fecha en que el envío ingresa al sistema; usada para no contar la maleta
     *  en el almacén antes de que su envío haya llegado físicamente. */
    private LocalDate fechaIngreso;
}
