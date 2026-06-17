package com.tasf.backend.domain;

import java.time.LocalDate;
import java.time.LocalDateTime;
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
    /** Fecha y hora en que la maleta llegó a su ubicación actual. */
    private LocalDateTime fechaHoraLlegadaUbicacion;
    /** Versión del PlanDeViaje que rige la ruta de esta maleta (soporta envíos divididos en varias rutas). */
    @Builder.Default
    private int planVersion = 1;
}
