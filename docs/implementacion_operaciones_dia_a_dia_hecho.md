# Documento de Implementación — Operaciones Día a Día

**Fecha de cierre:** 2026-06-08
**Branch:** `feat/operaciones-dia-a-dia`
**Commits clave:** `85223c4` → `9d1095f` → `55a1789` → `0386717`

---

## Resumen

Se añadió un modo "Operaciones Día a Día" completamente aislado del modo simulación. En este modo, operadores ingresan envíos en tiempo real (manual o carga masiva TXT), Simulated Annealing planifica las rutas al instante, y el mapa se actualiza con el estado de los aeropuertos y vuelos reales.

La separación de datos se logra mediante un segundo schema MySQL (`daily_simulation`) con un datasource JPA dedicado en Spring Boot.

---

## Backend

### Dual datasource (Spring Boot 3)

**Archivos:** `SimDataSourceConfig.java`, `OpsDataSourceConfig.java`

Spring Boot 3 con JPA requiere configuración explícita de ambos datasources cuando se define más de uno. La estrategia elegida fue enrutamiento por paquete de repositorios:

- Repositorios en `com.tasf.backend.repository` → datasource primario (`sim`, schema de simulación)
- Repositorios en `com.tasf.backend.repository.ops` → datasource secundario (`ops`, schema `daily_simulation`)

Ambos usan `hibernate.hbm2ddl.auto=validate` porque los schemas ya existen en la VM/RDS y no deben ser modificados por Hibernate.

**Decisión:** `ddl-auto=validate` en lugar de `update`. El schema `daily_simulation` fue creado manualmente en el servidor antes del deploy. Usar `update` hubiera requerido permisos DDL en producción, lo cual no es deseable.

**Decisión:** Las propiedades de ops tienen fallback al URL de sim (`${OPS_DATASOURCE_URL:${SPRING_DATASOURCE_URL}}`). Esto permite desarrollo local con una sola instancia MySQL que tenga ambos schemas.

---

### OpsEnvioRepository

**Archivo:** `backend/.../repository/ops/OpsEnvioRepository.java`

Extiende `JpaRepository<EnvioEntity, Long>` pero opera sobre el schema `daily_simulation` gracias al enrutamiento por paquete. Reutiliza `EnvioEntity` (misma estructura JPA) para no duplicar entidades.

Queries personalizadas:
- `sumMaletasPendientesByAeropuerto(from)` — para calcular ocupación de almacenes en el mapa
- `findAllPendientesOrdenados()` — insumo para SA planning
- `findAllByOrderByFechaHoraIngresoDesc()` — lista para el frontend

---

### OpsService

**Archivo:** `backend/.../service/OpsService.java`

Centraliza toda la lógica del modo ops:

- **`getLiveState(from)`** — replica el comportamiento de `LiveService` pero consultando `OpsEnvioRepository`. Devuelve `LiveStateDTO` (misma forma que el modo en vivo) para reutilizar el polling del frontend.
- **`addEnvio(dto)`** — convierte `fechaHoraIngreso` (ISO-8601 con offset) a UTC antes de persistir. Calcula SLA automáticamente: 1 día si mismo continente, 2 días si diferente.
- **`planificar()`** — corre SA sobre todos los envíos `PENDIENTE`. Construye `ParametrosSimulacion` en cada llamada (no static) para que `fechaInicio` siempre refleje `LocalDate.now()` al momento de la ejecución.
- **`planesPorEnvio`** — `ConcurrentHashMap<String, PlanDeViaje>` en memoria. Los planes se pierden al reiniciar el servidor, lo cual es aceptable para el contexto de curso.

**Decisión:** Solo SA (no Tabu Search) para el modo ops. Tabu Search está diseñado para incidencias y replanificación masiva, no para planificación instantánea de envíos individuales.

**Decisión:** `planificar()` es idempotente — re-planifica todos los pendientes. No dispara automáticamente al agregar cada envío; el operador elige cuándo planificar.

---

### OpsController

**Archivo:** `backend/.../controller/OpsController.java`

Endpoints bajo `/api/ops/`:

| Método | Ruta | Propósito |
|--------|------|-----------|
| GET | `/api/ops/state?from=ISO` | Estado del mapa (aeropuertos + vuelos activos) |
| POST | `/api/ops/envios` | Ingreso manual de un envío |
| POST | `/api/ops/planificar` | Disparar SA sobre pendientes |
| GET | `/api/ops/envios` | Lista todos los envíos del schema ops |
| GET | `/api/ops/reporte` | KPIs del día (totales, SLA, porcentaje) |

---

### Upload TXT para ops

**Archivos:** `EnvioUploadService.java`, `UploadController.java`

Se añadió `processOpsUpload(file)` a `EnvioUploadService` con `@Transactional("opsTransactionManager")`. Reutiliza `BaggageParser` sin modificaciones — el parser ya produce `List<Envio>` independiente del destino de persistencia.

El endpoint `POST /api/upload/ops/envios` no llama a `SimulationEngine` ni dispara planificación automática. El operador debe hacer clic en "Planificar" manualmente después de cargar archivos.

---

## Frontend

### api.js — funciones ops

**Archivo:** `src/services/api.js`

Se añadieron 6 funciones exportadas y 5 entradas en el objeto `api`:
`getOpsState`, `addOpsEnvio`, `planificarOps`, `getOpsEnvios`, `getOpsReporte`, `uploadOpsEnvios`.

`uploadOpsEnvios` usa `FormData` y `fetch` directamente (igual que `uploadEnvios` existente) hacia `/api/upload/ops/envios`.

---

### OpsEnviosIngress

**Archivo:** `src/components/OpsEnviosIngress.jsx`

Componente de ingreso con 3 zonas:
- **Upload TXT** (izquierda): selección múltiple, validación de patrón `_envios_XXXX_.txt`, upload secuencial con dots de estado por archivo.
- **Formulario manual** (derecha): selectores origen/destino (destino excluye el origen), cantidad, hora local. Muestra la hora actual en el aeropuerto origen calculada del campo `huso`.
- **Botón Planificar**: llama `planificarOps()` y muestra `planesCalculados` / `sinRuta`.

La hora de ingreso se construye como ISO-8601 con offset: `"YYYY-MM-DDTHH:MM:00±HH:00"` usando el `huso` del aeropuerto origen. El backend convierte a UTC con `OffsetDateTime.parse().withOffsetSameInstant(ZoneOffset.UTC)`.

---

### ConfigScreen — selector de modo

**Archivo:** `src/screens/ConfigScreen.jsx`

Se añadió un selector de tabs en la parte superior ("Simulación" | "Operaciones día a día"). El grid existente de simulación se preserva sin cambios en la rama `modoConfig === 'simulacion'`.

En modo `operaciones`:
- **Izquierda (420px):** upload de archivos TXT para el schema ops (usando `api.uploadOpsEnvios`).
- **Derecha (flex-column):**
  - Mitad superior (~45%): formulario manual de ingreso (origen, destino, cantidad, hora con hint de zona horaria).
  - Mitad inferior (~55%): tabla preview de envíos ya cargados en el schema ops.
  - Footer: botón "▶ INICIAR OPERACIONES" que llama `onOperacionesStarted`.

**Decisión:** Diseño horizontal (top/bottom) en la columna derecha, no tres columnas paralelas. La tabla de preview permite confirmar qué hay cargado antes de iniciar.

Los aeropuertos para los selectores se obtienen via `api.getAirports()` al entrar al modo ops (useEffect en `modoConfig`).

---

### OpsScreen

**Archivo:** `src/screens/OpsScreen.jsx`

Basado en `LiveScreen.jsx`. Diferencias clave:
- Props: `opsState` (en lugar de `liveState`).
- Header: "OPERACIONES" en verde (#22c55e).
- Panel izquierdo con 2 tabs: **Filtros** (igual que LiveScreen) y **+ Envíos** (renderiza `OpsEnviosIngress`).
- `ingressAirports` se carga via `api.getAirports()` en mount para tener el campo `huso` (no disponible en `LiveStateDTO`).

---

### App.jsx — wiring

**Archivo:** `src/App.jsx`

- `screen = 'ops'` manejado en `handleNavigate`.
- `startOps()` / `stopOps()` siguen exactamente el mismo patrón que `startLive()` / `stopLive()` (prefetch a 55min, apply a 60min).
- `OpsScreen` se renderiza fuera del bloque de overlay screens (misma posición que `LiveScreen`) para evitar conflictos de z-index.
- `ConfigScreen` recibe `onOperacionesStarted={() => handleNavigate('ops')}`.
- El cleanup `useEffect` llama `stopOps()` al desmontar.

---

## Decisiones transversales

| Decisión | Alternativa descartada | Motivo |
|----------|----------------------|--------|
| Schema separado `daily_simulation` | Tabla ops en mismo schema de sim | Aislamiento total de datos; no afecta rendimiento de sim |
| `ddl-auto=validate` | `ddl-auto=update` | Schema pre-existe en VM/RDS; no dar permisos DDL en prod |
| Planes SA en memoria (`ConcurrentHashMap`) | Persistir planes en tabla ops | Evitar complejidad de serialización de `PlanDeViaje`; planes son efímeros |
| SA solamente (no TS) | SA + TS según parámetro | TS es para replanificación con incidencias; ops es planificación incremental normal |
| Polling 60min en frontend | Polling 2s (igual que sim) | El estado ops cambia despacio (aeropuertos y vuelos reales, no sim); prefetch a 55min + apply a 60min |
| `fechaInicio = LocalDate.now()` en cada `planificar()` | Constante estática `OPS_PARAMS` | Evitar stale date si el servidor corre más de un día |
| Enrutamiento JPA por paquete | Anotación `@Qualifier` en cada repo | Menos invasivo; no modifica repos existentes |

---

## Pendientes conocidos (fuera de alcance de este sprint)

- **Cierre de día a medianoche:** evaluación SLA + snapshot automático. Requiere `@Scheduled` en Spring.
- **EnviosScreen en modo ops:** tabla de envíos ops con detalle de ruta planificada.
- **DashboardScreen en modo ops:** KPIs de ops en pantalla de dashboard.
- **ResultadosScreen en modo ops:** reporte descargable CSV al final del día.
- **Preview de ruta en ConfigScreen:** la tabla preview muestra envíos pero no la ruta calculada por SA.
