package com.tasf.backend.ops.repository;

import com.tasf.backend.entity.VueloEntity;
import org.springframework.data.jpa.repository.JpaRepository;

// Bound to the ops datasource (daily_simulation). Ops must read flights from the
// same schema operators edit, not the tasfb2b snapshot in DataLoaderService.
public interface OpsVueloRepository extends JpaRepository<VueloEntity, String> {
}
