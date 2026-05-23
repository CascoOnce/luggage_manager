# Optimizaciones de Backend — Luggage Manager

Análisis realizado el 2026-05-22. Las mejoras están ordenadas por impacto en el rendimiento percibido por el usuario.

---

## [CORREGIDO] 1. Persistencia bloqueante al fin de la simulación

**Archivo:** `SimulationEngine.java` línea 278 / `SimulationPersistenceService.java`

**Problema:** Al terminar el último día simulado, `avanzarDia()` llamaba a `persistSimulationResults()` de forma síncrona dentro del mismo hilo HTTP. El usuario quedaba bloqueado esperando que toda la escritura a BD terminara antes de recibir la respuesta con el estado final.

**Corrección aplicada:** Se agregó `@EnableAsync` en `BackendApplication` y `@Async` en `persistSimulationResults()`. El motor ahora pasa `List.copyOf()` de cada lista antes de llamar al servicio, garantizando snapshots inmutables para el hilo de persistencia. La respuesta al usuario se devuelve de inmediato.

---

## [CRÍTICO] 2. O(n²) en actualización de envíos durante persistencia

**Archivo:** `SimulationPersistenceService.java` líneas 106–128

**Problema:** Para actualizar el estado final de cada envío en la BD, el código llama a `envioRepository.findAll()` dentro de un bucle sobre todos los envíos:

```java
for (com.tasf.backend.domain.Envio de : domainEnvios) {       // hasta 10.000 iteraciones
    Optional<EnvioEntity> existing = envioRepository.findAll() // SELECT * completo en cada iteración
        .stream()
        .filter(e -> e.getIdPedido().equals(de.getIdEnvio()))
        .findFirst();
}
```

Con 10.000 envíos, esto ejecuta 10.000 `SELECT *` completos. Es O(n²) en queries y en memoria. En una simulación grande puede tardar varios minutos (incluso con el hilo async mejora la UX, la operación sigue siendo ineficiente).

**Corrección propuesta:**

```java
// 1. Cargar todos los IDs relevantes en un solo query
Set<String> ids = domainEnvios.stream()
    .map(Envio::getIdEnvio)
    .collect(Collectors.toSet());

// 2. Un solo SELECT con WHERE idPedido IN (...)
Map<String, EnvioEntity> existingByPedido = envioRepository
    .findByIdPedidoIn(ids)           // nuevo método en el repositorio
    .stream()
    .collect(Collectors.toMap(EnvioEntity::getIdPedido, e -> e));

// 3. Actualizar/insertar con saveAll() al final
List<EnvioEntity> toSave = new ArrayList<>();
for (Envio de : domainEnvios) {
    EnvioEntity entity = existingByPedido.getOrDefault(de.getIdEnvio(), new EnvioEntity(...));
    entity.setEstado(de.getEstado().name());
    toSave.add(entity);
}
envioRepository.saveAll(toSave);
```

Requiere agregar `findByIdPedidoIn(Collection<String> ids)` en `EnvioRepository`.

---

## [CRÍTICO] 3. Saves individuales en lugar de batch en persistencia

**Archivo:** `SimulationPersistenceService.java` líneas 54–93

**Problema:** Los itinerarios y métricas se guardan con un `save()` individual por elemento:

```java
for (PlanDeViaje plan : planes) {
    itinerarioRepository.save(itinerario);  // 1 INSERT por plan
    escalaRepository.saveAll(escalas);      // 1 batch por plan, pero sigue siendo N roundtrips
}
for (MetricaAlgoritmo m : metricas) {
    metricaRepository.save(entity);         // 1 INSERT por métrica
}
```

Con miles de planes, esto genera N roundtrips individuales a la BD.

**Corrección propuesta:** Acumular en listas y hacer un único `saveAll()` al final de cada sección:

```java
List<ItinerarioEntity> itinerarios = new ArrayList<>();
List<EscalaEntity> todasLasEscalas = new ArrayList<>();

for (PlanDeViaje plan : planes) {
    itinerarios.add(buildItinerario(plan));
    todasLasEscalas.addAll(buildEscalas(plan, itinerarioId));
}

itinerarioRepository.saveAll(itinerarios);
escalaRepository.saveAll(todasLasEscalas);

List<MetricaEjecucionEntity> metricaEntities = metricas.stream()
    .map(this::buildMetricaEntity)
    .toList();
metricaRepository.saveAll(metricaEntities);
```

---

## [ALTO] 4. Mapas de lookup reconstruidos N veces por ciclo diario

**Archivo:** `SimulationEngine.java` — métodos `processDepartures()`, `processArrivals()`, `processDeliveries()`

**Problema:** Cada uno de estos métodos construye sus propios `HashMap` desde cero al inicio:

```java
// processDepartures() — llamado 3 veces por día:
Map<String, Envio> envioById       = envios.stream().collect(...);     // O(n_envios)
Map<String, Vuelo> vueloByCode     = vuelos.stream().collect(...);     // O(n_vuelos)
Map<String, Aeropuerto> airportByCode = aeropuertos.stream()...;      // O(n_aeropuertos)
Map<String, List<Maleta>> maletasByEnvio = maletas.stream()...;       // O(n_maletas)

// processArrivals() — también llamado 3 veces por día:
Map<String, Vuelo> vueloByCode     = vuelos.stream().collect(...);     // duplicado
Map<String, Aeropuerto> airportByCode = aeropuertos.stream()...;      // duplicado

// processDeliveries() — 1 vez por día:
Map<String, Envio> envioById       = envios.stream().collect(...);     // duplicado
Map<String, Aeropuerto> airportByCode = aeropuertos.stream()...;      // duplicado
```

En total: hasta 7 reconstrucciones de mapas por día simulado, sobre listas de hasta 10.000+ elementos.

**Corrección propuesta:** Construir los mapas una sola vez al inicio de `avanzarDia()` y pasarlos como parámetros (o como campos de una clase `DayContext`):

```java
// En avanzarDia():
Map<String, Envio> envioById = envios.stream()
    .collect(Collectors.toMap(Envio::getIdEnvio, e -> e, (a, b) -> a));
Map<String, Vuelo> vueloByCode = vuelos.stream()
    .collect(Collectors.toMap(Vuelo::getCodigoVuelo, v -> v, (a, b) -> a));
Map<String, Aeropuerto> airportByCode = aeropuertos.stream()
    .collect(Collectors.toMap(Aeropuerto::getCodigoIATA, a -> a, (a, b) -> a));
Map<String, List<Maleta>> maletasByEnvio = maletas.stream()
    .collect(Collectors.groupingBy(Maleta::getIdEnvio));

for (int pass = 0; pass < 3; pass++) {
    processDepartures(envioById, vueloByCode, airportByCode, maletasByEnvio);
    processArrivals(vueloByCode, airportByCode);
}
processDeliveries(envioById, airportByCode);
```

---

## [ALTO] 5. Segundo pass en `processDeliveries()` es O(envíos × maletas)

**Archivo:** `SimulationEngine.java` líneas 681–693

**Problema:** El segundo pass para detectar envíos ya entregados hace una búsqueda lineal de maletas por cada envío:

```java
for (Envio envio : envios) {                                    // hasta 10.000
    List<Maleta> maletasEnvio = maletas.stream()
        .filter(m -> m.getIdEnvio().equals(envio.getIdEnvio())) // escanea todas las maletas
        .toList();
    boolean allDelivered = maletasEnvio.stream().allMatch(...);
}
```

Con 10.000 envíos y una maleta promedio por envío, esto es ~10M operaciones por día.

**Corrección propuesta:** Usar el `Map<String, List<Maleta>> maletasByEnvio` construido en el punto anterior (mejora 4):

```java
for (Envio envio : envios) {
    if (envio.getEstado() == EstadoEnvio.ENTREGADO) continue;
    List<Maleta> maletasEnvio = maletasByEnvio.getOrDefault(envio.getIdEnvio(), List.of());
    if (!maletasEnvio.isEmpty() && maletasEnvio.stream().allMatch(m -> m.getEstado() == EstadoMaleta.ENTREGADA)) {
        envio.setEstado(EstadoEnvio.ENTREGADO);
    }
}
```

---

## [ALTO] 6. `toAeropuertoDto()` escanea todas las maletas por cada aeropuerto

**Archivo:** `SimulationEngine.java` líneas 977–983

**Problema:** `getEstado()` es llamado desde el frontend cada 2 segundos. Dentro, construye DTOs de los 30 aeropuertos. Cada `toAeropuertoDto()` hace un `stream().filter()` sobre todas las maletas para contar ocupación:

```java
// Llamado 30 veces en cada poll (cada 2 segundos):
int ocupacion = (int) maletas.stream()
    .filter(m -> m.getUbicacionActual().equals(airport.getCodigoIATA())
        && m.getEstado() == EstadoMaleta.EN_ALMACEN)
    .count();
```

Con 10.000 maletas y 30 aeropuertos: 300.000 comparaciones por cada poll.

**Corrección propuesta:** El método `updateWarehouseOccupation()` ya calcula esta cuenta y la almacena en `aeropuerto.setOcupacionActual()`. Simplemente usar ese valor en `toAeropuertoDto()` en lugar de recalcular:

```java
// En toAeropuertoDto() — usar el campo ya calculado:
int ocupacion = airport.getOcupacionActual();  // O(1), sin stream
```

`updateWarehouseOccupation()` ya se llama al final de cada `avanzarDia()`, por lo que el valor está siempre actualizado antes del siguiente poll.

---

## [MEDIO] 7. Logging excesivo dentro de loops de maletas

**Archivo:** `SimulationEngine.java` — métodos `processArrivals()` y `processDeliveries()`

**Problema:** Hay llamadas a `log.info()` dentro de los loops que iteran sobre maletas y envíos:

```java
// processDeliveries() — se ejecuta por cada maleta:
log.info("DELIVERY CHECK: envio {} estado={} ubicacion={} ...", ...);

// avanzarDia() — se ejecuta por cada aeropuerto después de arrivals:
aeropuertos.forEach(ap ->
    log.info("Airport {} ocupacion={} maletas_en_almacen={}", ...));
```

Con 10.000+ maletas por día, el logger escribe millones de líneas por simulación, presionando tanto el hilo de ejecución como el disco.

**Corrección propuesta:** Degradar a `log.debug()` o eliminar los logs dentro de loops. Mantener solo los logs de resumen (por día, no por maleta):

```java
// Antes (dentro del loop): log.info("DELIVERY CHECK: envio {} ...", ...);
// Después: comentado o log.debug() — solo activo si el usuario activa DEBUG explícitamente
log.debug("DELIVERY CHECK: envio {} estado={} ...", ...);

// Resumen al final del día (fuera del loop):
log.info("processDeliveries: {} maletas entregadas hoy", delivered);
```

---

## [MEDIO] 8. `getEnvioPorId()` hace búsqueda lineal en `planes`

**Archivo:** `SimulationEngine.java` líneas 535–546

**Problema:** Cada vez que se solicita el detalle de un envío, se busca su plan con `stream().filter()` sobre la lista completa de planes:

```java
PlanDeViaje plan = planes.stream()
    .filter(p -> p.getIdEnvio().equals(envio.getIdEnvio()))
    .max(Comparator.comparingInt(PlanDeViaje::getVersion))
    .orElse(null);
```

**Corrección propuesta:** El `Map<String, PlanDeViaje> latestPlanByEnvio` ya se construye en `getEstado()`. Extraer su construcción a un método privado y reutilizarlo en `getEnvioPorId()`:

```java
private Map<String, PlanDeViaje> buildLatestPlanByEnvio() {
    Map<String, PlanDeViaje> map = new HashMap<>();
    for (PlanDeViaje p : planes) {
        map.merge(p.getIdEnvio(), p,
            (a, b) -> a.getVersion() >= b.getVersion() ? a : b);
    }
    return map;
}
```

O simplemente mantener este mapa como campo de clase y actualizarlo incrementalmente cada vez que se agrega o reemplaza un plan.

---

## Resumen de impacto estimado

| # | Problema | Estado | Impacto en UX |
|---|---|---|---|
| 1 | Persistencia bloqueante al final | **CORREGIDO** | Alto — bloquea al usuario |
| 2 | O(n²) en actualización de envíos | Pendiente | Alto — lentitud de BD |
| 3 | Saves individuales en persistence | Pendiente | Medio — lentitud de BD |
| 4 | Mapas reconstruidos 7x por día | Pendiente | Alto — CPU por día simulado |
| 5 | O(envíos × maletas) en deliveries | Pendiente | Alto — CPU por día simulado |
| 6 | Stream de maletas en cada poll | Pendiente | Medio — CPU cada 2 segundos |
| 7 | Logging excesivo en loops | Pendiente | Medio — I/O de disco |
| 8 | Búsqueda lineal de planes | Pendiente | Bajo — solo en detalle de envío |
