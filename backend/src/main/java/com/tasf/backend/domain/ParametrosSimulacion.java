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
    
    // For Ops Mode: Current time to prevent scheduling flights in the past
    private LocalDateTime currentTimeUtc;
    @Builder.Default
    private double umbralColapsoPorcentajeSlaVencido = 50.0;
    @Builder.Default
    private double porcentajeCancelacionAleatoria = 0.0;
    /** Fracción de capacidad de almacén usada como tope blando (preferido, puede excederse si es necesario). El tope duro real (100%) se aplica por separado. */
    @Builder.Default
    private double capacidadBlandaFactor = 0.9;
    /** Duración en minutos de cada ventana de planificación del SA (rolling-planning).
     *  Sa=1min con Ta≈30s medido da margen 2x — ver docs/superpowers/plans/2026-07-10-sa-sc-colapso-correction.md */
    @Builder.Default
    private int saMinutos = 1;
    /** Número de ventanas SA que componen un ciclo completo (SC = k × saMinutos).
     *  K=120 calibrado para Tmax=60min real con 5 días simulados (K = 7200min / Tmax). */
    @Builder.Default
    private int k = 120;
    /** Duración total en minutos de un ciclo de planificación (SC). */
    public int getScMinutos() {
        return k * saMinutos;
    }
}
