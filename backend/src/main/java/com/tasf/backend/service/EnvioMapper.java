package com.tasf.backend.service;

import com.tasf.backend.domain.Envio;
import com.tasf.backend.domain.EstadoEnvio;
import com.tasf.backend.entity.EnvioEntity;

/** EnvioEntity (BD, UTC) → Envio (dominio). Compartido por el controller y el motor de colapso. */
public final class EnvioMapper {
    private EnvioMapper() {}

    public static Envio fromEntity(EnvioEntity e) {
        return Envio.builder()
                .idEnvio(e.getIdPedido())
                .codigoAerolinea(e.getCodigoAerolinea())
                .aeropuertoOrigen(e.getIataOrigen())
                .aeropuertoDestino(e.getIataDestino())
                .fechaHoraIngreso(e.getFechaHoraIngreso())
                .cantidadMaletas(e.getCantidadMaletas())
                .sla(e.getSla())
                .estado(EstadoEnvio.valueOf(e.getEstado()))
                .build();
    }
}
