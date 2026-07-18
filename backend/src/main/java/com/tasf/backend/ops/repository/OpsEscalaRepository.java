package com.tasf.backend.ops.repository;

import com.tasf.backend.entity.EscalaEntity;
import com.tasf.backend.entity.EscalaEntityId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface OpsEscalaRepository extends JpaRepository<EscalaEntity, EscalaEntityId> {
    List<EscalaEntity> findByIdItinerarioOrderByOrden(String idItinerario);
}
