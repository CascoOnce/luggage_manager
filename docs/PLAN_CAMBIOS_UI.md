# Plan de Cambios de UI — Luggage Manager

Documento de diseño e implementación. Refleja todas las decisiones discutidas.
Fecha: 2026-05-22

---

## Cambio 1 — Íconos de aeropuerto en el mapa (sin semáforo de color)

### Problema
Los `CircleMarker` de los aeropuertos cambian de color (verde/ámbar/rojo) según el porcentaje de ocupación del almacén. Ese comportamiento de semáforo **no es un requerimiento del problema** para la vista del mapa. El semáforo sí tiene sentido en otras secciones (panel derecho, drawer de aeropuerto) y se conserva intacto en ellas.

### Decisión
- Reemplazar `CircleMarker` por `Marker` con un `DivIcon` personalizado que muestre un SVG de ícono de aeropuerto (torre de control o avión estilizado), más grande (~22 px) y de **color uniforme** independiente del estado del almacén.
- Color fijo: blanco/gris claro en tema oscuro, gris oscuro en tema claro.
- El tooltip existente (IATA, nombre, ocupación) se conserva intacto.
- El `click` handler para abrir `DrawerAeropuerto` se conserva intacto.

### Alcance del semáforo (qué NO cambia)
| Sección | Semáforo | Estado |
|---|---|---|
| Marcador en el mapa | Sí cambia de color | **Se elimina — color uniforme** |
| `RightPanel` — barra de warehouse | Usa color por ocupación | Se conserva |
| `DrawerAeropuerto` — detalle | Usa color por estado | Se conserva |
| `LeftPanel` — leyenda | Explica colores de rutas y rutas replanificadas | Se conserva |

### Archivos afectados
| Archivo | Cambio |
|---|---|
| `src/components/MapView.jsx` | Reemplazar `CircleMarker` por `Marker` + `DivIcon` con SVG de aeropuerto. Eliminar uso de `warehouseStatus()` y `STATUS_COLOR` **solo dentro de MapView** (la importación se elimina de este archivo únicamente). |

### Notas de implementación
- La función `warehouseStatus()` y la constante `STATUS_COLOR` en `src/simulation/statusRules.js` **no se modifican** — otros componentes las siguen usando.
- El ícono se genera con `L.divIcon()` igual que los marcadores de avión existentes, con `iconSize: [22, 22]` y `iconAnchor: [11, 11]`.
- Para evitar recrear el `DivIcon` en cada render, se puede memorizar el ícono por `(theme)` con un `useMemo` o un mapa de caché con `useRef`.

---

## Cambio 2 — Limitar el mapa a las zonas con aeropuertos

### Problema
El mapa muestra el mundo completo (incluyendo Norteamérica, África, Oceanía, Asia Oriental) pero ningún aeropuerto del dataset se encuentra en esas regiones. El espacio vacío desplaza el foco y obliga al usuario a hacer zoom para ver los clusters relevantes.

### Cobertura geográfica real del dataset
Los 30 aeropuertos se distribuyen en tres regiones:

| Región | Lat | Lng | Aeropuertos |
|---|---|---|---|
| América del Sur | -34.5 → +10.6 | -80.1 → -56.3 | 10 (SKBO, SEQM, SVMI, SBBR, SPIM, SLLP, SCEL, SABE, SGAS, SUAA) |
| Europa | +41.4 → +55.6 | +4.7 → +28.0 | 10 (LATI, EDDI, LOWW, EBCI, UMMS, LBSF, LKPR, LDZA, EKCH, EHAM) |
| Asia / Oriente Medio | +15.5 → +40.5 | +35.9 → +77.1 | 10 (VIDP, OSDI, OERK, OMDB, OAKB, OOMS, OYSN, OPKC, UBBB, OJAI) |
| **Bounding box total** | **-35 → +56** | **-81 → +78** | — |

### Decisión
- Eliminar el componente `FitBounds` actual (que ajusta el zoom al ancho de pantalla ignorando la posición de los aeropuertos).
- Reemplazarlo por un componente `FitAirportBounds` que al montar llama a `map.fitBounds([[-40, -85], [60, 82]])` con padding. Esto encuadra exactamente las tres regiones.
- Ajustar `maxBounds` del `MapContainer` a `[[-50, -90], [65, 90]]` para que el usuario pueda hacer pan dentro de ese área pero no salirse al Pacífico vacío o al Atlántico norte.
- `minZoom` fijo en 2.2 (impide alejar tanto que desaparezcan los clusters).

### Archivos afectados
| Archivo | Cambio |
|---|---|
| `src/components/MapView.jsx` | Reemplazar componente `FitBounds` por `FitAirportBounds`. Ajustar props `maxBounds` y `minZoom` del `MapContainer`. |

---

## Cambio 3 — Panel derecho dividido en dos secciones independientes con scroll

### Problema
El `RightPanel` tiene dos secciones: "Vuelos activos" y "Warehouse por aeropuerto". Ambas tienen `flex: 1`, pero cuando una crece en contenido empuja a la otra porque el contenedor no tiene altura fija. Con muchos vuelos activos, la sección de warehouse queda desplazada fuera de la vista.

### Decisión
- Cada sección ocupa exactamente el **50% de la altura total** del panel, de forma fija y sin ceder espacio a la otra.
- Dentro de cada mitad, el área de lista tiene scroll independiente (`overflowY: 'auto'`).
- Si hay 200 vuelos activos, la lista de vuelos scrollea dentro de su mitad superior. La mitad inferior de warehouses no se mueve.
- Un divisor visual (borde horizontal) separa las dos mitades.

### Implementación
```
RightPanel (height: 100%, flexDirection: column, overflow: hidden)
├── Sección vuelos    (flex: 0 0 50%, overflow: hidden, display: flex, flexDirection: column)
│   ├── Título        (flexShrink: 0)
│   └── Lista vuelos  (flex: 1, overflowY: auto)
└── Sección warehouse (flex: 0 0 50%, overflow: hidden, display: flex, flexDirection: column)
    ├── Título        (flexShrink: 0)
    └── Lista airports (flex: 1, overflowY: auto)
```

La clave es `flex: '0 0 50%'` con `minHeight: 0` en cada sección — así no ceden espacio entre ellas aunque el contenido interno crezca.

### Archivos afectados
| Archivo | Cambio |
|---|---|
| `src/components/RightPanel.jsx` | Ajustar estilos de las dos secciones a `flex: '0 0 50%'` con contenedor interno scrollable. |

---

## Cambio 4 — Eliminar polilíneas de rutas del mapa

### Problema
El mapa renderiza tres capas de geometría superpuestas simultáneamente:
1. **Route lines** — una `Polyline` por cada tramo de cada `Envio` activo (potencialmente miles con el dataset completo)
2. **Active flight paths** — una `Polyline` punteada detrás de cada avión activo
3. **Animated markers** — un `Marker` SVG animado por cada avión activo

Las capas 1 y 2 suman potencialmente miles de elementos React + Leaflet en el DOM, sobrecargando el render del mapa.

### Decisión
- **Eliminar completamente** la sección `ROUTE LINES` (el bloque que itera `visibleRoutes` y genera `Polyline` por cada tramo de cada envío). Esta es la mayor fuente de sobrecarga.
- **Eliminar también** la sección `ACTIVE FLIGHT PATHS` (las líneas punteadas detrás de cada avión). Agregan un conjunto adicional de polilíneas sin aportar valor diferencial al tener ya el marcador de avión animado.
- **Conservar únicamente** `ANIMATED FLIGHT MARKERS` — los íconos SVG de avión con posición interpolada. Son el elemento visual de mayor valor y el más eficiente (un `Marker` por avión).

### Impacto en otros archivos
- En `App.jsx`: eliminar el `useMemo` de `backendRoutes` y dejar de pasar las props `routes`, `selectedRoute`, `setSelectedRoute`, `onFlightFromRoute` a `MapView`.
- En `MapView.jsx`: eliminar las props `routes`, `selectedRoute`, `setSelectedRoute`, `onFlightFromRoute`, el índice `flightByLeg`, y el cálculo `visibleRoutes`.

### Archivos afectados
| Archivo | Cambio |
|---|---|
| `src/components/MapView.jsx` | Eliminar secciones `ROUTE LINES` y `ACTIVE FLIGHT PATHS`. Eliminar props asociadas. |
| `src/App.jsx` | Eliminar `useMemo` de `backendRoutes`. Limpiar props a `MapView`. |

### Nota
El filtrado por aeropuerto del Cambio 5 reducirá además los marcadores de avión visibles, completando la mejora de rendimiento.

---

## Cambio 5 — Panel flotante de selección de aeropuertos (overlay sobre el mapa)

### Problema
Con los 30 aeropuertos y cientos de vuelos visibles simultáneamente, el mapa resulta visualmente ruidoso. No existe forma de reducir la visualización a un subconjunto relevante.

### Decisiones de diseño

#### Posición y comportamiento del panel
- El panel es un componente `position: 'absolute'` dentro del `div` del mapa central, **no afecta el grid layout** ni el tamaño del mapa.
- Se ubica sobre el borde **izquierdo** del mapa, centrado verticalmente.
- Un botón de toggle con flecha (`‹` / `›`) permanece siempre visible en el borde, incluso con el panel colapsado.
- Cuando está abierto, el panel se superpone sobre el mapa con un fondo semitransparente con `backdrop-filter: blur`.
- `zIndex: 900` (sobre el mapa, bajo los drawers existentes que están a mayor z-index).

#### Modelo de selección basado en el grafo de vuelos

**Problema clave:** la red de aeropuertos no es completa. No todos los aeropuertos tienen vuelos entre sí. Si el usuario selecciona solo el aeropuerto ABC, mostrar aeropuertos GHI o UHB que no tienen ninguna ruta con ABC no tiene sentido operativo.

**Modelo adoptado: selección explícita + expansión automática por vecindad**

1. El usuario selecciona uno o más aeropuertos **focales** (marcados con checkbox en el panel).
2. El sistema expande automáticamente el conjunto visible: para cada aeropuerto focal, agrega todos los aeropuertos con los que tiene al menos un vuelo directo (sus vecinos en el grafo).
3. **Aeropuertos visibles en el mapa** = aeropuertos focales ∪ vecinos directos de todos los focales.
4. **Vuelos visibles** = vuelos donde origen Y destino pertenecen al conjunto visible.

**Ejemplo:**
- Usuario selecciona: `ABC`
- Grafo indica que ABC vuela a/desde: `SKBO`, `EDDI`, `VIDP`
- Mapa muestra: `ABC`, `SKBO`, `EDDI`, `VIDP`
- Vuelos visibles: todos los vuelos entre {ABC, SKBO, EDDI, VIDP}
- `GHI` y `UHB` no aparecen porque no tienen ninguna ruta con ABC

#### Reglas de validación
- **Mínimo 1 aeropuerto focal** seleccionado en todo momento (0 seleccionados = desactiva el filtro, muestra todos).
- Si el usuario desmarca el último aeropuerto focal, el filtro se desactiva y vuelven a verse los 30.
- Botón "Todos": activa todos los aeropuertos como focales.
- Botón "Ninguno": desactiva el filtro (equivale a seleccionar todos).
- **No existe un mínimo de 2** en la selección focal — con 1 focal ya tiene sentido (se ven sus vecinos).

#### Presentación visual en el panel
- Lista de aeropuertos **agrupada por continente** (América del Sur / Europa / Asia).
- Checkbox a nivel de aeropuerto individual.
- Checkbox a nivel de continente (selecciona/deselecciona todos los de ese grupo).
- Los aeropuertos que serán **auto-incluidos como vecinos** de los focales se muestran con una indicación visual distinta (ej: texto en tono más claro, ícono de "enlace").
- Contador en el pie del panel: `"N aeropuertos seleccionados · M visibles en mapa"`.

### Dónde se construye el grafo de vuelos — decisión: BACKEND

**Opciones evaluadas:**

| Criterio | Frontend (desde `backendState.vuelos`) | Backend (endpoint dedicado) |
|---|---|---|
| Disponibilidad | Solo después de iniciar simulación | Disponible desde el arranque de la app |
| Costo de cómputo | Microsegundos en JS (2,866 vuelos) | Microsegundos en Java, calculado una vez en `@PostConstruct` |
| Semántica | La red de vuelos es dato de simulación | La red de vuelos es dato de infraestructura estática |
| Cambio necesario | Solo frontend | Backend + frontend (llamada extra al arrancar) |

**Decisión: backend**, por dos razones determinantes:
1. **Timing**: el panel de filtro necesita el grafo desde el primer render, antes de que exista un `backendState`. Con frontend, el panel no funciona hasta que el usuario inicia una simulación.
2. **Semántica correcta**: la red de vuelos proviene de `planes_vuelo.txt`, es estática y no cambia durante la simulación. Es un dato de infraestructura, no de estado de simulación.

#### Nuevo endpoint en backend
```
GET /api/airports/graph
```

Respuesta (ejemplo):
```json
{
  "SKBO": ["SEQM", "EDDI", "VIDP", "OMDB"],
  "SEQM": ["SKBO", "SBBR", "LOWW"],
  ...
}
```

Implementación:
- En `DataLoaderService`: al finalizar el `@PostConstruct`, recorrer `getVuelos()` una vez y construir el mapa de adyacencia bidireccional. Cachearlo como campo privado.
- Nuevo método `getAirportGraph()` en `DataLoaderService`.
- Nuevo endpoint `GET /api/airports/graph` en `SimulationController` (o en un nuevo `AirportController` si se prefiere separar responsabilidades).

#### Integración en frontend (App.jsx)
```jsx
// Al montar, junto con la carga de staticAirports:
useEffect(() => {
  api.getAirportGraph().then(setAirportGraph).catch(() => {})
}, [])

// Estado del filtro:
const [focalAirportIds, setFocalAirportIds] = useState(null) // null = sin filtro activo

// Cómputo del conjunto visible (useMemo):
const visibleAirportIds = useMemo(() => {
  if (!focalAirportIds || !airportGraph) return null // null = todos visibles
  const visible = new Set(focalAirportIds)
  for (const id of focalAirportIds) {
    for (const neighbor of (airportGraph[id] || [])) {
      visible.add(neighbor)
    }
  }
  return visible
}, [focalAirportIds, airportGraph])

// Pre-filtrado antes de pasar a MapView:
const visibleAirports = useMemo(() =>
  visibleAirportIds == null
    ? normalizedAirports
    : normalizedAirports.filter(a => visibleAirportIds.has(a.id)),
[normalizedAirports, visibleAirportIds])

// Pre-filtrado de vuelos (dentro del memo que ya depende de simClockMinutes):
// Agregar condición: origin y destination deben estar en visibleAirportIds
```

### Archivos afectados

| Archivo | Cambio |
|---|---|
| `backend/.../service/DataLoaderService.java` | Agregar construcción de grafo de adyacencia en `@PostConstruct`. Agregar método `getAirportGraph()`. |
| `backend/.../controller/SimulationController.java` (o nuevo `AirportController.java`) | Nuevo endpoint `GET /api/airports/graph`. |
| `src/services/api.js` | Agregar función `getAirportGraph()`. |
| `src/App.jsx` | Nuevo state `airportGraph`, `focalAirportIds`, `visibleAirportIds`. Pre-filtrado de `visibleAirports` y `backendFlights`. Colocar `<AirportFilterPanel>` dentro del div del mapa. |
| `src/components/AirportFilterPanel.jsx` | **Nuevo componente**: panel flotante con lista de aeropuertos agrupada por continente, checkboxes, botones Todos/Ninguno, expansión de vecinos. |
| `src/components/MapView.jsx` | Aceptar `airports` ya pre-filtrados (no cambia la firma interna, el filtrado ocurre en App.jsx antes de pasar props). |

---

---

## Cambio 6 — Comportamiento de zoom mejorado: límites, escala de íconos y snap a aeropuertos

### Problema
Tres problemas relacionados con el zoom que aparecieron al implementar el nuevo ícono de pin:

1. **Imprecisión de posición en zoom out máximo** — El `iconAnchor` del `DivIcon` compuesto (pin + letrero) no coincide exactamente con la coordenada del aeropuerto cuando el mapa está muy alejado. El pin visual queda desplazado respecto al punto real.
2. **Zoom in sin límite superior** — No hay `maxZoom` definido en el `MapContainer`. El usuario puede hacer zoom hasta nivel 19 (detalle de calle), lo cual no tiene sentido operativo y degrada el rendimiento.
3. **Íconos de tamaño fijo independiente del zoom** — Los pines se ven bien al zoom mínimo pero se vuelven diminutos al hacer zoom in, ya que Leaflet `DivIcon` no escala con el zoom. Deben crecer progresivamente hasta un tope del ~30% extra sobre su tamaño base (para no disparar recreaciones de DOM en cada nivel).
4. **Zoom in no snappea a aeropuertos** — Al hacer scroll/pinch para acercar, el centro del zoom es el cursor, que puede estar en una zona sin aeropuertos. Debería snappear al aeropuerto más cercano al cursor como centro de zoom.

### Decisiones

#### 6.1 — Corregir `iconAnchor`
El `FaMapMarker` SVG tiene su punto de referencia geográfico en la punta inferior del pin. El `iconAnchor` debe ser `[ancho/2, alto_total]` — exactamente el píxel de la punta. Verificar con las dimensiones actuales del DivIcon compuesto y ajustar.

#### 6.2 — Limitar zoom máximo
Añadir `maxZoom={7}` al `MapContainer`. A nivel 7 se ven claramente los países y ciudades sin llegar a detalle de calle. Los tiles de CartoDB llegan hasta 19 pero no tiene sentido operativo ir más allá de ver en qué país/región está cada aeropuerto.

#### 6.3 — Escala progresiva de íconos por zoom
En lugar de recrear el `DivIcon` en cada cambio de zoom (costoso), usar CSS: envolver el HTML del ícono en un `div` con `transform-origin: bottom center` y aplicar un `transform: scale(X)` calculado según el zoom actual. El `scale` va de `1.0` (zoom mínimo) a `1.3` (zoom máximo), lineal entre ambos extremos.

Implementación: un efecto `map.on('zoom', handler)` dentro de `FitAirportBounds` (o un nuevo componente `IconScaler`) que al cambiar el zoom itera todos los elementos `.airport-pin` del DOM del mapa y actualiza su `transform`. Usar una clase CSS `airport-pin` en el wrapper del DivIcon para seleccionarlos.

**Límite de +30%:** el factor máximo es `1.3` — suficiente para que el pin sea visible en zoom in sin recrear íconos ni disparar re-renders de React.

#### 6.4 — Snap de zoom al aeropuerto más cercano
Interceptar el evento `wheel` y `dblclick` sobre el `MapContainer`. Cuando el usuario inicia un zoom in:
1. Calcular la posición del cursor en coordenadas de mapa (`map.mouseEventToLatLng`).
2. Encontrar el aeropuerto más cercano al cursor (distancia euclídea en lat/lng).
3. Si ese aeropuerto está a menos de N píxeles del cursor (umbral: 200px al zoom actual), hacer el zoom centrado en la coordenada del aeropuerto en lugar del cursor.
4. Si no hay aeropuerto cercano dentro del umbral, dejar el comportamiento por defecto (zoom en el cursor).

Implementación: un componente interno `ZoomSnapper` que recibe la lista de aeropuertos y usa `map.on('wheel')` con `L.DomEvent.preventDefault` para interceptar el scroll antes de que Leaflet lo procese.

**Nota:** solo aplica a zoom in, no a zoom out. Al alejar no tiene sentido forzar un centro.

### Archivos afectados

| Archivo | Cambio |
|---|---|
| `src/components/MapView.jsx` | Corregir `iconAnchor`. Añadir `maxZoom={7}`. Añadir clase `airport-pin` al wrapper del DivIcon. Nuevo componente `IconScaler`. Nuevo componente `ZoomSnapper` (recibe `airportList`). |

### Notas de implementación
- `IconScaler` y `ZoomSnapper` son componentes internos de `MapView.jsx`, no se exportan.
- El `airportIconCache` debe invalidarse si cambia el tema (ya está por clave de tema).
- El umbral de 200px para el snap es configurable como constante `SNAP_THRESHOLD_PX`.

---

## Resumen general

| # | Cambio | Archivos clave | Complejidad |
|---|---|---|---|
| 1 | Íconos de aeropuerto uniformes (sin semáforo en mapa) | `MapView.jsx` | Baja |
| 2 | Limitar mapa a zonas con aeropuertos | `MapView.jsx` | Baja |
| 3 | Panel derecho dividido en dos mitades independientes con scroll | `RightPanel.jsx` | Baja |
| 4 | Eliminar polilíneas de rutas y trayectorias de vuelo | `MapView.jsx`, `App.jsx` | Baja-Media |
| 5 | Panel flotante de filtro por aeropuerto (grafo desde backend) | `DataLoaderService.java`, `SimulationController.java`, `api.js`, `App.jsx`, nuevo `AirportFilterPanel.jsx` | Alta |
| 6 | Zoom mejorado: anchor correcto, maxZoom, escala de íconos, snap a aeropuerto | `MapView.jsx` | Media |

**Orden de implementación recomendado:** 3 → 2 → 1 → 4 → 6 → 5

El 6 depende de que el ícono de aeropuerto (Cambio 1) esté definido. El 5 depende de que el mapa esté en buen estado (Cambios 1-4-6).
