package com.tasf.backend.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AirportInventoryDTO {
    private String iata;
    private List<EnvioSummaryDTO> enAlmacen;
    private List<EnvioSummaryDTO> planificadosEntrando;
    private List<EnvioSummaryDTO> planificadosSaliendo;
}
