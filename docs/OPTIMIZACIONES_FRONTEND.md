# Optimizaciones de Frontend — Luggage Manager

Análisis realizado el 2026-05-22. Ordenado por impacto en rendimiento y estabilidad.

---

## [CRÍTICO] 1. Tres transformaciones costosas sin `useMemo` en App.jsx

**Archivo:** `App.jsx` líneas 286–325

`normalizedAirports`, `normalizedFlights` y `normalizedRoutes` son transformaciones de listas que pueden tener miles de elementos. Se recalculan en **cada render** de `App` sin ningún memo:

```jsx
// App.jsx línea 286 — sin useMemo, corre en cada render
const normalizedAirports = (simState?.airports || simState?.aeropuertos || []).map((airport) => ({
  ...airport,
  id: airport.id || airport.codigoIATA,
  ...
}))

const normalizedFlights = simState?.vuelos
  ? simState.vuelos.map((flight, idx) => ({ ... }))
  : (simState?.flights || [])

const normalizedRoutes = simState?.envios
  ? simState.envios.map((envio, idx) => ({ ... }))
  : (simState?.routes || [])
```

Como estas variables se pasan como props a `MapView`, `LeftPanel` y `RightPanel`, cada render de `App` genera nuevas referencias de array, forzando a todos esos hijos a re-renderizarse aunque los datos no hayan cambiado.

**Corrección propuesta:**

```jsx
const normalizedAirports = useMemo(() =>
  (simState?.aeropuertos || simState?.airports || []).map((airport) => ({
    ...airport,
    id: airport.id || airport.codigoIATA,
    name: airport.name || airport.nombre,
    continent: airport.continent || airport.continente,
    currentOccupation: airport.currentOccupation ?? airport.ocupacionActual ?? 0,
    warehouseCapacity: airport.warehouseCapacity ?? airport.capacidadAlmacen ?? 600,
  })),
[simState?.aeropuertos, simState?.airports])

// Ídem para normalizedFlights y normalizedRoutes
```

---

## [CRÍTICO] 2. `backendFlights` se recalcula cada segundo aunque los vuelos no cambiaron

**Archivo:** `App.jsx` líneas 358–378

`backendFlights` está en `useMemo` pero tiene `simClockMinutes` como dependencia. `simClockMinutes` se actualiza cada 1000ms por el intervalo del reloj. Esto significa que aunque `backendState.vuelos` no haya cambiado (el backend actualiza cada ~12 segundos), el filtro y mapeo de todos los vuelos corre **cada segundo**:

```jsx
const backendFlights = useMemo(() => {
  if (!backendState?.vuelos) return []
  return backendState.vuelos
    .filter((v) => v.estado === 'activo' && v.enUso)
    .map((v) => {
      const depMin = parseTimeToMinutes(v.horaSalida)
      const arrMin = parseTimeToMinutes(v.horaLlegada)
      if (!isActiveAtMinute(simClockMinutes, depMin, arrMin)) return null  // ← dependencia del reloj
      return { ..., fraction: flightFractionAtMinute(simClockMinutes, depMin, arrMin) }
    })
    .filter(Boolean)
}, [backendState?.vuelos, simClockMinutes])  // ← simClockMinutes hace que recorra todo cada segundo
```

**Corrección propuesta:** Separar en dos memos — uno que filtra/procesa los vuelos (depende solo de `backendState`), y otro que aplica el estado de animación (depende del reloj):

```jsx
// Solo se recalcula cuando cambia el backend (~cada 12 segundos)
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

// Solo aplica posición en el arco — derivado barato
const backendFlights = useMemo(() =>
  activeVuelosWithTimes
    .filter((v) => isActiveAtMinute(simClockMinutes, v.depMin, v.arrMin))
    .map((v) => ({ ..., fraction: flightFractionAtMinute(simClockMinutes, v.depMin, v.arrMin) })),
[activeVuelosWithTimes, simClockMinutes])
```

---

## [ALTO] 3. `activeKpis` crea un objeto nuevo en cada render

**Archivo:** `App.jsx` líneas 405–417

```jsx
// Sin useMemo — nuevo objeto en cada render de App
const activeKpis = backendState?.kpis
  ? {
      bagsInTransit: backendState.kpis.maletasEnTransito,
      bagsDelivered: backendState.kpis.maletasEntregadas,
      ...
    }
  : simState?.kpis ?? { ... }
```

Este objeto se pasa como prop a `TopBar`. Como la referencia cambia en cada render, `TopBar` siempre se re-renderiza aunque los números sean los mismos.

**Corrección propuesta:**

```jsx
const activeKpis = useMemo(() =>
  backendState?.kpis
    ? {
        bagsInTransit: backendState.kpis.maletasEnTransito,
        ...
      }
    : simState?.kpis ?? { bagsInTransit: 0, ... },
[backendState?.kpis, simState?.kpis])
```

---

## [ALTO] 4. Callbacks inline en JSX crean nuevas funciones en cada render

**Archivo:** `App.jsx` líneas 448–580

Varios callbacks se definen directamente en el JSX, lo que genera una nueva función en cada render de `App`:

```jsx
// App.jsx — nuevas funciones en cada render:
onNavigate={(next) => { setConfigOpen(false); setScreen(next) }}
onClose={() => setMapSelectedAirport(null)}   // DrawerAeropuerto
onClose={() => setMapSelectedVuelo(null)}     // DrawerVuelo
onCancel={() => { setScreen('main'); setConfigOpen(false) }}
onSimulationStarted={(state) => { ... startPolling() }}
```

El problema más concreto: `DrawerAeropuerto` y `DrawerVuelo` usan `onClose` en la dependencia de un `useEffect` para el listener de teclado `Escape`. Cada vez que `App` re-renderiza, `onClose` es una nueva función, lo que hace que el `useEffect` se re-ejecute, retire y re-registre el listener de `keydown` en cada render.

**Corrección propuesta:** Usar `useCallback` para los callbacks que se pasan a hijos:

```jsx
const handleNavigate = useCallback((next) => {
  setConfigOpen(false)
  setScreen(next)
}, [])

const handleCloseAirport = useCallback(() => setMapSelectedAirport(null), [])
const handleCloseVuelo   = useCallback(() => setMapSelectedVuelo(null),   [])

// Y en JSX:
<DrawerAeropuerto onClose={handleCloseAirport} ... />
<DrawerVuelo      onClose={handleCloseVuelo}   ... />
```

---

## [ALTO] 5. Estado `running` y su `useEffect` son código muerto

**Archivo:** `App.jsx` líneas 20, 244–271

```jsx
const [running, setRunning] = useState(false)
...
useEffect(() => {
  if (running) {
    intervalRef.current = setInterval(() => {
      // lógica de reloj manual (simDay, simHour, simMin)
    }, 100)
  } else {
    clearInterval(intervalRef.current)
  }
  return () => clearInterval(intervalRef.current)
}, [running, maxDay])
```

`running` nunca se pone a `true` desde ninguna interacción del usuario en el flujo actual. La simulación la maneja `autoStep`. Sin embargo, este `useEffect` está activo y subscribe un interval que se evalúa con cada cambio de `running`. Además, `simDay`, `simHour` y `simMin` (líneas 17-19) son states que este efecto actualiza pero que no se usan en ningún componente visible.

**Corrección propuesta:** Eliminar `running`, `simDay`, `simHour`, `simMin`, `maxDay` y el `useEffect` completo (líneas 244-271). Si se necesita la lógica de reloj manual en el futuro, se puede recuperar del historial de git.

---

## [ALTO] 6. `api.js` sin timeout — requests pueden acumularse indefinidamente

**Archivo:** `src/services/api.js` línea 45

```javascript
const response = await fetch(`${BASE_URL}${path}`, {
  mode: 'cors',
  credentials: 'omit',
  ...options,
})
// Sin AbortSignal ni timeout
```

Si el backend tarda (e.g. el algoritmo SA tarda en planificar), `fetch` espera indefinidamente. Con el polling activo cada 2 segundos, se pueden acumular decenas de requests `GET /state` pendientes en paralelo. Cuando el backend responde, todos se resuelven a la vez y se llama `setBackendState` múltiples veces seguidas.

**Corrección propuesta:**

```javascript
async function request(path, options = {}, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal,
      ...options,
    })
    clearTimeout(timer)
    // ... resto igual
  } catch (error) {
    clearTimeout(timer)
    if (error.name === 'AbortError') throw new Error(`${path} timed out after ${timeoutMs}ms`)
    throw error
  }
}
```

---

## [ALTO] 7. `console.info` en cada request HTTP en producción

**Archivo:** `src/services/api.js` líneas 3–9, 44, 50

```javascript
function debugLog(message, details) {
  if (details !== undefined) {
    console.info(`[api] ${message}`, details)
    return
  }
  console.info(`[api] ${message}`)
}
```

`debugLog` se llama antes y después de **cada request**. Con el polling activo (una llamada cada 2 segundos), esto imprime ~30 líneas por minuto en la consola del usuario en producción. No hay flag de entorno que lo desactive.

**Corrección propuesta:**

```javascript
const IS_DEV = import.meta.env.DEV  // Vite lo provee automáticamente

function debugLog(message, details) {
  if (!IS_DEV) return
  details !== undefined
    ? console.info(`[api] ${message}`, details)
    : console.info(`[api] ${message}`)
}
```

---

## [MEDIO] 8. Polling de errores silencioso — el usuario no ve feedback

**Archivo:** `App.jsx` líneas 127–129

```jsx
} catch (err) {
  console.error('Polling error:', err)
}
```

Si el backend falla repetidamente (caído, timeout, error 500), el usuario solo ve el mapa congelado sin ninguna indicación de que algo falló. No hay contador de errores ni toast de advertencia.

**Corrección propuesta:** Contar errores consecutivos y mostrar un mensaje después de N fallos:

```jsx
const pollingErrorsRef = useRef(0)

// dentro del interval:
try {
  const state = await api.getState()
  pollingErrorsRef.current = 0  // reset en éxito
  ...
} catch (err) {
  pollingErrorsRef.current++
  if (pollingErrorsRef.current >= 3) {
    setPollingError('No se puede contactar el servidor')
  }
}
```

---

## [MEDIO] 9. RightPanel ordena el array de aeropuertos en cada render sin `useMemo`

**Archivo:** `src/components/RightPanel.jsx` líneas 70–77 (aproximado)

```jsx
// Sin useMemo — sort O(n log n) en cada render:
const sorted = [...airportList].sort((a, b) => {
  const pctA = (a.currentOccupation / a.warehouseCapacity) * 100
  const pctB = (b.currentOccupation / b.warehouseCapacity) * 100
  return pctB - pctA
})
const occupiedAirports = sorted.filter(...)
```

**Corrección propuesta:**

```jsx
const occupiedAirports = useMemo(() =>
  [...airportList]
    .sort((a, b) => (b.currentOccupation / b.warehouseCapacity) - (a.currentOccupation / a.warehouseCapacity))
    .filter((a) => a.currentOccupation > 0),
[airportList])
```

---

## [MEDIO] 10. `PerfChart` crea el objeto `data` de Chart.js en cada render

**Archivo:** `src/components/PerfChart.jsx` líneas 28–44

```jsx
// Sin useMemo — nueva referencia en cada render:
const data = {
  labels: throughputHistory.map(...),
  datasets: [{ data: throughputHistory.map(...) }]
}
```

React-Chartjs-2 compara la prop `data` por referencia. Si la referencia cambia en cada render, Chart.js destruye y recrea el canvas, causando un parpadeo visible.

**Corrección propuesta:**

```jsx
const data = useMemo(() => ({
  labels: throughputHistory.map((t) => `Día ${t.dia}`),
  datasets: [{ label: 'Maletas procesadas', data: throughputHistory.map((t) => t.maletasProcesadas) }]
}), [throughputHistory])
```

---

## [MEDIO] 11. `<style>` de animación en Modal se inserta en cada render

**Archivo:** `src/components/Modal.jsx`

El componente Modal inyecta un bloque `<style>` con un `@keyframes` directamente en el JSX. Cada vez que el Modal se renderiza, se agrega una nueva etiqueta `<style>` al `<head>` del documento. Con el tiempo, el DOM acumula estilos duplicados.

**Corrección propuesta:** Mover el `@keyframes` a un archivo CSS global (e.g., `src/styles/animations.css`) que se importe una sola vez.

---

## [BAJO] 12. `makeDivIcon` en MapView no memoiza los iconos de vuelos

**Archivo:** `src/components/MapView.jsx` líneas 78–89

```javascript
function makeDivIcon(selected, angle, theme) {
  return L.divIcon({ ... html: `<svg ...>` })
}
```

Esta función se llama dentro del render por cada marcador de vuelo activo. Leaflet crea un nuevo objeto `DivIcon` en cada llamada, aunque los parámetros sean iguales. Con 50+ vuelos activos, esto genera 50+ objetos nuevos por render.

**Corrección propuesta:** Usar `useMemo` o `useCallback` para cachear los iconos por `(selected, angle, theme)`:

```jsx
const iconCache = useRef(new Map())

function getCachedIcon(selected, angle, theme) {
  const key = `${selected}-${Math.round(angle)}-${theme}`
  if (!iconCache.current.has(key)) {
    iconCache.current.set(key, makeDivIcon(selected, angle, theme))
  }
  return iconCache.current.get(key)
}
```

---

## [BAJO] 13. Sin `Error Boundaries` — un crash silencia toda la aplicación

No existe ningún componente `<ErrorBoundary>` en el árbol. Si un componente como `MapView` lanza una excepción durante el render (e.g., datos del backend en formato inesperado), React desmonta toda la app y el usuario ve una pantalla en blanco sin ningún mensaje de error.

**Corrección propuesta:** Agregar un ErrorBoundary en `main.jsx` y opcionalmente uno alrededor de `MapView`:

```jsx
// src/ErrorBoundary.jsx
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  render() {
    if (this.state.hasError) {
      return <div style={{ padding: 32, color: 'red' }}>
        Error inesperado: {this.state.error?.message}
      </div>
    }
    return this.props.children
  }
}

// main.jsx
<ErrorBoundary><App /></ErrorBoundary>
```

---

## [BAJO] 14. Datos duplicados: `simState` y `backendState` conviven con campos distintos

**Archivo:** `App.jsx` líneas 273–284

```jsx
const simState = backendState ?? {
  currentDay: 0, totalDays: 0,
  kpis: { bagsInTransit: 0, ... },
  airports: staticAirports,
  flights: [], routes: [], ...
}
```

Cuando hay `backendState`, los campos son en español (`diaActual`, `aeropuertos`, `vuelos`, `envios`). Sin `backendState`, los campos son en inglés (`currentDay`, `airports`, `flights`). Esto obliga a que `normalizedAirports` tenga doble chequeo `airport.codigoIATA || airport.id`, y `normalizedFlights` tenga `flight.codigoVuelo || flight.id`, etc. Cualquier campo que se olvide de manejar introduce un bug silencioso.

**Corrección propuesta:** Normalizar el estado vacío con los mismos campos que devuelve el backend, o definir un mapper centralizado que siempre produzca el mismo shape independiente de la fuente.

---

## Resumen de impacto estimado

| # | Problema | Estado | Impacto |
|---|---|---|---|
| 1 | Transformaciones sin `useMemo` (normalizedAirports, etc.) | Pendiente | Alto — re-renders en cada tick |
| 2 | `backendFlights` recalcado cada segundo completo | Pendiente | Alto — CPU cada segundo |
| 3 | `activeKpis` sin `useMemo` | Pendiente | Alto — TopBar re-renderiza siempre |
| 4 | Callbacks inline en JSX (onClose, onNavigate, etc.) | Pendiente | Alto — re-registro de listeners |
| 5 | Estado `running` y reloj manual — código muerto | Pendiente | Medio — dead code, confusion |
| 6 | Sin timeout en `fetch` — requests acumulados | Pendiente | Alto — estabilidad |
| 7 | `console.info` en producción por cada request | Pendiente | Medio — noise en consola |
| 8 | Errores de polling silenciosos | Pendiente | Medio — UX sin feedback |
| 9 | Sort sin `useMemo` en RightPanel | Pendiente | Bajo — CPU en renders |
| 10 | Chart.js data sin `useMemo` en PerfChart | Pendiente | Medio — parpadeo visible |
| 11 | `<style>` duplicado en Modal | Pendiente | Bajo — DOM leak |
| 12 | `makeDivIcon` sin caché | Pendiente | Bajo — objetos Leaflet innecesarios |
| 13 | Sin Error Boundaries | Pendiente | Alto — pantalla blanca en crash |
| 14 | Doble schema de estado (ES/EN) | Pendiente | Medio — bugs silenciosos |
