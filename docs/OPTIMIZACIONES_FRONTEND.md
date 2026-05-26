# Optimizaciones de Frontend — Luggage Manager

Análisis realizado el 2026-05-22. Implementación completada el 2026-05-23.
Ordenado por impacto en rendimiento y estabilidad.

---

## [CRÍTICO] 1. Tres transformaciones costosas sin `useMemo` en App.jsx

**Archivo:** `App.jsx`

**Estado: ✅ IMPLEMENTADO**

`normalizedAirports`, `normalizedFlights` y `normalizedRoutes` envueltos en `useMemo` con dependencias precisas:

```jsx
const normalizedAirports = useMemo(() =>
  (simState?.aeropuertos || simState?.airports || []).map((airport) => ({ ... })),
[simState?.aeropuertos, simState?.airports])

const normalizedFlights = useMemo(() =>
  simState?.vuelos ? simState.vuelos.map(...) : (simState?.flights || []),
[simState?.vuelos, simState?.flights])

const normalizedRoutes = useMemo(() =>
  simState?.envios ? simState.envios.map(...) : (simState?.routes || []),
[simState?.envios, simState?.routes])
```

**Nota:** `normalizedFlights` y `normalizedRoutes` existen en el código pero actualmente no se pasan como props a ningún componente hijo (el mapa usa `backendFlights`, los screens usan `simState` directamente). El memo evita el trabajo de transformación de igual forma.

---

## [CRÍTICO] 2. `backendFlights` se recalculaba cada segundo aunque los vuelos no cambiaron

**Archivo:** `App.jsx`

**Estado: ✅ IMPLEMENTADO**

Separado en dos memos encadenados:

```jsx
// Solo corre cuando cambia backendState (~cada 12s)
const activeVuelosWithTimes = useMemo(() => {
  if (!backendState?.vuelos) return []
  return backendState.vuelos
    .filter((v) => v.estado === 'activo' && v.enUso)
    .map((v) => ({
      ...v,
      depMin: parseTimeToMinutes(v.horaSalida),
      arrMin: parseTimeToMinutes(v.horaLlegada),
    }))
}, [backendState?.vuelos])

// Corre cada segundo pero solo sobre la lista ya filtrada
const backendFlights = useMemo(() =>
  activeVuelosWithTimes
    .filter((v) => isActiveAtMinute(simClockMinutes, v.depMin, v.arrMin) && ...)
    .map((v) => ({ ...v, fraction: flightFractionAtMinute(...) })),
[activeVuelosWithTimes, simClockMinutes, originSet, destSet])
```

---

## [ALTO] 3. `activeKpis` creaba un objeto nuevo en cada render

**Archivo:** `App.jsx`

**Estado: ✅ IMPLEMENTADO**

```jsx
const activeKpis = useMemo(() =>
  backendState?.kpis ? { ... } : simState?.kpis ?? { ... },
[backendState?.kpis, simState?.kpis])
```

---

## [ALTO] 4. Callbacks inline en JSX creaban nuevas funciones en cada render

**Archivo:** `App.jsx`

**Estado: ✅ IMPLEMENTADO**

`stopPolling` y `startPolling` convertidos a `useCallback` primero (necesario para que los handlers downstream sean estables). Luego los handlers nombrados:

```jsx
const stopPolling  = useCallback(() => { ... }, [])
const startPolling = useCallback(() => { ... }, [stopPolling])

const handleNavigate          = useCallback((next) => { setConfigOpen(false); setScreen(next) }, [])
const handleCloseAirport      = useCallback(() => setMapSelectedAirport(null), [])
const handleCloseVuelo        = useCallback(() => setMapSelectedVuelo(null),   [])
const handleBackToMain        = useCallback(() => setScreen('main'),            [])
const handleCancelConfig      = useCallback(() => { setScreen('main'); setConfigOpen(false) }, [])
const handleSimulationStarted = useCallback((state, params) => { ...; startPolling() }, [startPolling])
```

**Pendiente menor:** Los tres toggle buttons de paneles (`setLeftOpen`, `setFilterOpen`, `setRightOpen`) siguen inline — son `onClick` simples sin `useEffect` downstream, no causan el problema de re-registro de listeners.

---

## [ALTO] 5. Estado `running` y su `useEffect` eran código muerto

**Archivo:** `App.jsx`

**Estado: ✅ IMPLEMENTADO**

Eliminados: `running`, `simDay`, `simHour`, `simMin`, `maxDay`, `intervalRef`, el `useEffect` del reloj manual (lines originales 244–280), y la prop `running={running}` en TopBar.

`TopBar` usa `effectiveRunning = isRunning !== undefined ? isRunning : running` — como `isRunning={autoStep}` siempre se pasa, la prop era un fallback que nunca se activaba.

---

## [ALTO] 6. `api.js` sin timeout — requests podían acumularse indefinidamente

**Archivo:** `src/services/api.js`

**Estado: ✅ IMPLEMENTADO — con corrección post-implementación**

Timeout base de 10s con `AbortController`. Timeouts específicos por endpoint pesado:

```javascript
async function request(path, options = {}, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(..., { signal: controller.signal, ...options })
    clearTimeout(timer)
    ...
  } catch (error) {
    clearTimeout(timer)
    if (error.name === 'AbortError') throw new Error(`${path} timed out after ${timeoutMs}ms`)
    throw error
  }
}
```

| Endpoint | Timeout | Razón |
|---|---|---|
| `/simulation/start` | 180 000 ms (3 min) | SA/Tabu Search puede tardar 60–120s |
| `/simulation/step` | 60 000 ms (1 min) | Procesamiento de un día completo |
| `/simulation/restart` | 180 000 ms (3 min) | Replanning completo |
| Todo lo demás | 10 000 ms | Lecturas y operaciones simples |

**Corrección aplicada:** la implementación inicial usaba 10s para todos los endpoints, lo que cortaba `/simulation/start` prematuramente. Se diferenciaron los timeouts por operación.

**Nota:** `exportarExperimentos` usa `fetch` directo sin pasar por `request()`, por lo que no tiene timeout. Pendiente si se vuelve un problema.

---

## [ALTO] 7. `console.info` en cada request HTTP en producción

**Archivo:** `src/services/api.js`

**Estado: ✅ IMPLEMENTADO**

```javascript
const IS_DEV = import.meta.env.DEV

function debugLog(message, details) {
  if (!IS_DEV) return
  details !== undefined
    ? console.info(`[api] ${message}`, details)
    : console.info(`[api] ${message}`)
}
```

---

## [MEDIO] 8. Polling de errores silencioso — el usuario no veía feedback

**Archivo:** `App.jsx`

**Estado: ✅ IMPLEMENTADO**

```jsx
const pollingErrorsRef = useRef(0)
const [pollingError, setPollingError] = useState(null)

// en startPolling:
try {
  ...
  pollingErrorsRef.current = 0
  setPollingError(null)
} catch (err) {
  pollingErrorsRef.current += 1
  if (pollingErrorsRef.current >= 3) setPollingError('No se puede contactar el servidor')
}
```

Banner rojo en esquina inferior derecha con botón ✕ para cerrarlo. Se limpia automáticamente al reconectar. El contador se resetea también en `handleReset`.

---

## [MEDIO] 9. RightPanel ordenaba el array de aeropuertos en cada render sin `useMemo`

**Archivo:** `src/components/RightPanel.jsx`

**Estado: ✅ IMPLEMENTADO**

```jsx
const { occupiedAirports, hiddenCount } = useMemo(() => {
  const sorted = [...airportList].sort((a, b) => ...)
  const occupied = sorted.filter((ap) => (ap.currentOccupation ?? ...) > 0)
  return { occupiedAirports: occupied, hiddenCount: sorted.length - occupied.length }
}, [airportList])
```

---

## [MEDIO] 10. `PerfChart` creaba el objeto `data` de Chart.js en cada render

**Archivo:** `src/components/PerfChart.jsx`

**Estado: ✅ IMPLEMENTADO**

```jsx
const data = useMemo(() => ({
  labels: throughputHistory.map((t) => t.day),
  datasets: [ ... ]
}), [throughputHistory])
```

---

## [MEDIO] 11. `<style>` de animación en Modal se insertaba en cada render

**Archivo:** `src/components/Modal.jsx`, `src/styles/index.css`

**Estado: ✅ IMPLEMENTADO**

`@keyframes modalIn` movido a `src/styles/index.css` junto a las otras animaciones (`spin`, `pulse-dot`, `flight-glow`). Eliminado el bloque `<style>` del JSX de Modal.

---

## [BAJO] 12. `makeDivIcon` en MapView no memoizaba los iconos de vuelos

**Archivo:** `src/components/MapView.jsx`

**Estado: ✅ IMPLEMENTADO — con corrección de import**

Cache por `(selected, ángulo_redondeado, theme)` dentro de `FlightLayer`:

```jsx
const iconCache = useRef(new Map())
const prevThemeRef = useRef(theme)

// Invalida caché al cambiar tema
if (prevThemeRef.current !== theme) {
  iconCache.current.clear()
  prevThemeRef.current = theme
}

// En el render loop:
const cacheKey = `${isSelected ? 1 : 0}-${Math.round(angle)}-${theme}`
if (!iconCache.current.has(cacheKey)) {
  iconCache.current.set(cacheKey, makeDivIcon(isSelected, angle, theme))
}
const icon = iconCache.current.get(cacheKey)
```

**Error cometido y corregido:** se olvidó agregar `useRef` al import de `MapView.jsx`, causando crash en runtime. Corregido añadiendo `useRef` al import de React.

---

## [BAJO] 13. Sin `Error Boundaries` — un crash silenciaba toda la aplicación

**Archivos:** `src/ErrorBoundary.jsx` (nuevo), `src/main.jsx`

**Estado: ✅ IMPLEMENTADO**

```jsx
// src/ErrorBoundary.jsx — clase con getDerivedStateFromError
// Muestra: icono ⚠, mensaje de error, botón "Recargar"
// Estilos alineados con el theme oscuro del proyecto

// src/main.jsx
<React.StrictMode>
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
</React.StrictMode>
```

---

## [MEDIO] 14. Datos duplicados: `simState` y `backendState` conviven con campos distintos

**Archivo:** `App.jsx`

**Estado: ⏳ PENDIENTE**

Cuando hay `backendState`, los campos son en español (`diaActual`, `aeropuertos`, `vuelos`, `envios`). Sin `backendState`, los campos son en inglés (`currentDay`, `airports`, `flights`). Esto obliga a dobles checks en `normalizedAirports` (`airport.codigoIATA || airport.id`), `normalizedFlights`, etc.

**Corrección propuesta:** normalizar el estado vacío con los mismos campos que devuelve el backend, o definir un mapper centralizado que siempre produzca el mismo shape. Requiere coordinación con el backend para fijar el contrato de la API.

---

## Resumen de estado

| # | Problema | Estado | Impacto |
|---|---|---|---|
| 1 | Transformaciones sin `useMemo` (normalizedAirports, etc.) | ✅ Implementado | Alto — re-renders en cada tick |
| 2 | `backendFlights` recalculado cada segundo completo | ✅ Implementado | Alto — CPU cada segundo |
| 3 | `activeKpis` sin `useMemo` | ✅ Implementado | Alto — TopBar re-renderizaba siempre |
| 4 | Callbacks inline en JSX | ✅ Implementado | Alto — re-registro de listeners |
| 5 | Estado `running` y reloj manual — código muerto | ✅ Implementado | Medio — dead code eliminado |
| 6 | Sin timeout en `fetch` | ✅ Implementado (timeouts por endpoint) | Alto — estabilidad |
| 7 | `console.info` en producción por cada request | ✅ Implementado | Medio — noise en consola |
| 8 | Errores de polling silenciosos | ✅ Implementado | Medio — UX con feedback |
| 9 | Sort sin `useMemo` en RightPanel | ✅ Implementado | Bajo — CPU en renders |
| 10 | Chart.js data sin `useMemo` en PerfChart | ✅ Implementado | Medio — parpadeo visible |
| 11 | `<style>` duplicado en Modal | ✅ Implementado | Bajo — DOM leak |
| 12 | `makeDivIcon` sin caché | ✅ Implementado | Bajo — objetos Leaflet innecesarios |
| 13 | Sin Error Boundaries | ✅ Implementado | Alto — pantalla blanca en crash |
| 14 | Doble schema de estado (ES/EN) | ⏳ Pendiente | Medio — bugs silenciosos |
