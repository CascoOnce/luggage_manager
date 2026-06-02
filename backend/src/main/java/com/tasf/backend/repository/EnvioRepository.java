package com.tasf.backend.repository;

import com.tasf.backend.entity.EnvioEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

public interface EnvioRepository extends JpaRepository<EnvioEntity, Long> {

    /**
     * Consulta envíos dentro de un rango de fechas de ingreso.
     * Usado por SimulationController para cargar solo los envíos del periodo simulado.
     */
    List<EnvioEntity> findByFechaHoraIngresoBetween(LocalDateTime desde, LocalDateTime hasta);

    /**
     * Verifica si ya existe un envío por su id_pedido de dominio.
     * Usado por el seeder y el upload para evitar duplicados.
     */
    boolean existsByIdPedido(String idPedido);

    /**
     * Carga en un solo query todos los envíos cuyos idPedido estén en el conjunto dado.
     * Usado por SimulationPersistenceService para evitar el O(n²) de findAll() en loop.
     */
    List<EnvioEntity> findByIdPedidoIn(Collection<String> ids);

    /**
     * Cuenta envíos por aeropuerto de origen — útil para seeder parcial.
     */
    @Query("SELECT COUNT(e) FROM EnvioEntity e WHERE e.iataOrigen = :iata")
    long countByIataOrigen(@Param("iata") String iata);

    /**
     * Suma cantidadMaletas pendientes (estado = 'PENDIENTE') por aeropuerto de origen,
     * filtrado por fechaHoraIngreso <= :from.
     * Usado por LiveService para calcular ocupación de almacenes en tiempo real.
     * Retorna List<Object[]> donde cada elemento es [String iataOrigen, Long sumMaletas].
     */
    @Query("SELECT e.iataOrigen, SUM(e.cantidadMaletas) FROM EnvioEntity e " +
           "WHERE e.estado = 'PENDIENTE' AND e.fechaHoraIngreso <= :from " +
           "GROUP BY e.iataOrigen")
    List<Object[]> sumMaletasPendientesByAeropuerto(@Param("from") LocalDateTime from);
}
