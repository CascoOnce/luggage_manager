package com.tasf.backend.domain;

import java.util.ArrayList;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ColapsoPunto {
    private int dia;
    private double pctSlaVencido;
    private String aeropuertoMasCritico;
    @Builder.Default
    private List<String> topAeropuertos = new ArrayList<>();
}
