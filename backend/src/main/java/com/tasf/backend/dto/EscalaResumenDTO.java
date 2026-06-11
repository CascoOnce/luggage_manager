package com.tasf.backend.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EscalaResumenDTO {
    private String horaSalidaEst;
    private String horaLlegadaEst;
    private boolean esUltima;
}
