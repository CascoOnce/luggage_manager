package com.tasf.backend.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
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
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
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
import org.springframework.scheduling.annotation.Scheduled;
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

    // Optional seed window (local/dev only). The bundled envio files hold ~9.5M rows spanning
    // 2026–2029; seeding them all via JPA is impractical. Setting app.seed.envios.from/to
    // seeds only that date range so a fresh local DB is ready in seconds. Empty = full range.
    @org.springframework.beans.factory.annotation.Value("${app.seed.envios.from:}")
    private String seedEnviosFrom;
    @org.springframework.beans.factory.annotation.Value("${app.seed.envios.to:}")
    private String seedEnviosTo;

    private List<Aeropuerto> aeropuertos = new ArrayList<>();
    private List<Vuelo> vuelos = new ArrayList<>();
    private Map<String, Set<String>> airportGraph = new HashMap<>();
    // Flight code -> calendar date it's cancelled for. A HOY cancellation stops matching
    // "today" once the real date rolls over, and a MANANA cancellation starts matching
    // once tomorrow becomes today. Persisted to a JSON file so cancellations survive
    // backend restarts; entries older than 7 days are purged daily.
    private final Map<String, LocalDate> sessionCancelledFlightDates = new java.util.concurrent.ConcurrentHashMap<>();

    private static final String CANCEL_FILE = "ops_cancellations.json";
    private static final int CANCEL_RETENTION_DAYS = 7;
    private final ObjectMapper cancelMapper = new ObjectMapper().registerModule(new JavaTimeModule());

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
        loadCancellationsFromFile();
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
                LocalDate seedFrom = (seedEnviosFrom == null || seedEnviosFrom.isBlank())
                    ? LocalDate.MIN : LocalDate.parse(seedEnviosFrom.trim());
                LocalDate seedTo = (seedEnviosTo == null || seedEnviosTo.isBlank())
                    ? null : LocalDate.parse(seedEnviosTo.trim());
                log.info("Seeding envios... (window from={} to={})", seedFrom, seedTo);
                PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
                Resource[] envioResources = resolver.getResources("classpath:data/Envios/_envios_*.txt");
                int totalEnvios = 0;
                for (Resource resource : envioResources) {
                    String filename = resource.getFilename();
                    Matcher matcher = IATA_FROM_FILENAME.matcher(filename);
                    if (!matcher.find()) continue;
                    String iata = matcher.group(1);
                    try (InputStream is = resource.getInputStream()) {
                        List<Envio> envios = baggageParser.parseEnvios(is, iata, seedFrom, seedTo, continentByAirport);
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

        reloadAeropuertos();

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

    /** Re-fetches airports from the DB (small table, ~30 rows) so callers see live
     *  changes to fields like capacidadAlmacen instead of the @PostConstruct snapshot. */
    public void reloadAeropuertos() {
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
    }

    public List<Vuelo> getVuelos() {
        return vuelos;
    }

    public Map<String, Set<String>> getAirportGraph() {
        return Collections.unmodifiableMap(airportGraph);
    }

    public void cancelFlightForSession(String codigoVuelo, String aplicaDesde) {
        LocalDate fecha = "MANANA".equalsIgnoreCase(aplicaDesde) ? LocalDate.now().plusDays(1) : LocalDate.now();
        sessionCancelledFlightDates.put(codigoVuelo, fecha);
        persistCancellationsToFile();
    }

    public boolean isFlightCancelledForSession(String codigoVuelo) {
        return LocalDate.now().equals(sessionCancelledFlightDates.get(codigoVuelo));
    }

    public boolean isFlightCancellationProgramadaForSession(String codigoVuelo) {
        return LocalDate.now().plusDays(1).equals(sessionCancelledFlightDates.get(codigoVuelo));
    }

    public void clearSessionCancellations() {
        sessionCancelledFlightDates.clear();
        persistCancellationsToFile();
    }

    /** Returns an unmodifiable view of all session cancellations (code → date). */
    public Map<String, LocalDate> getSessionCancelledFlightDates() {
        return Collections.unmodifiableMap(sessionCancelledFlightDates);
    }

    // ── File-based persistence for Ops cancellations ──────────────────────────

    private Path getCancelFilePath() {
        // Store next to the running JAR / working directory
        return Paths.get(CANCEL_FILE);
    }

    private void loadCancellationsFromFile() {
        Path path = getCancelFilePath();
        if (!Files.exists(path)) {
            log.info("No cancellation file found at {}, starting fresh", path.toAbsolutePath());
            return;
        }
        try {
            Map<String, String> raw = cancelMapper.readValue(path.toFile(),
                    new TypeReference<Map<String, String>>() {});
            LocalDate cutoff = LocalDate.now().minusDays(CANCEL_RETENTION_DAYS);
            int loaded = 0;
            for (Map.Entry<String, String> entry : raw.entrySet()) {
                LocalDate date = LocalDate.parse(entry.getValue());
                if (!date.isBefore(cutoff)) {
                    sessionCancelledFlightDates.put(entry.getKey(), date);
                    loaded++;
                }
            }
            log.info("Loaded {} active cancellations from {} ({} total in file)",
                    loaded, path.toAbsolutePath(), raw.size());
        } catch (Exception e) {
            log.warn("Failed to load cancellations from {}: {}", path.toAbsolutePath(), e.getMessage());
        }
    }

    private void persistCancellationsToFile() {
        try {
            // Convert LocalDate values to strings for JSON
            Map<String, String> raw = new HashMap<>();
            for (Map.Entry<String, LocalDate> entry : sessionCancelledFlightDates.entrySet()) {
                raw.put(entry.getKey(), entry.getValue().toString());
            }
            cancelMapper.writerWithDefaultPrettyPrinter()
                    .writeValue(getCancelFilePath().toFile(), raw);
        } catch (Exception e) {
            log.error("Failed to persist cancellations to file: {}", e.getMessage());
        }
    }

    /** Runs daily at midnight: remove cancellations older than 7 days and re-persist. */
    @Scheduled(cron = "0 0 0 * * *")
    public void cleanupOldCancellations() {
        LocalDate cutoff = LocalDate.now().minusDays(CANCEL_RETENTION_DAYS);
        int removed = 0;
        Iterator<Map.Entry<String, LocalDate>> it = sessionCancelledFlightDates.entrySet().iterator();
        while (it.hasNext()) {
            if (it.next().getValue().isBefore(cutoff)) {
                it.remove();
                removed++;
            }
        }
        if (removed > 0) {
            log.info("Cleaned up {} old cancellations (before {})", removed, cutoff);
            persistCancellationsToFile();
        }
    }

    // Nota: El método getTodosLosEnvios() se elimina porque ya no cargamos todo en memoria.
    // El SimulationController ahora debe pedir los envíos por rango de fechas al repositorio.
}

