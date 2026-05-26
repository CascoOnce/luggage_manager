package com.tasf.backend.service;

import com.tasf.backend.domain.Aeropuerto;
import com.tasf.backend.domain.Vuelo;
import com.tasf.backend.entity.AeropuertoEntity;
import com.tasf.backend.entity.VueloEntity;
import com.tasf.backend.parser.AirportParser;
import com.tasf.backend.parser.FlightParser;
import com.tasf.backend.repository.AeropuertoRepository;
import com.tasf.backend.repository.VueloRepository;
import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

@Service
public class DataLoaderService {
    private static final Logger log = LoggerFactory.getLogger(DataLoaderService.class);

    private final AeropuertoRepository aeropuertoRepository;
    private final VueloRepository vueloRepository;
    private final AirportParser airportParser;
    private final FlightParser flightParser;

    private List<Aeropuerto> aeropuertos = new ArrayList<>();
    private List<Vuelo> vuelos = new ArrayList<>();

    public DataLoaderService(
            AeropuertoRepository aeropuertoRepository,
            VueloRepository vueloRepository,
            AirportParser airportParser,
            FlightParser flightParser) {
        this.aeropuertoRepository = aeropuertoRepository;
        this.vueloRepository = vueloRepository;
        this.airportParser = airportParser;
        this.flightParser = flightParser;
    }

    @PostConstruct
    public void init() {
        seedDatabaseIfEmpty();
        loadStaticDataFromDb();
    }

    private void seedDatabaseIfEmpty() {
        if (aeropuertoRepository.count() > 0) {
            return;
        }
        log.info("Database is empty — seeding airports and flights from bundled data files...");
        try {
            // Seed airports
            InputStream airportsStream = new ClassPathResource("data/aeropuertos.txt").getInputStream();
            List<Aeropuerto> parsedAirports = airportParser.parseAirports(airportsStream);
            List<AeropuertoEntity> airportEntities = parsedAirports.stream()
                .map(a -> AeropuertoEntity.builder()
                    .codigoIata(a.getCodigoIATA())
                    .ciudad(a.getCiudad())
                    .pais(a.getPais())
                    .continente(a.getContinente())
                    .huso(a.getHuso())
                    .capacidadAlmacen(a.getCapacidadAlmacen())
                    .lat(a.getLat())
                    .lng(a.getLng())
                    .build())
                .toList();
            aeropuertoRepository.saveAll(airportEntities);
            log.info("Seeded {} airports", airportEntities.size());

            // Seed flights
            Map<String, String> continentByAirport = parsedAirports.stream()
                .collect(Collectors.toMap(Aeropuerto::getCodigoIATA, Aeropuerto::getContinente));
            InputStream flightsStream = new ClassPathResource("data/planes_vuelo.txt").getInputStream();
            List<Vuelo> parsedFlights = flightParser.parseFlights(flightsStream, continentByAirport);
            List<VueloEntity> flightEntities = parsedFlights.stream()
                .map(v -> VueloEntity.builder()
                    .codigoVuelo(v.getCodigoVuelo())
                    .iataOrigen(v.getOrigen())
                    .iataDestino(v.getDestino())
                    .horaSalida(v.getHoraSalida())
                    .horaLlegada(v.getHoraLlegada())
                    .capacidadTotal(v.getCapacidadTotal())
                    .tipo(v.getTipo())
                    .build())
                .toList();
            vueloRepository.saveAll(flightEntities);
            log.info("Seeded {} flights", flightEntities.size());
        } catch (IOException e) {
            throw new IllegalStateException("Failed to seed database from bundled data files", e);
        }
    }

    private void loadStaticDataFromDb() {
        log.info("Loading static data from database...");
        
        this.aeropuertos = aeropuertoRepository.findAll().stream()
            .map(e -> Aeropuerto.builder()
                .codigoIATA(e.getCodigoIata())
                .nombre(e.getCiudad() + " Airport") // Mantenemos la lógica del parser original
                .ciudad(e.getCiudad())
                .pais(e.getPais())
                .continente(e.getContinente())
                .huso(e.getHuso())
                .capacidadAlmacen(e.getCapacidadAlmacen())
                .lat(e.getLat())
                .lng(e.getLng())
                .build())
            .toList();

        this.vuelos = vueloRepository.findAll().stream()
            .map(e -> Vuelo.builder()
                .codigoVuelo(e.getCodigoVuelo())
                .origen(e.getIataOrigen())
                .destino(e.getIataDestino())
                .horaSalida(e.getHoraSalida())
                .horaLlegada(e.getHoraLlegada())
                .capacidadTotal(e.getCapacidadTotal())
                .tipo(e.getTipo())
                .build())
            .toList();

        log.info("Loaded {} airports and {} flights from DB", this.aeropuertos.size(), this.vuelos.size());
    }

    public List<Aeropuerto> getAeropuertos() {
        return aeropuertos;
    }

    public List<Vuelo> getVuelos() {
        return vuelos;
    }

    // Nota: El método getTodosLosEnvios() se elimina porque ya no cargamos todo en memoria.
    // El SimulationController ahora debe pedir los envíos por rango de fechas al repositorio.
}

