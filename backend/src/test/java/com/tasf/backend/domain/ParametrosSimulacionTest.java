package com.tasf.backend.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class ParametrosSimulacionTest {

    @Test
    void defaultsDeSaYKReflejanCalibracionTmax60() {
        ParametrosSimulacion params = ParametrosSimulacion.builder().build();

        assertEquals(1, params.getSaMinutos(), "Sa debe ser 1 minuto (2x margen sobre Ta≈30s)");
        assertEquals(120, params.getK(), "K=120 calibrado para Tmax=60min con 5 días simulados (K=7200/60)");
        assertEquals(120, params.getScMinutos(), "Sc = K × Sa = 120 × 1 = 120 min");
    }
}
