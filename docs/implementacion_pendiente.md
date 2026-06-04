# Registro de Implementación

**Fecha de cierre:** 2026-06-03
**Estado:** Implementado y commiteado

---

## Prioridad Baja

### Área A — Semáforo en íconos del mapa (`#21`, `#27`)

Los íconos de aeropuertos y aviones en el mapa cambian de color según su nivel de ocupación: verde (normal), amarillo (alto), rojo (crítico), azul (vacío/sin simulación). El color respeta la paleta del sistema (`#22d07a / #f5a623 / #f04b4b`). El avión seleccionado mantiene su color de semáforo con glow.

**Archivo modificado:** `src/components/MapView.jsx`

---

### Área E — Filtros de envíos por origen/destino (`#68`, `#69`)

La pantalla de envíos tiene dos dropdowns (Origen / Destino) con códigos IATA derivados de los envíos cargados. Filtran la tabla en tiempo real sin tocar el backend.

**Archivo modificado:** `src/screens/EnviosScreen.jsx`

---

### Área H — Indicadores globales de ocupación (`#88`, `#90`, `#91`)

El `DashboardScreen` muestra dos KPIs adicionales en su strip superior: **Flota %** (promedio de ocupación de vuelos activos) y **Almacenes %** (promedio de ocupación de aeropuertos), ambos con color de semáforo. Se calculan en `App.jsx` y se pasan como `globalKpis`.

**Archivos modificados:** `src/App.jsx`, `src/screens/DashboardScreen.jsx`, `src/components/TopBar.jsx`

---

## Prioridad Media-Alta

### Área F — Ruta de envío en mapa (`#70`, `#71`, `#72`, `#73`, `#78`)

Desde `DrawerEnvio` aparece el botón **↗ mapa** (visible cuando el envío tiene ≥2 escalas). Al pulsarlo, el drawer se cierra, la app navega a la pantalla principal y se pinta la ruta completa del envío en el mapa como una polyline verde lima (`#a3e635`) sobre todos los tramos del plan de viaje. El click en el mapa borra la ruta resaltada. La función `handleShowEnvioRoute` en `App.jsx` obtiene el plan via `GET /api/envios/{id}` y cruza las escalas con las coordenadas de los aeropuertos ya en el state.

**Archivos modificados:** `src/App.jsx`, `src/components/MapView.jsx`, `src/screens/EnviosScreen.jsx`, `src/drawers/DrawerEnvio.jsx`

---

## Prioridad Alta

### Área C — Inventario de envíos en almacén (`#53`, `#54`, `#56`, `#57`, `#58`, `#59`)

`DrawerAeropuerto` tiene ahora tres tabs:

- **Info** — comportamiento original (vuelos, ocupación, stats)
- **Inventario** — lista de envíos actualmente en el almacén con maletas en estado `EN_ALMACEN` y ubicación = IATA del aeropuerto
- **Planificado** — envíos que entran y salen del aeropuerto hoy según el plan de vuelo activo, con hora estimada y código de vuelo

El backend expone `GET /api/airports/{iata}/inventory` que devuelve un `AirportInventoryDTO` con tres listas. El engine cruza maletas, envíos y escalas en memoria.

**Archivos modificados:** `src/drawers/DrawerAeropuerto.jsx`, `src/services/api.js`
**Archivos nuevos (backend):** `AirportInventoryDTO.java`, `EnvioSummaryDTO.java`
**Archivos modificados (backend):** `SimulationEngine.java`, `SimulationController.java`

---

## Pendiente — Prioridad Media (a cargo de otro compañero)

### Área B — Filtros y ordenamiento de TU (`#44`, `#45`, `#46`, `#48`, `#49`, `#50`, `#51`)

`RightPanel` solo ordena vuelos por ocupación y tiene búsqueda básica. Implementar: filtro por código-patrón (con wildcard `*`), filtro por origen IATA, filtro por destino IATA, orden por hora de salida, orden por hora de llegada, orden por origen, orden por destino. Los campos `departureTime`, `arrivalTime`, `origin`, `destination` ya vienen en el state de vuelos.

**Archivo a modificar:** `src/components/RightPanel.jsx`

---

### Área D — Filtros de almacenes en panel (`#60`, `#61`, `#63`, `#64`)

`RightPanel` lista aeropuertos sin filtros interactivos. Implementar: filtro por código-patrón IATA, filtro por continente, orden por hora de salida de la UT más próxima, orden por hora de llegada de la UT más próxima. Los dos últimos requieren agregar `nextDeparture` y `nextArrival` al `AeropuertoDTO` en backend.

**Archivo a modificar:** `src/components/RightPanel.jsx`
**Backend (menor):** agregar 2 campos a `AeropuertoDTO` y calcularlos en `SimulationController.getAirports()`

---

### Área G — Vinculación panel → mapa y filtros reflejados (`#74`, `#84`, `#85`, `#86`, `#87`)

Solo el sentido mapa→panel está implementado. Implementar: click en aeropuerto del panel hace `flyTo` en el mapa; filtros de semáforo activos en el panel reducen opacidad de íconos no filtrados en el mapa (pasar `filteredAirportIatas` a `MapView`).

**Archivos a modificar:** `src/App.jsx`, `src/components/MapView.jsx`, `src/components/RightPanel.jsx`
