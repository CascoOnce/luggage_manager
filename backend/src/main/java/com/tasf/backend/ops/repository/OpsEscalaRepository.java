package com.tasf.backend.ops.repository;

import com.tasf.backend.entity.EscalaEntity;
import com.tasf.backend.entity.EscalaEntityId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;

import java.util.Collection;
import java.util.List;

public interface OpsEscalaRepository extends JpaRepository<EscalaEntity, EscalaEntityId> {
    List<EscalaEntity> findByIdItinerarioOrderByOrden(String idItinerario);

    /**
     * Bulk-delete every escala of the given itinerarios. Used before re-persisting a
     * re-planned itinerario so stale legs from a previous (longer) route can't survive
     * a saveAll upsert that only overwrites lower orden values.
     */
    @Modifying
    void deleteByIdItinerarioIn(Collection<String> idItinerarios);
}
