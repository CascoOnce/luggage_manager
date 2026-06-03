package com.tasf.backend.service;

import com.tasf.backend.domain.PlanDeViaje;
import com.tasf.backend.domain.MetricaAlgoritmo;
import com.tasf.backend.entity.ItinerarioEntity;
import com.tasf.backend.entity.EscalaEntity;
import com.tasf.backend.entity.MetricaEjecucionEntity;
import com.tasf.backend.entity.LogOperacionEntity;
import com.tasf.backend.entity.EnvioEntity;
import com.tasf.backend.repository.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class SimulationPersistenceService {
    private static final Logger log = LoggerFactory.getLogger(SimulationPersistenceService.class);

    private final ItinerarioRepository itinerarioRepository;
    private final MetricaEjecucionRepository metricaRepository;
    private final LogOperacionRepository logRepository;
    private final EnvioRepository envioRepository;
    private final EscalaRepository escalaRepository;

    public SimulationPersistenceService(
            ItinerarioRepository itinerarioRepository,
            MetricaEjecucionRepository metricaRepository,
            LogOperacionRepository logRepository,
            EnvioRepository envioRepository,
            EscalaRepository escalaRepository) {
        this.itinerarioRepository = itinerarioRepository;
        this.metricaRepository = metricaRepository;
        this.logRepository = logRepository;
        this.envioRepository = envioRepository;
        this.escalaRepository = escalaRepository;
    }

    @Async
    @Transactional
    public void persistSimulationResults(
            List<PlanDeViaje> planes,
            List<MetricaAlgoritmo> metricas,
            List<String> logOperaciones,
            List<com.tasf.backend.domain.Envio> domainEnvios) {
        
        log.info("Persisting simulation results to database...");

        // 1. Persistir Itinerarios y Escalas — batch para evitar N roundtrips individuales
        List<ItinerarioEntity> itinerarios = new ArrayList<>();
        List<EscalaEntity> todasLasEscalas = new ArrayList<>();

        for (PlanDeViaje plan : planes) {
            String idItinerario = plan.getIdEnvio() + "-v" + plan.getVersion();
            itinerarios.add(ItinerarioEntity.builder()
                .idItinerario(idItinerario)
                .idPedido(plan.getIdEnvio())
                .version(plan.getVersion())
                .esActivo(true)
                .fechaCreacion(LocalDateTime.now())
                .build());

            for (int i = 0; i < plan.getEscalas().size(); i++) {
                var esc = plan.getEscalas().get(i);
                todasLasEscalas.add(EscalaEntity.builder()
                    .idItinerario(idItinerario)
                    .orden(i + 1)
                    .codigoVuelo(esc.getCodigoVuelo())
                    .iataEscala(esc.getCodigoAeropuerto())
                    .horaSalidaEst(esc.getHoraSalidaEst())
                    .horaLlegadaEst(esc.getHoraLlegadaEst())
                    .completada(true)
                    .build());
            }
        }

        itinerarioRepository.saveAll(itinerarios);
        escalaRepository.saveAll(todasLasEscalas);

        // 2. Persistir Métricas — batch
        List<MetricaEjecucionEntity> metricaEntities = metricas.stream()
            .map(m -> MetricaEjecucionEntity.builder()
                .idMetrica("MET-" + System.nanoTime())
                .idItinerario(null)
                .rutasEvaluadas(m.getRutasEvaluadas())
                .tiempoMs(m.getTiempoEjecucionMs())
                .exito(true)
                .fechaEjecucion(LocalDateTime.now())
                .build())
            .toList();
        metricaRepository.saveAll(metricaEntities);

        // 3. Persistir Logs
        List<LogOperacionEntity> logEntities = logOperaciones.stream()
            .map(line -> LogOperacionEntity.builder()
                .tipoEvento("SIMULATION_EVENT")
                .descripcion(line)
                .fechaHora(LocalDateTime.now())
                .build())
            .toList();
        logRepository.saveAll(logEntities);

        // 4. Actualizar estado de los envíos en la DB — un SELECT con IN + saveAll
        Set<String> ids = domainEnvios.stream()
            .map(com.tasf.backend.domain.Envio::getIdEnvio)
            .collect(Collectors.toSet());

        Map<String, EnvioEntity> existingByPedido = envioRepository.findByIdPedidoIn(ids)
            .stream()
            .collect(Collectors.toMap(EnvioEntity::getIdPedido, e -> e));

        List<EnvioEntity> toSave = new ArrayList<>();
        for (com.tasf.backend.domain.Envio de : domainEnvios) {
            EnvioEntity entity = existingByPedido.get(de.getIdEnvio());
            if (entity != null) {
                entity.setEstado(de.getEstado().name());
            } else {
                entity = EnvioEntity.builder()
                    .idPedido(de.getIdEnvio())
                    .codigoAerolinea(de.getCodigoAerolinea())
                    .iataOrigen(de.getAeropuertoOrigen())
                    .iataDestino(de.getAeropuertoDestino())
                    .cantidadMaletas(de.getCantidadMaletas())
                    .fechaHoraIngreso(de.getFechaHoraIngreso())
                    .sla(de.getSla())
                    .estado(de.getEstado().name())
                    .build();
            }
            toSave.add(entity);
        }
        envioRepository.saveAll(toSave);

        envioRepository.resetAllToPendiente();

        log.info("Simulation results persisted successfully.");
    }
}
