# Documento de Implementación — Ítems Nada/Poco

**Fecha:** 2026-06-02
**Total de ítems:** 35
**Agrupados por área funcional para facilitar implementación incremental**

---

## Área A: Semáforo de Color en Íconos del Mapa (`#21`, `#27`)

**Reqs:**
- `#21` Ícono de almacén cambia colores (semáforo+vacío) según stock
- `#27` Ícono de UT cambia colores (semáforo-vacío) según stock

**Estado actual:** Íconos con color fijo; la lógica de semáforo existe en `LiveService` (GREEN/AMBER/RED) pero no se aplica al render del ícono.

**Archivos a modificar:**
- `src/components/MapView.jsx`

**Implementación:**

Para los marcadores de aeropuerto, reemplazar el ícono estático por uno dinámico cuyo color dependa del `trafficLight` del aeropuerto:

```jsx
const airportColor = (trafficLight) => ({
  GREEN: '#22c55e',
  AMBER: '#f59e0b',
  RED: '#ef4444',
  EMPTY: '#6b7280',
}[trafficLight] ?? '#3b82f6');

// En el marcador:
const icon = L.divIcon({
  html: `<div style="background:${airportColor(airport.trafficLight)};border-radius:50%;width:20px;height:20px;..."></div>`,
  className: '',
});
```

Para el ícono del avión, calcular el porcentaje de ocupación (`bagsOnBoard / capacity`) y aplicar el mismo esquema de colores.

**Complejidad:** Baja — datos ya disponibles en el state.

---

## Área B: Filtros y Ordenamiento de TU (`#44`, `#45`, `#46`, `#48`, `#49`, `#50`, `#51`)

**Reqs:**
- `#44` Filtrar TU por patrón de código
- `#45` Filtrar TU por ubicación de origen
- `#46` Filtrar TU por ubicación de destino
- `#48` Ordenar TU por hora de salida
- `#49` Ordenar TU por hora de llegada
- `#50` Ordenar TU por origen
- `#51` Ordenar TU por destino

**Estado actual:** `RightPanel` solo ordena por ocupación y tiene búsqueda de texto básica.

**Archivos a modificar:**
- `src/components/RightPanel.jsx`

**Implementación:**

Agregar una barra de controles sobre la lista de TUs con:
1. Input de filtro por código (con soporte a `*` como wildcard)
2. Selectores de origen y destino (dropdown de IATA)
3. Selector de criterio de ordenamiento (`departureTime | arrivalTime | origin | destination | occupancy`)
4. Toggle ascendente/descendente

```jsx
const [sortBy, setSortBy] = useState('occupancy');
const [sortDir, setSortDir] = useState('desc');
const [filterCode, setFilterCode] = useState('');
const [filterOrigin, setFilterOrigin] = useState('');
const [filterDest, setFilterDest] = useState('');

const processed = flights
  .filter(f => {
    const pattern = filterCode.replace(/\*/g, '.*');
    return (!filterCode || new RegExp(pattern, 'i').test(f.code))
        && (!filterOrigin || f.origin === filterOrigin)
        && (!filterDest || f.destination === filterDest);
  })
  .sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'occupancy') return dir * (b.occupancyPct - a.occupancyPct);
    if (sortBy === 'departureTime') return dir * a.departureTime.localeCompare(b.departureTime);
    if (sortBy === 'arrivalTime') return dir * a.arrivalTime.localeCompare(b.arrivalTime);
    if (sortBy === 'origin') return dir * a.origin.localeCompare(b.origin);
    if (sortBy === 'destination') return dir * a.destination.localeCompare(b.destination);
    return 0;
  });
```

**Complejidad:** Media — los datos de `departureTime`, `arrivalTime`, `origin`, `destination` ya vienen en el state de vuelos.

---

## Área C: Detalle de Envíos y Productos en Almacén (`#53`, `#54`, `#56`, `#57`, `#58`, `#59`)

**Reqs:**
- `#53` Lista de envíos en almacén (destino final y en tránsito)
- `#54` Lista de productos (maletas) en almacén
- `#56` Envíos planificados entrando al almacén
- `#57` Productos planificados entrando al almacén
- `#58` Envíos planificados saliendo del almacén
- `#59` Productos planificados saliendo del almacén

**Estado actual:** `DrawerAeropuerto` muestra vuelos entrantes/salientes pero no los envíos ni maletas que contienen.

**Backend — nuevo endpoint:**

```java
// SimulationController.java
@GetMapping("/airports/{iata}/inventory")
public ResponseEntity<AirportInventoryDTO> getAirportInventory(@PathVariable String iata) {
    // Obtener de SimulationEngine:
    // - envios con destino final = iata y estado EN_ALMACEN
    // - envios en tránsito por iata (escala intermedia)
    // - envios planificados para llegar hoy a iata (próximas escalas)
    // - envios planificados para salir hoy de iata
}
```

**Frontend:**

En `DrawerAeropuerto.jsx`, agregar tabs:
- **"Inventario"** → lista de envíos actuales + maletas (destino final vs en tránsito)
- **"Planificado"** → envíos que entran/salen según el plan

```jsx
// DrawerAeropuerto.jsx
const [tab, setTab] = useState('info'); // 'info' | 'inventory' | 'planned'
// fetch /api/airports/{iata}/inventory cuando tab === 'inventory'
```

**Complejidad:** Alta — requiere nuevo endpoint backend con lógica de cruce de estado actual del engine.

---

## Área D: Filtros de Almacenes en Panel (`#60`, `#61`, `#63`, `#64`)

**Reqs:**
- `#60` Filtrar almacenes por patrón de código
- `#61` Filtrar almacenes por ubicación regional/continental
- `#63` Ordenar almacenes por hora de salida de UT más próxima
- `#64` Ordenar almacenes por hora de llegada de UT más próxima

**Estado actual:** `RightPanel` lista aeropuertos sin filtro ni orden interactivo.

**Archivos a modificar:**
- `src/components/RightPanel.jsx`

**Implementación:**

Similar al Área B pero para la sección de almacenes:

```jsx
const [airportFilter, setAirportFilter] = useState('');
const [continentFilter, setContinentFilter] = useState('');
const [airportSort, setAirportSort] = useState('occupancy');

const processedAirports = airports
  .filter(a => {
    const pattern = airportFilter.replace(/\*/g, '.*');
    return (!airportFilter || new RegExp(pattern, 'i').test(a.iata))
        && (!continentFilter || a.continent === continentFilter);
  })
  .sort((a, b) => {
    if (airportSort === 'nextDeparture') return a.nextDeparture - b.nextDeparture;
    if (airportSort === 'nextArrival') return a.nextArrival - b.nextArrival;
    return b.occupancyPct - a.occupancyPct;
  });
```

Para `nextDeparture` y `nextArrival`, el backend debe incluir estos campos en `AeropuertoDTO`. Se puede calcular en `SimulationController.getAirports()` cruzando con los vuelos activos.

**Complejidad:** Media (frontend) + Baja (backend — agregar 2 campos al DTO).

---

## Área E: Filtros de Envíos (`#68`, `#69`)

**Reqs:**
- `#68` Filtrar envíos por origen
- `#69` Filtrar envíos por destino

**Estado actual:** `EnviosScreen` tiene buscador de texto genérico sin filtros de aeropuerto.

**Archivos a modificar:**
- `src/screens/EnviosScreen.jsx`

**Implementación:**

Agregar dos selectores de aeropuerto (dropdowns IATA) sobre la tabla de envíos:

```jsx
const [filterOrigen, setFilterOrigen] = useState('');
const [filterDestino, setFilterDestino] = useState('');

const filteredEnvios = envios.filter(e =>
  (!filterOrigen || e.origin === filterOrigen) &&
  (!filterDestino || e.destination === filterDestino)
);
```

Los valores de los dropdowns se obtienen de los aeropuertos ya en el estado global.

**Complejidad:** Baja.

---

## Área F: Vinculación de Envío en Mapa (`#70`, `#71`, `#72`, `#73`, `#78`)

**Reqs:**
- `#70` Mostrar ruta de producto (maleta) en mapa por ID
- `#71` Historial de ruta con datos de escalas
- `#72` Mostrar rutas de envío en mapa por ID
- `#73` Historial de ruta de envío con escalas
- `#78` Seleccionar envío en panel → foco en mapa

**Estado actual:** `DrawerEnvio` muestra el plan textual (lista de escalas) pero no lo pinta en el mapa. Click en envío en `EnviosScreen` no produce efecto en el mapa.

**Archivos a modificar:**
- `src/App.jsx` — agregar estado `highlightedRoute`
- `src/components/MapView.jsx` — renderizar polylines de ruta resaltada
- `src/screens/EnviosScreen.jsx` — emitir evento al seleccionar envío
- `src/drawers/DrawerEnvio.jsx` — botón "Ver en mapa"

**Implementación:**

1. En `App.jsx`, agregar estado:
```jsx
const [highlightedRoute, setHighlightedRoute] = useState(null);
// { envioId, legs: [{origin, destination, originLat, originLng, destLat, destLng}] }
```

2. En `DrawerEnvio.jsx`, agregar botón "Ver en mapa" que llama a `onShowInMap(route)`.

3. En `MapView.jsx`, renderizar las polylines de la ruta resaltada con color distinto (ej. verde) y markers en cada escala:

```jsx
{highlightedRoute?.legs.map((leg, i) => (
  <Polyline
    key={i}
    positions={[[leg.originLat, leg.originLng], [leg.destLat, leg.destLng]]}
    pathOptions={{ color: '#a3e635', weight: 3 }}
  />
))}
```

4. En `EnviosScreen.jsx`, al hacer click en un envío, llamar `GET /api/envios/{id}` y pasar el resultado a `setHighlightedRoute`.

Para `#78`, conectar la selección de envío desde el panel de envíos al mapa con el mismo mecanismo.

**Complejidad:** Media-Alta — requiere coordinar estado entre pantallas; las coordenadas de escalas deben venir del endpoint de envío (cruzar con aeropuertos).

---

## Área G: Vinculación Almacén Panel → Mapa (`#74`) y Filtros reflejados en Mapa (`#84`, `#85`, `#86`, `#87`)

**Reqs:**
- `#74` Seleccionar almacén en panel → foco en mapa
- `#84` Filtro semáforo de almacenes en panel → refleja en mapa
- `#85` Filtro semáforo de UT en panel → refleja en mapa
- `#86` Otros filtros de almacenes → reflejan en mapa
- `#87` Otros filtros de UT → reflejan en mapa

**Estado actual:** Solo el sentido mapa→panel está implementado.

**Archivos a modificar:**
- `src/App.jsx` — estado `focusedAirport`, `filteredAirportIatas`, `filteredFlightCodes`
- `src/components/MapView.jsx` — `flyTo` al aeropuerto y resaltar íconos filtrados
- `src/components/RightPanel.jsx` — emitir selección y filtros activos

**Implementación (panel → mapa):**

En `RightPanel`, al click en aeropuerto:
```jsx
onAirportSelect(airport.iata); // callback a App.jsx
```

En `App.jsx`:
```jsx
const handleAirportSelect = (iata) => {
  const airport = airports.find(a => a.iata === iata);
  mapRef.current.flyTo([airport.lat, airport.lng], 5, { duration: 1 });
  setSelectedAirport(airport);
};
```

**Para filtros reflejados en mapa:**

Cuando hay un filtro de semáforo activo (ej. solo mostrar RED), pasar `filteredAirportIatas` a `MapView` para reducir opacidad de los no filtrados:

```jsx
// MapView.jsx — en el ícono del marcador
const isFiltered = filteredIatas.length > 0 && !filteredIatas.includes(airport.iata);
const opacity = isFiltered ? 0.2 : 1.0;
```

**Complejidad:** Media.

---

## Área H: Indicadores Globales (`#88`, `#90`, `#91`)

**Reqs:**
- `#88` Indicador global de ocupación de la flota en conjunto
- `#90` Indicador global de ocupación de almacenes en conjunto
- `#91` Indicador de almacenes en conjunto como semáforo

**Estado actual:** `DashboardScreen` muestra ocupación por aeropuerto individual. `TopBar` tiene KPIs de SLA. No hay valor agregado único para flota ni almacenes.

**Archivos a modificar:**
- `src/components/TopBar.jsx` o `src/screens/DashboardScreen.jsx`

**Implementación:**

Calcular en el frontend a partir del state existente:

```jsx
// Ocupación global de flota (promedio de ocupación de vuelos activos)
const globalFleetOccupancy = activeFlights.length > 0
  ? activeFlights.reduce((acc, f) => acc + f.occupancyPct, 0) / activeFlights.length
  : 0;

// Ocupación global de almacenes (promedio de ocupación de aeropuertos)
const globalWarehouseOccupancy = airports.length > 0
  ? airports.reduce((acc, a) => acc + a.occupancyPct, 0) / airports.length
  : 0;

// Semáforo
const trafficLight = (pct) => pct >= 0.85 ? 'RED' : pct >= 0.6 ? 'AMBER' : 'GREEN';
```

Mostrar como dos KPI cards adicionales en `TopBar` o como cards destacados en `DashboardScreen`.

**Complejidad:** Baja — cálculo en frontend con datos ya disponibles.

---

## Área I: Reporte Diario del Plan (`#96`)

**Req:**
- `#96` Reporte del último plan estable al cerrar operaciones día a día

**Estado actual:** Solo existe `ResultadosScreen` al finalizar la simulación completa. No hay snapshot por día.

**Archivos a modificar:**
- `src/screens/DashboardScreen.jsx`
- `backend/src/main/java/com/tasf/backend/simulation/SimulationEngine.java`
- `backend/src/main/java/com/tasf/backend/controller/SimulationController.java`

**Backend — guardar snapshot diario:**

En `SimulationEngine.avanzarDia()`, al final del día guardar un snapshot del estado:

```java
// Agregar al engine
private Map<Integer, DailyPlanSnapshot> dailySnapshots = new LinkedHashMap<>();

// Al finalizar procesamiento del día:
dailySnapshots.put(currentDay, new DailyPlanSnapshot(
    currentDay, simulatedDate, planDeViajes, kpis
));
```

Agregar endpoint:
```java
@GetMapping("/simulation/daily-report/{day}")
public ResponseEntity<DailyPlanSnapshot> getDailyReport(@PathVariable int day) {
    return engine.getDailySnapshot(day);
}
```

**Frontend:**

En `DashboardScreen`, agregar sección "Reporte del día N" con botón de descarga CSV similar al de `ResultadosScreen`, accesible después de cada paso completado.

**Complejidad:** Alta — requiere persistencia de snapshots en memoria del engine + UI nueva.

---

## Área J: Multi-browser independiente (`#93`)

**Req:**
- `#93` ≥2 navegadores desde dispositivos distintos con interacción independiente

**Estado actual:** Single-tenant; todos los clientes ven y modifican el mismo estado.

**Ver P8 en `implementacion_parcial.md`** — mismo cambio estructural requerido.

**Complejidad:** Alta — cambio arquitectural al backend.

---

## Resumen de prioridad

| Área | Reqs | Complejidad | Impacto visual | Recomendación |
|------|------|-------------|----------------|---------------|
| A — Semáforo en íconos mapa | #21, #27 | Baja | Alto | Primera ronda |
| H — Indicadores globales | #88, #90, #91 | Baja | Alto | Primera ronda |
| E — Filtros de envíos | #68, #69 | Baja | Medio | Primera ronda |
| B — Filtros y orden de TU | #44-51 | Media | Alto | Segunda ronda |
| D — Filtros de almacenes | #60, #61, #63, #64 | Media | Medio | Segunda ronda |
| G — Panel → mapa y filtros | #74, #84-87 | Media | Alto | Segunda ronda |
| F — Ruta de envío en mapa | #70-73, #78 | Media-Alta | Alto | Segunda ronda |
| C — Detalle inventario almacén | #53-59 | Alta | Medio | Tercera ronda |
| I — Reporte diario | #96 | Alta | Medio | Tercera ronda |
| J — Multi-browser | #93 | Alta | Bajo | Solo si hay tiempo |
