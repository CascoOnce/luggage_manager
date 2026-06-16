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
public class ParametrosSimulacion {
    private String algoritmo;
    private Integer dias;
    private int diasSimulacion;
    @Builder.Default
    private Boolean esColapso = false;
    @Builder.Default
    private int minutosEscalaMinima = 10;
    @Builder.Default
    private int minutosRecogidaDestino = 10;
    @Builder.Default
    private int umbralSemaforoVerde = 60;
    @Builder.Default
    private int umbralSemaforoAmbar = 85;
    private LocalDate fechaInicio;
    private String horaInicio; // HH:mm format, e.g. "08:30"
    @Builder.Default
    private double umbralColapsoPorcentajeSlaVencido = 50.0;
    @Builder.Default
    private double porcentajeCancelacionAleatoria = 0.0;
    /** Fracción de capacidad de almacén usada como tope blando (preferido, puede excederse si es necesario). El tope duro real (100%) se aplica por separado. */
    @Builder.Default
    private double capacidadBlandaFactor = 0.9;
}
