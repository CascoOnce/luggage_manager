package com.tasf.backend.ops.repository;

import com.tasf.backend.entity.AeropuertoEntity;
import org.springframework.data.jpa.repository.JpaRepository;

// Bound to the ops datasource (daily_simulation) via OpsDataSourceConfig's
// @EnableJpaRepositories(basePackages = "com.tasf.backend.ops.repository").
// The main AeropuertoRepository reads capacity from tasfb2b, which drifts from
// the ops schema the operator actually edits — so ops occupancy must read here.
public interface OpsAeropuertoRepository extends JpaRepository<AeropuertoEntity, String> {
}
