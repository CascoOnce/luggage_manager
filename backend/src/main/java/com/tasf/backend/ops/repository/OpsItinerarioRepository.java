package com.tasf.backend.ops.repository;

import com.tasf.backend.entity.ItinerarioEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface OpsItinerarioRepository extends JpaRepository<ItinerarioEntity, String> {

    /** Recupera el plan activo de un envío. */
    List<ItinerarioEntity> findByIdPedidoAndEsActivo(String idPedido, boolean esActivo);
}
