package com.tasf.backend.repository;

import com.tasf.backend.entity.EscalaEntity;
import com.tasf.backend.entity.EscalaEntityId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface EscalaRepository extends JpaRepository<EscalaEntity, EscalaEntityId> {
    List<EscalaEntity> findByIdItinerarioOrderByOrden(String idItinerario);
}
