# Plan: Paralelización de la fase de planificación

## Contexto

Actualmente generar una simulación de 3 días toma ~1 minuto y de 5 días sobrepasa cómodamente los 100s, acercándose al timeout HTTP de 180s en el frontend. La intuición inicial era usar un pipeline día-a-día con hilos, pero la exploración del código reveló que **eso no aplica**:

- La planificación NO se hace por día. Se hace UNA SOLA VEZ en `SimulationEngine.inicializar()` (línea ~133), que llama a `PlanningService.planificar()` y planea las rutas de TODOS los envíos de TODOS los días de una vez.
- `avanzarDia()` ya es relativamente rápido (~10-15s) y depende causalmente del estado del día anterior (mutaciones secuenciales sobre `maletas`, `fechaSimulada`).

El cuello de botella real es la construcción del **pool de candidatos** dentro de `RoutePlannerSupport.buildCandidatePool()` ([backend/src/main/java/com/tasf/backend/algorithm/RoutePlannerSupport.java](../backend/src/main/java/com/tasf/backend/algorithm/RoutePlannerSupport.java) líneas 30-60): para cada envío genera hasta 50 rutas (directas + un escala) iterando los vuelos disponibles. Este trabajo es **embarazosamente paralelo por envío** porque solo lee de mapas inmutables (`flightsByOrigin`, `airportByCode`).

El bucle metaheurístico de SA/TS NO se paraleliza — es secuencial por diseño (cadena de Markov en SA; cola tabú en TS) y paralelizarlo degradaría la calidad. Decisión explícita: "calidad primero", así que solo se toca lo que es bit-idéntico.

## Cambio principal

**Archivo único a modificar:** [backend/src/main/java/com/tasf/backend/algorithm/RoutePlannerSupport.java](../backend/src/main/java/com/tasf/backend/algorithm/RoutePlannerSupport.java)

Reemplazar el bucle for secuencial de `buildCandidatePool` (líneas 46-55) por un `parallelStream` ejecutado en un `ForkJoinPool` dedicado.

### Pasos concretos

1. **Mantener secuencial** la construcción de los mapas inmutables (líneas 37-43) y la asignación a `this.airportCapacityCache` (línea 39). Esto establece el happens-before respecto al `submit().get()` posterior.

2. **Añadir un pool dedicado** como campo `private static final`:
   ```java
   private static final ForkJoinPool PLANNING_POOL =
       new ForkJoinPool(Math.max(2, Runtime.getRuntime().availableProcessors() - 1));
   ```
   Pool dedicado (no el común) para no competir con el `@Async` existente en `SimulationPersistenceService.java:47`. Dejar 1 core para el hilo de request + el bucle SA/TS posterior.

3. **Reemplazar el bucle 46-55** por:
   - Usar `LongAdder` en lugar de `MutableCounter` dentro del paralelo, y al final sumarlo al `routeCounter` existente para preservar la API.
   - Recolectar a `ConcurrentHashMap<String, List<RouteCandidate>>` via `Collectors.toConcurrentMap(...)`.
   - Recomputar `sinRuta` después con `pool.values().stream().filter(List::isEmpty).count()`.
   - Estructura:
     ```java
     LongAdder adder = new LongAdder();
     Map<String, List<RouteCandidate>> pool = PLANNING_POOL.submit(() ->
         envios.parallelStream().collect(Collectors.toConcurrentMap(
             Envio::getIdEnvio,
             envio -> {
                 enforceSlaFromContinent(envio, airportByCode);
                 List<RouteCandidate> routes = generateRoutes(envio, flightsByOrigin, airportByCode, params);
                 adder.add(routes.size());
                 return routes;
             }
         ))
     ).get();
     routeCounter.increment((int) adder.sum());
     long sinRuta = pool.values().stream().filter(List::isEmpty).count();
     ```
   - Mover los `log.debug` por envío al lambda; los `log.info` finales quedan fuera. SLF4J es thread-safe.

4. **No tocar**:
   - `objective()`, `respectsHardConstraints()`, `generateRoutes()`, `enforceSlaFromContinent()`, ni los archivos `SimulatedAnnealingAlgorithm.java` / `TabuSearchAlgorithm.java`.
   - `SimulationEngine` y `PlanningService` quedan intactos. Toda la concurrencia está contenida dentro de `buildCandidatePool`.

## Seguridad de hilos (resumen)

| Estado compartido | Por qué es seguro |
|---|---|
| `airportByCode`, `flightsByOrigin` | Inmutables tras construcción (líneas 37-43, secuenciales) |
| `airportCapacityCache` (campo) | Escrito ANTES del paralelo; `submit().get()` establece happens-before |
| `pool` | `ConcurrentHashMap` vía `toConcurrentMap` |
| `routeCounter` | Reemplazado por `LongAdder` dentro del lambda |
| `envio.setSla(...)` | Cada hilo escribe un `Envio` distinto (claves únicas por `idEnvio`) |
| Logging | SLF4J thread-safe |

**Determinismo preservado:**
- `generateRoutes` retorna lista ordenada por `finalArrival` y limitada a 50 — mismo resultado por envío.
- SA/TS iteran sobre `optimizableEnvios`/`plannedEnvios` construidos secuencialmente después del pool, manteniendo orden.
- Con la misma semilla de RNG, la solución es bit-idéntica a la versión secuencial.

## Verificación

1. **Tests de regresión de calidad** (deben pasar sin cambios):
   ```bash
   cd backend
   ./mvnw test -Dtest=PlanningServiceIntegrationTest -Dspring-boot.run.profiles=local
   ./mvnw test -Dtest=SimulationScenarioTest -Dspring-boot.run.profiles=local
   ```
   Verifican que SA y TS producen planes válidos y que un escenario de 3 días + cancelación de vuelo + replanificación se completa correctamente.

2. **Smoke test E2E** desde el frontend:
   ```bash
   cd backend && ./mvnw spring-boot:run -Dspring-boot.run.profiles=local
   # otra terminal
   npm run dev
   ```
   - Configurar simulación de 5 días e iniciar.
   - Confirmar que el `POST /api/simulation/start` retorna antes de los 180s del timeout (`src/services/api.js:78`).
   - Confirmar mismo número de `enviosSinRuta` y comportamiento SLA que antes.

3. **Medición de tiempos**: agregar temporalmente un `log.info` con `System.nanoTime()` antes/después del paralelo para confirmar reducción ~4-6× en la fase de pool.

## Expectativa de mejora

- Construcción del pool: ~60-80% del tiempo total de planificación.
- Con N-1 workers en máquina de 8 cores: **~5× speedup en la fase del pool**, casi lineal por ser CPU puro + lookups en mapas.
- Planificación end-to-end: 30-90s → 10-25s.
- Simulación de 5 días: ~110s → **~40-60s**, con margen amplio frente al timeout de 180s.

## Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Race en `airportCapacityCache` | Bajo | Escritura secuencial antes del paralelo; HB por `submit().get()` |
| Sobrecarga del common ForkJoinPool | Nulo | Pool dedicado privado |
| Stack traces más difíciles de leer | Bajo | SLF4J imprime nombre de hilo; logs por envío preservados |
| Cambio en orden de iteración del pool | Nulo | Ningún consumidor itera el pool por orden de inserción |
