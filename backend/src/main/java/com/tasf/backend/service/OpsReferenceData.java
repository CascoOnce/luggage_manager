package com.tasf.backend.service;

import com.tasf.backend.domain.Aeropuerto;
import com.tasf.backend.domain.Vuelo;
import com.tasf.backend.ops.repository.OpsAeropuertoRepository;
import com.tasf.backend.ops.repository.OpsVueloRepository;
import jakarta.annotation.PostConstruct;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Airport + flight reference data read from the ops schema (daily_simulation),
 * mirroring DataLoaderService's tasfb2b transform. Ops must not read tasfb2b for
 * these: operators edit capacity (and potentially flights) only in daily_simulation,
 * so the tasfb2b snapshot drifts. Same huso→UTC flight-time conversion as
 * DataLoaderService.loadStaticDataFromDb so downstream time math is identical.
 */
@Service
public class OpsReferenceData {

    private final OpsAeropuertoRepository opsAeropuertoRepository;
    private final OpsVueloRepository opsVueloRepository;

    private volatile List<Aeropuerto> aeropuertos = List.of();
    private volatile List<Vuelo> vuelos = List.of();

    public OpsReferenceData(OpsAeropuertoRepository opsAeropuertoRepository,
                            OpsVueloRepository opsVueloRepository) {
        this.opsAeropuertoRepository = opsAeropuertoRepository;
        this.opsVueloRepository = opsVueloRepository;
    }

    @PostConstruct
    public void init() {
        reload();
    }

    // ponytail: reloads all ~30 airports + ~2900 flights on demand. Cheap enough for
    // the 2s occupancy poll; add change-detection only if it shows up in profiling.
    @Transactional(value = "opsTransactionManager", readOnly = true)
    public synchronized void reload() {
        this.aeropuertos = opsAeropuertoRepository.findAll().stream()
            .map(e -> Aeropuerto.builder()
                .codigoIATA(e.getCodigoIata())
                .nombre(e.getCiudad() + " Airport")
                .ciudad(e.getCiudad())
                .pais(e.getPais())
                .continente(e.getContinente())
                .huso(e.getHuso())
                .capacidadAlmacen(e.getCapacidadAlmacen())
                .lat(e.getLat())
                .lng(e.getLng())
                .build())
            .toList();

        Map<String, Integer> husoByAirport = this.aeropuertos.stream()
            .collect(Collectors.toMap(Aeropuerto::getCodigoIATA, Aeropuerto::getHuso));

        this.vuelos = opsVueloRepository.findAll().stream()
            .map(e -> {
                int husoOrigen = husoByAirport.getOrDefault(e.getIataOrigen(), 0);
                int husoDestino = husoByAirport.getOrDefault(e.getIataDestino(), 0);
                return Vuelo.builder()
                    .codigoVuelo(e.getCodigoVuelo())
                    .origen(e.getIataOrigen())
                    .destino(e.getIataDestino())
                    .horaSalida(e.getHoraSalida().minusHours(husoOrigen))
                    .horaLlegada(e.getHoraLlegada().minusHours(husoDestino))
                    .capacidadTotal(e.getCapacidadTotal())
                    .tipo(e.getTipo())
                    .build();
            })
            .toList();
    }

    public List<Aeropuerto> getAeropuertos() {
        return aeropuertos;
    }

    public List<Vuelo> getVuelos() {
        return vuelos;
    }
}
