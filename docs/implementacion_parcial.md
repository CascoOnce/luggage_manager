# Documento de Implementación — Ítems Parciales

**Fecha:** 2026-06-02
**Total de ítems:** 14
**Prioridad:** Alta — estos ítems ya tienen base implementada; el esfuerzo de completarlos es menor

---

## P1 — Semáforo de color en íconos de UT (`#40`)

**Gap:** La barra de ocupación en `RightPanel` muestra el número, pero no usa código de color semáforo (verde/ámbar/rojo). El ícono del avión en el mapa tiene color fijo.

**Archivos a modificar:**
- `src/components/RightPanel.jsx`

**Cambio:**
```jsx
// En la barra de capacidad de cada vuelo
const color = pct >= 0.85 ? '#ef4444' : pct >= 0.6 ? '#f59e0b' : '#22c55e';
// Aplicar `color` como fondo de la barra de progreso
```

**Complejidad:** Baja — solo cambio visual en la barra existente.

---

## P2 — Línea de tramo automática al inicio de vuelo (`#31`, `#33`)

**Gap:** La polyline origen-destino solo aparece al hacer click en el avión. El requerimiento pide que aparezca automáticamente al inicio del vuelo.

**Archivos a modificar:**
- `src/components/MapView.jsx`

**Cambio:**
Renderizar una `Polyline` para cada vuelo activo sin requerir selección del usuario. La polyline debe usar el origen y destino del vuelo con estilo diferenciado (línea punteada o semi-transparente para no saturar el mapa):

```jsx
{activeFlights.map(flight => (
  <Polyline
    key={flight.code}
    positions={[[flight.originLat, flight.originLng], [flight.destLat, flight.destLng]]}
    pathOptions={{ color: '#60a5fa', weight: 1.5, dashArray: '4 6', opacity: 0.5 }}
  />
))}
```

Mantener la polyline resaltada (opacidad/grosor mayor) al hacer click.

**Complejidad:** Baja-Media — las coordenadas ya están en el estado; solo agregar el render.

---

## P3 — Búsqueda de UT por código completo (`#41`)

**Gap:** La búsqueda en `RightPanel` filtra vuelos activos por código, pero es limitada al panel de vuelos activos. No cubre búsqueda por "tramo" (par origen-destino).

**Archivos a modificar:**
- `src/components/RightPanel.jsx`

**Cambio:**
Extender el filtro de texto para que también coincida con `${flight.origin}-${flight.destination}`:

```jsx
const filtered = flights.filter(f =>
  f.code.toLowerCase().includes(search) ||
  `${f.origin}-${f.destination}`.toLowerCase().includes(search)
);
```

**Complejidad:** Baja.

---

## P4 — Búsqueda de UT por aeropuerto de origen y destino (`#42`, `#43`)

**Gap:** `AirportFilterPanel` filtra aeropuertos visibles en el mapa, no filtra la lista de TUs del `RightPanel`.

**Archivos a modificar:**
- `src/components/RightPanel.jsx`
- `src/App.jsx` (pasar filtro de origen/destino como prop)

**Cambio:**
Agregar dos selectores en `RightPanel` (o usar el filtro global existente de `AirportFilterPanel`) para filtrar los vuelos de la lista por `flight.origin` o `flight.destination`:

```jsx
// RightPanel: agregar estado local
const [filterOrigin, setFilterOrigin] = useState('');
const [filterDest, setFilterDest] = useState('');

const filtered = flights.filter(f =>
  (!filterOrigin || f.origin === filterOrigin) &&
  (!filterDest || f.destination === filterDest)
);
```

Opcional: reutilizar el `selectedOrigins` de `AirportFilterPanel` para mantener coherencia.

**Complejidad:** Media — requiere coordinar estado entre componentes.

---

## P5 — Ordenamiento de almacenes por ocupación (interactivo) (`#62`)

**Gap:** Los aeropuertos en `RightPanel` aparecen con barras de ocupación pero el orden no es interactivo. El usuario no puede ordenar ascendente/descendente.

**Archivos a modificar:**
- `src/components/RightPanel.jsx`

**Cambio:**
Agregar botón de toggle de orden al header de la sección de aeropuertos:

```jsx
const [sortDir, setSortDir] = useState('desc'); // desc = mayor primero
const sortedAirports = [...airports].sort((a, b) =>
  sortDir === 'desc' ? b.occupancyPct - a.occupancyPct : a.occupancyPct - b.occupancyPct
);
```

**Complejidad:** Baja.

---

## P6 — Acceso a envíos/productos de UT desde LiveScreen (`#38`, `#39`)

**Gap:** `DrawerVuelo` muestra los envíos del vuelo solo en modo simulación. En `LiveScreen` (modo operaciones) no hay acceso a este detalle.

**Archivos a modificar:**
- `src/screens/LiveScreen.jsx`
- `src/drawers/DrawerVuelo.jsx`

**Cambio:**
`LiveScreen` ya muestra vuelos activos. Al hacer click en un vuelo, abrir `DrawerVuelo` con los datos del endpoint `GET /api/flights/{code}/envios`. El drawer ya existe; solo hay que conectarlo desde LiveScreen:

```jsx
// LiveScreen.jsx
const [selectedFlight, setSelectedFlight] = useState(null);
// Al click en un vuelo:
setSelectedFlight(flight);
// Renderizar:
{selectedFlight && <DrawerVuelo flight={selectedFlight} onClose={() => setSelectedFlight(null)} />}
```

**Complejidad:** Media — LiveScreen requiere importar y conectar el drawer.

---

## P7 — Tiempo transcurrido en escenario de Operaciones (`#15`)

**Gap:** El cronómetro de tiempo transcurrido existe en la simulación pero no en `LiveScreen`.

**Archivos a modificar:**
- `src/screens/LiveScreen.jsx`
- `src/components/TopBar.jsx` (o directamente en LiveScreen)

**Cambio:**
En `LiveScreen`, calcular el tiempo transcurrido desde que el usuario abrió la sesión de operaciones (usar `useRef` con timestamp inicial):

```jsx
const sessionStart = useRef(Date.now());
const [elapsed, setElapsed] = useState(0);

useEffect(() => {
  const id = setInterval(() => setElapsed(Date.now() - sessionStart.current), 60000);
  return () => clearInterval(id);
}, []);
// Mostrar elapsed formateado como HH:MM
```

**Complejidad:** Baja.

---

## P8 — Múltiples visualizadores con interacción independiente (`#5`, `#6`)

**Gap:** La arquitectura actual tiene un `SimulationEngine` singleton. Varios navegadores pueden ver el estado pero no pueden tener simulaciones independientes.

**Archivos a modificar:**
- `backend/src/main/java/com/tasf/backend/simulation/SimulationEngine.java`
- `backend/src/main/java/com/tasf/backend/controller/SimulationController.java`

**Cambio (mínimo viable):**
Agregar identificador de sesión (`sessionId`) como parámetro query en los endpoints. El engine mantiene un `Map<String, SimulationState>` en lugar de una instancia única. Cada cliente usa su propio `sessionId` (UUID generado al conectarse):

```java
// SimulationController
@PostMapping("/start")
public ResponseEntity<?> start(@RequestParam String sessionId, @RequestBody ParametrosSimulacion p) {
    engine.inicializar(sessionId, p);
    ...
}
```

**Complejidad:** Alta — cambio estructural al backend; riesgo de regresión en tests existentes.

---

## P9 — Reporte final con estado completo de plan (`#95`, `#97`)

**Gap:** `ResultadosScreen` muestra métricas pero los vuelos que no terminaron el último día quedan como EN_TRANSITO, sin cierre explícito en el reporte.

**Archivos a modificar:**
- `backend/src/main/java/com/tasf/backend/simulation/SimulationEngine.java`
- `src/screens/ResultadosScreen.jsx`

**Cambio:**
Al llamar a `POST /simulation/stop`, el engine marca todos los envíos EN_TRANSITO como RETRASADO o PLANIFICADO con flag `noCompletado=true`. `ResultadosScreen` muestra una sección adicional "Envíos no completados al cierre" con el listado:

```jsx
const noCompletados = envios.filter(e => e.estado === 'PLANIFICADO' || e.estado === 'EN_TRANSITO');
// Renderizar sección al final del reporte
```

**Complejidad:** Media — requiere cambio en el backend y en la UI.

---

## Resumen de prioridad

| Ítem | Reqs | Complejidad | Recomendación |
|------|------|-------------|---------------|
| P2 — Línea automática de tramo | #31, #33 | Baja | Implementar primero — alta visibilidad |
| P1 — Semáforo en UT (RightPanel) | #40 | Baja | Rápido — solo CSS |
| P5 — Sort interactivo almacenes | #62 | Baja | Rápido |
| P3 — Búsqueda por tramo | #41 | Baja | Rápido |
| P7 — Cronómetro en LiveScreen | #15 | Baja | Rápido |
| P4 — Filtrar UT por origen/destino | #42, #43 | Media | Segunda ronda |
| P6 — DrawerVuelo en LiveScreen | #38, #39 | Media | Segunda ronda |
| P9 — Reporte de plan completo | #95, #97 | Media | Segunda ronda |
| P8 — Multi-sesión | #5, #6 | Alta | Solo si hay tiempo |
