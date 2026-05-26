# Optimizaciones de Backend — Luggage Manager

Análisis realizado el 2026-05-22. Todas las correcciones aplicadas el 2026-05-25.
Las mejoras están ordenadas por impacto en el rendimiento percibido por el usuario.

---

## [CORREGIDO] 1. Persistencia bloqueante al fin de la simulación

**Archivo:** `SimulationEngine.java` / `SimulationPersistenceService.java`

**Problema:** Al terminar el último día simulado, `avanzarDia()` llamaba a `persistSimulationResults()` de forma síncrona dentro del mismo hilo HTTP. El usuario quedaba bloqueado esperando que toda la escritura a BD terminara antes de recibir la respuesta con el estado final.

**Corrección aplicada:** Se agregó `@EnableAsync` en `BackendApplication` y `@Async` en `persistSimulationResults()`. El motor ahora pasa `List.copyOf()` de cada lista antes de llamar al servicio, garantizando snapshots inmutables para el hilo de persistencia. La respuesta al usuario se devuelve de inmediato.

---

## [CORREGIDO] 2. O(n²) en actualización de envíos durante persistencia

**Archivo:** `SimulationPersistenceService.java` / `EnvioRepository.java`

**Problema:** Para actualizar el estado final de cada envío en la BD, el código llamaba a `envioRepository.findAll()` dentro de un bucle sobre todos los envíos:

```java
for (com.tasf.backend.domain.Envio de : domainEnvios) {       // hasta 10.000 iteraciones
    Optional<EnvioEntity> existing = envioRepository.findAll() // SELECT * completo en cada iteración
        .stream()
        .filter(e -> e.getIdPedido().equals(de.getIdEnvio()))
        .findFirst();
}
```

Con 10.000 envíos, esto ejecutaba 10.000 `SELECT *` completos. O(n²) en queries y en memoria.

**Corrección aplicada:**

```java
// Un solo SELECT con WHERE idPedido IN (...)
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
        entity = EnvioEntity.builder()...build();
    }
    toSave.add(entity);
}
envioRepository.saveAll(toSave);
```

Requirió agregar `findByIdPedidoIn(Collection<String> ids)` en `EnvioRepository` (Spring Data lo genera automáticamente como `WHERE id_pedido IN (...)`).

---

## [CORREGIDO] 3. Saves individuales en lugar de batch en persistencia

**Archivo:** `SimulationPersistenceService.java`

**Problema:** Los itinerarios y métricas se guardaban con un `save()` individual por elemento:

```java
for (PlanDeViaje plan : planes) {
    itinerarioRepository.save(itinerario);  // 1 INSERT por plan
    escalaRepository.saveAll(escalas);      // 1 batch por plan, N roundtrips en total
}
for (MetricaAlgoritmo m : metricas) {
    metricaRepository.save(entity);         // 1 INSERT por métrica
}
```

**Corrección aplicada:** Acumulación en listas + `saveAll()` único al final de cada sección:

```java
List<ItinerarioEntity> itinerarios = new ArrayList<>();
List<EscalaEntity> todasLasEscalas = new ArrayList<>();

for (PlanDeViaje plan : planes) {
    String idItinerario = plan.getIdEnvio() + "-v" + plan.getVersion();
    itinerarios.add(ItinerarioEntity.builder()...build());
    // escalas acumuladas usando idItinerario local (sin necesitar save previo)
    todasLasEscalas.addAll(...);
}

itinerarioRepository.saveAll(itinerarios);   // 1 roundtrip
escalaRepository.saveAll(todasLasEscalas);   // 1 roundtrip

List<MetricaEjecucionEntity> metricaEntities = metricas.stream()
    .map(m -> MetricaEjecucionEntity.builder()...build())
    .toList();
metricaRepository.saveAll(metricaEntities);  // 1 roundtrip
```

---

## [CORREGIDO] 4. Mapas de lookup reconstruidos N veces por ciclo diario

**Archivo:** `SimulationEngine.java` — métodos `processDepartures()`, `processArrivals()`, `processDeliveries()`

**Problema:** Cada uno de estos métodos construía sus propios `HashMap` desde cero al inicio, resultando en hasta 7 reconstrucciones por día simulado sobre listas de hasta 10.000+ elementos.

**Corrección aplicada:** Los 4 mapas se construyen una sola vez al inicio de `avanzarDia()` y se pasan como parámetros. Adicionalmente, `processArrivals()` también recibió `maletasByEnvio` para reemplazar su stream interno (mejora no contemplada en la propuesta original):

```java
// En avanzarDia() — construcción única:
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
    processArrivals(vueloByCode, airportByCode, maletasByEnvio);  // también recibe maletasByEnvio
}
processDeliveries(envioById, airportByCode, maletasByEnvio);
```

El stream interno de `processArrivals()` que escaneaba toda la lista de maletas por cada escala fue reemplazado por `maletasByEnvio.getOrDefault(plan.getIdEnvio(), List.of())`.

---

## [CORREGIDO] 5. Segundo pass en `processDeliveries()` es O(envíos × maletas)

**Archivo:** `SimulationEngine.java`

**Problema:** El segundo pass para detectar envíos ya entregados hacía una búsqueda lineal de maletas por cada envío (≈10M operaciones/día con 10.000 envíos).

**Corrección aplicada:** Uso del `maletasByEnvio` introducido en la corrección #4:

```java
for (Envio envio : envios) {
    if (envio.getEstado() == EstadoEnvio.ENTREGADO) continue;
    List<Maleta> maletasEnvio = maletasByEnvio.getOrDefault(envio.getIdEnvio(), List.of());
    boolean allDelivered = !maletasEnvio.isEmpty()
        && maletasEnvio.stream().allMatch(m -> m.getEstado() == EstadoMaleta.ENTREGADA);
    if (allDelivered) {
        envio.setEstado(EstadoEnvio.ENTREGADO);
    }
}
```

---

## [CORREGIDO] 6. `toAeropuertoDto()` escanea todas las maletas por cada aeropuerto

**Archivo:** `SimulationEngine.java`

**Problema:** `getEstado()` es llamado desde el frontend cada 2 segundos. Cada `toAeropuertoDto()` recalculaba la ocupación con un stream sobre todas las maletas: 30 aeropuertos × 10.000 maletas = 300.000 comparaciones por poll.

**Corrección aplicada:** Una línea:

```java
// Antes:
int ocupacion = (int) maletas.stream()
    .filter(m -> m.getUbicacionActual().equals(airport.getCodigoIATA())
        && m.getEstado() == EstadoMaleta.EN_ALMACEN ...)
    .count();

// Después:
int ocupacion = airport.getOcupacionActual();  // O(1)
```

`updateWarehouseOccupation()` ya calcula y almacena este valor al final de cada `avanzarDia()`, por lo que siempre está actualizado antes del siguiente poll. También se eliminó la variable `LocalDate today` que solo existía para ese stream.

---

## [CORREGIDO] 7. Logging excesivo dentro de loops de maletas

**Archivo:** `SimulationEngine.java`

**Problema:** Dos `log.info()` dentro de loops de alta frecuencia:
- `log.info("DELIVERY CHECK: ...")` en `processDeliveries()` — se ejecutaba por cada maleta (hasta 10.000 líneas/día)
- `aeropuertos.forEach(ap -> log.info("Airport {} ocupacion=...", ..., maletas.stream()...count()))` en `avanzarDia()` — 30 ejecuciones con un stream embebido de 10.000 ops cada una

**Corrección aplicada:**
- `DELIVERY CHECK` degradado a `log.debug()` — solo activo si se configura `logging.level.com.tasf.backend=DEBUG`.
- El bloque `aeropuertos.forEach(ap -> log.info(...))` fue **eliminado** por ser redundante: `updateWarehouseOccupation()` ya loguea `[OCUPACION]` con la misma información justo antes, y además tenía el stream embebido que representa trabajo extra aunque el log no se escriba (los argumentos de `log.info()` se evalúan antes de pasar al logger).

---

## [CORREGIDO] 8. `getEnvioPorId()` hace búsqueda lineal en `planes`

**Archivo:** `SimulationEngine.java`

**Problema:** Cada llamada al detalle de un envío buscaba su plan con `stream().filter().max()` sobre la lista completa de planes. El mismo patrón estaba duplicado en `getEnviosEstado()`.

**Corrección aplicada:** Se extrajo `buildLatestPlanByEnvio()` como método privado y se reutiliza en `getEnvioPorId()` y `getEnviosEstado()`:

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

---

## Resumen de impacto estimado

| # | Problema | Estado | Impacto en UX |
|---|---|---|---|
| 1 | Persistencia bloqueante al final | **CORREGIDO** | Alto — bloqueaba al usuario |
| 2 | O(n²) en actualización de envíos | **CORREGIDO** | Alto — lentitud de BD |
| 3 | Saves individuales en persistence | **CORREGIDO** | Medio — lentitud de BD |
| 4 | Mapas reconstruidos 7x por día | **CORREGIDO** | Alto — CPU por día simulado |
| 5 | O(envíos × maletas) en deliveries | **CORREGIDO** | Alto — CPU por día simulado |
| 6 | Stream de maletas en cada poll | **CORREGIDO** | Medio — CPU cada 2 segundos |
| 7 | Logging excesivo en loops | **CORREGIDO** | Medio — I/O de disco |
| 8 | Búsqueda lineal de planes | **CORREGIDO** | Bajo — solo en detalle de envío |
