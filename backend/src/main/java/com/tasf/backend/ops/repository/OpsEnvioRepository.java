package com.tasf.backend.ops.repository;

import com.tasf.backend.entity.EnvioEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface OpsEnvioRepository extends JpaRepository<EnvioEntity, Long> {

    boolean existsByIdPedido(String idPedido);

    @Query("SELECT e.iataOrigen, SUM(e.cantidadMaletas) FROM EnvioEntity e " +
           "WHERE e.estado = 'PENDIENTE' AND e.fechaHoraIngreso <= :from " +
           "GROUP BY e.iataOrigen")
    List<Object[]> sumMaletasPendientesByAeropuerto(@Param("from") LocalDateTime from);

    @Query("SELECT e FROM EnvioEntity e WHERE e.estado = 'PENDIENTE' ORDER BY e.fechaHoraIngreso ASC")
    List<EnvioEntity> findAllPendientesOrdenados();

    List<EnvioEntity> findAllByOrderByFechaHoraIngresoDesc();

    long countByIataOrigen(String iataOrigen);

    List<EnvioEntity> findAllByEstadoAndIataOrigen(String estado, String iataOrigen);
}
