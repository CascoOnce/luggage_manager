package com.tasf.backend.domain;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** A single warehouse-occupancy change within a simulated day: +delta bags arrive,
 *  -delta bags depart, at `minuto` minutes after local day start (0-1439). */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OcupacionEvento {
    private int minuto;
    private int delta;
}
