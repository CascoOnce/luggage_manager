# Cambios de UI Implementados — Luggage Manager

Fecha de implementación: 2026-05-22  
Branch: `feature/backend`

---

## Resumen

Se implementaron 6 cambios planificados de UI más 3 correcciones adicionales que surgieron durante la implementación. Todos los cambios afectan la vista principal (`'main'`) del dashboard de operaciones.

---

## Cambio 1 — Íconos de aeropuerto con pin + señal

**Archivos:** `src/components/MapView.jsx`

Los aeropuertos pasaron de `CircleMarker` con color semáforo (verde/ámbar/rojo según ocupación) a un `Marker` con ícono personalizado tipo "pin de mapa con señal de aeropuerto".

**Comportamiento:**
- El pin siempre tiene color fijo (azul en tema oscuro, azul oscuro en tema claro), sin cambiar por estado del almacén.
- El semáforo de ocupación se conserva intacto en `RightPanel` y `DrawerAeropuerto` — solo se eliminó del marcador del mapa.
- El tooltip al hacer hover sigue mostrando: código IATA, nombre del aeropuerto, porcentaje de ocupación del almacén.
- El click en el pin sigue abriendo `DrawerAeropuerto`.

**Implementación:**
- `makeAirportIcon(theme)` genera un `L.divIcon` compuesto por `FaMapMarker` (SVG de pin) con `CiAirportSign1` superpuesto.
- Tamaño: 20×27 px. `iconAnchor: [10, 25]` (punta del pin).
- Los atributos `width`/`height` del SVG de react-icons se sobreescriben via regex antes de insertar el HTML, para poder controlar dimensiones con CSS.

---

## Cambio 2 — Mapa limitado a zonas con aeropuertos

**Archivos:** `src/components/MapView.jsx`

El mapa ya no muestra el mundo completo. Se limita al bounding box que cubre las tres regiones con aeropuertos: América del Sur, Europa y Asia/Oriente Medio.

**Comportamiento:**
- Al cargar, el mapa encuadra automáticamente las tres regiones (`[[-40, -85], [60, 82]]`).
- `maxBounds` limita el pan a `[[-50, -90], [65, 90]]` — el usuario no puede desplazarse al Pacífico vacío ni al Atlántico norte.
- El zoom mínimo se recalcula dinámicamente al cambiar el tamaño del contenedor para que los bounds siempre llenen el área visible.

**Implementación:**
- Componente `FitAirportBounds` (usa `useMap()`) con `ResizeObserver` que recalcula `minZoom` via `map.getBoundsZoom()` en cada resize.
- Componente `MapResizer` adicional que llama `map.invalidateSize()` al cambiar tamaño del contenedor.

---

## Cambio 3 — Panel derecho dividido en dos mitades independientes

**Archivos:** `src/components/RightPanel.jsx`

El panel derecho tiene dos secciones: "Vuelos activos" y "Warehouse por aeropuerto". Antes ambas competían por espacio y una desplazaba a la otra.

**Comportamiento:**
- Cada sección ocupa exactamente el 50% de la altura del panel, fija e independiente.
- Cada mitad tiene su propio scroll interno. Con 200 vuelos activos, la lista scrollea dentro de su mitad sin mover la sección de warehouses.
- Hay un divisor visual (borde horizontal) entre las dos mitades.

**Implementación:**
- `flex: '0 0 50%'` + `minHeight: 0` + `overflowY: 'auto'` en cada sección.

---

## Cambio 4 — Sin polilíneas permanentes en el mapa

**Archivos:** `src/components/MapView.jsx`

Se eliminaron las polilíneas que antes mostraban todas las rutas de vuelo activas simultáneamente. Con 30 aeropuertos totalmente conectados, las líneas cubrían todo el mapa haciendo ilegible la visualización.

**Comportamiento:**
- El mapa en estado normal muestra solo los íconos de aeropuerto y los aviones animados.
- La ruta de un vuelo se muestra **solo cuando ese vuelo está seleccionado** (ver Fix 3 más abajo).

---

## Cambio 5 — Panel de filtro origen/destino

**Archivos:** `src/components/AirportFilterPanel.jsx` (nuevo), `src/App.jsx`, `backend/.../DataLoaderService.java`, `backend/.../SimulationController.java`, `src/services/api.js`

Panel lateral que permite filtrar qué aeropuertos y vuelos se muestran en el mapa.

**Comportamiento:**
- El panel ocupa una columna del grid de 4 columnas (no es un overlay flotante).
- Se puede colapsar/expandir con el botón `‹`/`›` en el borde izquierdo del mapa.
- Tiene dos secciones: **Origen** y **Destino**, cada una con lista de aeropuertos agrupados por continente.
- Los continentes son colapsables (clic en la fila del continente abre/cierra el listado).
- **Reglas de selección:**
  - Siempre debe haber al menos 1 origen seleccionado (no se puede desmarcar el último).
  - Si hay exactamente 1 origen seleccionado, ese aeropuerto se oculta de la lista de destinos (no tiene sentido filtar un vuelo de A→A).
  - La sección Destino se deshabilita si no hay ningún origen seleccionado.
  - Botón "Todos" en cada sección restaura la selección completa.
- **Efecto en el mapa:**
  - Solo se muestran aeropuertos que están en el conjunto Origen ∪ Destino seleccionado.
  - Solo se muestran vuelos cuyo origen está en los orígenes seleccionados Y cuyo destino está en los destinos seleccionados.
  - El panel derecho (RightPanel) también refleja el filtro — solo muestra los vuelos visibles.

**Backend:** `DataLoaderService` construye el grafo de adyacencia entre aeropuertos en `@PostConstruct`. `SimulationController` expone `GET /api/airports/graph`. El frontend lo carga al montar pero no lo usa para lógica de vecinos (el grafo es totalmente conectado — cada aeropuerto tiene rutas a todos los demás 29).

---

## Cambio 6 — Zoom mejorado: escala de íconos y snap a aeropuertos

**Archivos:** `src/components/MapView.jsx`

Tres mejoras al comportamiento del zoom:

**6a — Escala de íconos de aeropuerto con el zoom:**
- Componente `IconScaler` escala los elementos `.airport-pin` via CSS `transform: scale()` a medida que el usuario hace zoom, sin recrear los `DivIcon`.
- Escala va de 1× (zoom mínimo) a 1.3× (zoom máximo).

**6b — Snap a aeropuerto al hacer zoom-in:**
- Componente `ZoomSnapper` detecta scroll de rueda hacia adentro.
- Si el cursor está a menos de 200px de algún aeropuerto, el mapa hace pan suave hacia ese aeropuerto.
- No intercepta el zoom — solo reposiciona el centro después del zoom natural de Leaflet.

**6c — Parámetros de zoom suavizados:**
- `zoomSnap: 0.1` y `zoomDelta: 0.5` en `MapContainer` para zoom más fino y fluido.

---

## Fix adicional A — Selección de vuelo en el mapa

**Archivos:** `src/components/MapView.jsx`, `src/App.jsx`

Al hacer click en un avión animado en el mapa, se muestra el drawer lateral de detalle del vuelo (`DrawerVuelo`).

**Comportamiento:**
- Click en avión → abre `DrawerVuelo` con información del vuelo (ruta, carga, trayecto).
- Click nuevamente en el mismo avión → cierra el drawer.
- El botón `›`/`‹` del panel derecho se oculta mientras el drawer está abierto (evita superposición visual).

---

## Fix adicional B — Línea de ruta al seleccionar vuelo

**Archivos:** `src/components/MapView.jsx`

Al seleccionar un vuelo (click en el avión), aparece una línea punteada entre el aeropuerto de origen y el de destino.

**Comportamiento:**
- La línea se muestra mientras el drawer del vuelo esté abierto.
- La línea persiste incluso si la simulación terminó y el vuelo ya no está "activo" (se alimenta de `selectedFlightData` del App, no del array de vuelos activos).
- Estilo: línea azul punteada (`dashArray: '6 5'`), `weight: 1.5`, `opacity: 0.7`.

---

## Fix adicional C — Orientación y posición del avión en la ruta

**Archivos:** `src/components/MapView.jsx`

Los aviones animados apuntan en la dirección correcta de su ruta y se posicionan exactamente sobre la línea de ruta.

**Orientación:**
- El ángulo se calcula en espacio de pantalla Mercator usando `map.latLngToContainerPoint()`, no como bearing geodésico. Esto garantiza que el ícono del avión apunte en la misma dirección que la línea visual en pantalla.
- El cálculo se rehace en cada evento de zoom/movimiento del mapa (`zoom`, `zoomend`, `move`, `moveend`).

**Posición:**
- La posición del avión se interpola en píxeles de pantalla (Mercator) y se convierte de vuelta a lat/lng (`mercatorLerp`). Esto ubica el avión exactamente sobre la línea visual, corrigiendo el error que existía al interpolar linealmente en lat/lng (que diverge de la línea Mercator en rutas intercontinentales largas).

**Centrado del ícono:**
- El SVG del avión tiene el cuerpo en x=11.5/24 del viewBox (no en el centro geométrico x=12).
- `iconAnchor` y `transform-origin` se calculan en función del tamaño real del ícono: `cx = round(size * 11.5 / 24)`, `cy = round(size / 2)`.
- El tamaño se controla con la constante `PLANE_SIZE` — cambiar ese único valor actualiza el ícono completo de forma consistente.

---

## Layout general

El layout de la vista principal es un grid CSS de 4 columnas:

```
[LeftPanel] [FilterPanel] [Map] [RightPanel]
  220px        232px        1fr    300px
```

Cada columna colapsa a `0px` cuando está cerrada. Los botones de toggle están posicionados en los bordes del mapa (`position: absolute`).
