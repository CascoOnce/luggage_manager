package com.tasf.backend.service;

import com.tasf.backend.domain.Aeropuerto;
import com.tasf.backend.domain.Envio;
import com.tasf.backend.domain.Vuelo;
import com.tasf.backend.entity.AeropuertoEntity;
import com.tasf.backend.entity.EnvioEntity;
import com.tasf.backend.entity.VueloEntity;
import com.tasf.backend.parser.AirportParser;
import com.tasf.backend.parser.BaggageParser;
import com.tasf.backend.parser.FlightParser;
import com.tasf.backend.repository.AeropuertoRepository;
import com.tasf.backend.repository.EnvioRepository;
import com.tasf.backend.repository.VueloRepository;
import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Service;

@Service
public class DataLoaderService {
    private static final Logger log = LoggerFactory.getLogger(DataLoaderService.class);
    private static final Pattern IATA_FROM_FILENAME = Pattern.compile("_envios_([A-Z]{4})_");

    private final AeropuertoRepository aeropuertoRepository;
    private final VueloRepository vueloRepository;
    private final EnvioRepository envioRepository;
    private final AirportParser airportParser;
    private final FlightParser flightParser;
    private final BaggageParser baggageParser;

    private List<Aeropuerto> aeropuertos = new ArrayList<>();
    private List<Vuelo> vuelos = new ArrayList<>();
    private Map<String, Set<String>> airportGraph = new HashMap<>();
    private final Set<String> sessionCancelledFlights =
        Collections.newSetFromMap(new java.util.concurrent.ConcurrentHashMap<>());

    public DataLoaderService(
            AeropuertoRepository aeropuertoRepository,
            VueloRepository vueloRepository,
            EnvioRepository envioRepository,
            AirportParser airportParser,
            FlightParser flightParser,
            BaggageParser baggageParser) {
        this.aeropuertoRepository = aeropuertoRepository;
        this.vueloRepository = vueloRepository;
        this.envioRepository = envioRepository;
        this.airportParser = airportParser;
        this.flightParser = flightParser;
        this.baggageParser = baggageParser;
    }

    @PostConstruct
    public void init() {
        seedDatabaseIfEmpty();
        loadStaticDataFromDb();
    }

    private void seedDatabaseIfEmpty() {
        try {
            // Parse airports once — needed for both airport seeding and continent map for envíos
            InputStream airportsStream = new ClassPathResource("data/aeropuertos.txt").getInputStream();
            List<Aeropuerto> parsedAirports = airportParser.parseAirports(airportsStream);
            Map<String, String> continentByAirport = parsedAirports.stream()
                .collect(Collectors.toMap(Aeropuerto::getCodigoIATA, Aeropuerto::getContinente));

            if (aeropuertoRepository.count() == 0) {
                log.info("Seeding airports and flights...");
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
            }

            if (envioRepository.count() == 0) {
                log.info("Seeding envios...");
                PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
                Resource[] envioResources = resolver.getResources("classpath:data/Envios/_envios_*.txt");
                int totalEnvios = 0;
                for (Resource resource : envioResources) {
                    String filename = resource.getFilename();
                    Matcher matcher = IATA_FROM_FILENAME.matcher(filename);
                    if (!matcher.find()) continue;
                    String iata = matcher.group(1);
                    try (InputStream is = resource.getInputStream()) {
                        List<Envio> envios = baggageParser.parseEnvios(is, iata, LocalDate.MIN, null, continentByAirport);
                        List<EnvioEntity> entities = envios.stream()
                            .map(e -> EnvioEntity.builder()
                                .idPedido(e.getIdEnvio())
                                .codigoAerolinea(e.getCodigoAerolinea())
                                .iataOrigen(e.getAeropuertoOrigen())
                                .iataDestino(e.getAeropuertoDestino())
                                .fechaHoraIngreso(e.getFechaHoraIngreso())
                                .cantidadMaletas(e.getCantidadMaletas())
                                .sla(e.getSla())
                                .estado(e.getEstado().name())
                                .build())
                            .toList();
                        envioRepository.saveAll(entities);
                        totalEnvios += entities.size();
                    }
                }
                log.info("Seeded {} envios from {} files", totalEnvios, envioResources.length);
            }
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

        Map<String, Integer> husoByAirport = this.aeropuertos.stream()
            .collect(Collectors.toMap(Aeropuerto::getCodigoIATA, Aeropuerto::getHuso));

        this.vuelos = vueloRepository.findAll().stream()
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

        log.info("Loaded {} airports and {} flights from DB", this.aeropuertos.size(), this.vuelos.size());

        this.airportGraph = new HashMap<>();
        for (Vuelo v : this.vuelos) {
            airportGraph.computeIfAbsent(v.getOrigen(), k -> new HashSet<>()).add(v.getDestino());
            airportGraph.computeIfAbsent(v.getDestino(), k -> new HashSet<>()).add(v.getOrigen());
        }
        log.info("Built airport adjacency graph with {} nodes", this.airportGraph.size());
    }

    public List<Aeropuerto> getAeropuertos() {
        return aeropuertos;
    }

    public List<Vuelo> getVuelos() {
        return vuelos;
    }

    public Map<String, Set<String>> getAirportGraph() {
        return Collections.unmodifiableMap(airportGraph);
    }

    public void cancelFlightForSession(String codigoVuelo) {
        sessionCancelledFlights.add(codigoVuelo);
    }

    public boolean isFlightCancelledForSession(String codigoVuelo) {
        return sessionCancelledFlights.contains(codigoVuelo);
    }

    public void clearSessionCancellations() {
        sessionCancelledFlights.clear();
    }

    // Nota: El método getTodosLosEnvios() se elimina porque ya no cargamos todo en memoria.
    // El SimulationController ahora debe pedir los envíos por rango de fechas al repositorio.
}

