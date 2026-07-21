# Plan de implementación — rama `solv5`

Objetivo: bajar carga del server al manejar muchos envíos. 4 cambios, mismo patrón
(cachear/batch lo caro, sacarlo del camino caliente). Sin cambios de comportamiento
visible; solo rendimiento.

Prioridad: **OPS 1 + 2** primero (paran crashes reales por N+1 a DB), luego **SIM A + B**
(quitan contención de lock en el step).

---

## OPS 1 — Matar el N+1 al cargar planes por envío

**Problema:** `getEnvios()` y `getEnviosEntregados()` llaman `loadPlanFromDb(idPedido)`
por cada envío sin plan en caché → 2 queries DB por envío. 2000 envíos ≈ 4000 queries
cada 10s. Tras reiniciar (caché vacío) *todos* van a DB.

**Archivos:**
- `backend/.../ops/repository/OpsItinerarioRepository.java`
- `backend/.../ops/repository/OpsEscalaRepository.java`
- `backend/.../service/OpsService.java` (`getEnvios` L466, `getEnviosEntregados` L574, `loadPlanFromDb` L619)

**Pasos:**
1. `OpsItinerarioRepository`: agregar
   ```java
   List<ItinerarioEntity> findByIdPedidoInAndEsActivo(List<String> idPedidos, boolean esActivo);
   ```
2. `OpsEscalaRepository`: agregar
   ```java
   List<EscalaEntity> findByIdItinerarioInOrderByOrden(List<String> idItinerarios);
   ```
3. En `OpsService` nuevo helper `loadPlansFromDb(List<String> idPedidos)` que devuelve
   `Map<String,PlanDeViaje>`:
   - una query itinerarios activos por lote,
   - una query escalas por lote (todos los idItinerario),
   - agrupar escalas por idItinerario en memoria, armar los `PlanDeViaje`.
   Reusa la misma construcción de `Escala`/`PlanDeViaje` que `loadPlanFromDb`.
4. Reescribir `getEnvios()`:
   - traer la lista de entidades (`findAllByOrderByFechaHoraIngresoDesc`),
   - los idPedido sin plan en `planesPorEnvio` → una sola llamada `loadPlansFromDb`,
   - mapear con el map resultante (0 queries por envío en el `.map`).
5. Igual en `getEnviosEntregados()`.
6. Dejar `loadPlanFromDb` (singular) para `getEnvioById` (una fila, sin N+1).

**Check:** log de queries (`spring.jpa.show-sql=true` en `application-local`) o contar con
`DataSource-proxy`; verificar que `GET /api/ops/envios` con N envíos ejecuta O(1) queries,
no O(N). Confirmar que la tabla se ve idéntica.

---

## OPS 2 — Split reload: aeropuertos siempre, vuelos con TTL

**Problema:** `computeOccupation()` (L288) llama `opsReferenceData.reload()` en cada poll de
ocupación (cada 2s) → `findAll()` de ~2900 vuelos + 30 aeropuertos desde DB, para siempre.

**Hallazgo de auditoría (importante):** la capacidad de almacén se edita **directo en la DB**
(daily_simulation), no hay endpoint de escritura. El reload cada 2s es lo único que refleja
esas ediciones. Un TTL plano de 60s metería hasta 60s de lag en la capacidad/semáforo →
**cambio de comportamiento visible**. Por eso NO se hace TTL plano.

**Clave:** `computeOccupation` (L287-334) usa SOLO `getAeropuertos()` (~30 filas, barato),
NUNCA `getVuelos()` (~2900, lo caro). Los vuelos solo los usa `getLiveState` (poll de 10s).
→ Se separa el reload: aeropuertos fresco siempre, vuelos con TTL.

**Archivo:** `backend/.../service/OpsReferenceData.java`

**Pasos:**
1. Partir `reload()` en `reloadAeropuertos()` + `reloadVuelos()` (mismo cuerpo, dividido).
   `reload()` = ambos (init `@PostConstruct` + explícito).
2. Agregar TTL solo para vuelos:
   ```java
   private volatile long lastVuelosReloadMs = 0;
   private static final long VUELOS_TTL_MS = 60_000;
   public synchronized void reloadForOccupancy() {
       reloadAeropuertos();                                   // ~30 filas: capacidad SIEMPRE fresca
       if (System.currentTimeMillis() - lastVuelosReloadMs > VUELOS_TTL_MS) {
           reloadVuelos();
           lastVuelosReloadMs = System.currentTimeMillis();
       }
   }
   ```
   `reloadVuelos()` usa `husoByAirport` de los aeropuertos ya recargados en el paso previo.
3. En `OpsService.computeOccupation` L288: `opsReferenceData.reload()` → `reloadForOccupancy()`.

**Comportamiento preservado:** ocupación/semáforo/capacidad siguen refrescando cada 2s
(aeropuertos + `sumAllMaletasPendientesByAeropuerto`, que NO se cachea). Solo los ~2900
vuelos (schedule estático, editado externamente rara vez) pasan a recargarse cada 60s.
`getLiveState` (10s) lee vuelos cacheados — vuelos casi nunca cambian; cancelaciones son
de sesión (`dataLoaderService`), no de la entidad vuelo, así que siguen instantáneas.

**Check:** show-sql — 5 polls de ocupación (10s) hacen 5 `findAll` de aeropuertos (30 filas)
pero **1** `findAll` de vuelos, no 5. Editar capacidad en DB → se refleja en ≤2s (igual que hoy).

---

## SIM A+B — Cache de `/envios` con clave de versión (lazy, byte-idéntico)

**Problema:** `getEnviosEstado()` (L1073) es `synchronized` y reconstruye la tabla entera +
`buildLatestPlanByEnvio()` en cada request. Frontend refetchea en cada `enviosVersion++`.
El lock es el mismo del motor → bloquea `avanzarDia` (el step). Miles de DTOs por request.

**Hallazgo de auditoría:** único caller es el controller `/api/envios`. Nadie depende de sus
efectos internos. → Se puede memoizar por `enviosVersion` sin tocar nada más.

**Descartado el plan original** (construir `cachedEnvios` eager dentro de `buildEstado`): eso
agregaría el build de la lista completa a CADA batch de planning en background (`buildLightEstado`
en `planNextBatch` L461), potencialmente ralentizando el planning. La versión lazy evita eso —
solo construye cuando el frontend realmente pide Y la versión cambió.

**Archivo:** `backend/.../simulation/SimulationEngine.java`

**Pasos (un solo cambio, reemplaza `getEnviosEstado` L1073):**
```java
private volatile List<EnvioDTO> cachedEnvios = List.of();
private volatile long cachedEnviosVersion = -1;

// Sin synchronized en el fast-path: cache hit = lectura volatile, no toca el lock del motor.
public List<EnvioDTO> getEnviosEstado() {
    if (cachedEnviosVersion == enviosVersion) return cachedEnvios;   // hit → lock-free
    synchronized (this) {                                            // miss → build 1 vez por versión
        if (cachedEnviosVersion == enviosVersion) return cachedEnvios;  // double-check
        Map<String, PlanDeViaje> latest = buildLatestPlanByEnvio();
        List<EnvioDTO> list = envios.stream()
            .map(e -> toEnvioDto(e, false, latest.get(e.getIdEnvio()))).toList();
        cachedEnvios = list;
        cachedEnviosVersion = enviosVersion;
        return list;
    }
}
```

**Por qué es byte-idéntico:** en un miss, construye exactamente lo mismo que hoy (mismo
`buildLatestPlanByEnvio`, mismo `toEnvioDto(e,false,...)`, mismo orden `envios.stream()`),
bajo el mismo lock. Solo lo memoiza. Salida = idéntica a la actual.

**Por qué no bloquea el step:** cache hit (versión sin cambios) = lectura volatile, cero lock.
El lock solo se toma en el miss (1 vez por bump de versión, y solo si alguien pide `/envios`) —
igual o menos que hoy (hoy toma el lock en CADA request). Nunca más builds que hoy.

**Sin riesgo de envíos fantasma/stale:** el valor cacheado va siempre atado a la `enviosVersion`
con la que se construyó. Si la versión sube después, el próximo request es miss → reconstruye.
No hay ventana en la que se devuelva una lista vieja con número de versión nuevo.

---

## Verificación end-to-end

1. `cd backend && ./mvnw -Dspring-boot.run.profiles=local compile` (BD en mantenimiento;
   no correr @SpringBootTest — ver memoria).
2. Levantar backend local + frontend, cargar un lote grande de envíos ops (batch) y arrancar
   una sim con muchos envíos.
3. Ops: abrir OpsScreen, confirmar que no se traba; revisar show-sql para O(1) queries.
4. Sim: correr sim completa, confirmar que el step no tartamudea y la tabla de envíos
   se actualiza igual que antes.
5. Comparar salidas de `/api/ops/envios`, `/api/ops/reporte`, `/api/envios` antes/después
   (deben ser idénticas en contenido).

## Fuera de alcance (fase 2, si hace falta)
- OPS 3 (getReporte agregado), OPS 4 (DTO resumen + payload), OPS 5 (poll 2s→5s).
- SIM C (memoizar buildLatestPlanByEnvio), D (bump 1×/día), E (paginación servidor).
