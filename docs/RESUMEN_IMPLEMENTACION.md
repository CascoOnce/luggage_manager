# Resumen de Implementación — TASF.B2B Luggage Manager

**Proyecto:** DP1 2026-1 — Simulación de ruteo de maletas multi-aeropuerto  
**Branch:** `main`  
**Última actualización:** 2026-06-01

---

## Lo que se implementó

### Nivel 1 — Mejoras de operación y configuración

#### F-01 · Modo Colapso en ConfigScreen
**Qué se hizo:** Se agregó un selector de período de simulación en la pantalla de configuración. Al elegir "Colapso operacional", aparece un campo adicional para definir el umbral de SLA vencido (%) que dispara la detección.  
**Cómo se ve:** En `ConfigScreen`, el dropdown de período ahora tiene la opción "Colapso operacional". Seleccionarla revela el input de umbral debajo.

#### F-02 · Cronómetros dual en TopBar
**Qué se hizo:** La barra superior ahora muestra dos relojes simultáneos: uno REAL (reloj de pared + tiempo transcurrido desde inicio) y uno SIM (día actual / días totales + fecha simulada).  
**Cómo se ve:** Lado derecho de la TopBar, dos bloques apilados marcados "REAL" (ámbar) y "SIM" (azul).

#### F-03 · Subtab Vuelos en EnviosScreen
**Qué se hizo:** La pantalla de envíos tiene ahora dos pestañas internas: "ENVÍOS" y "VUELOS", permitiendo consultar ambas entidades desde el mismo módulo.  
**Cómo se ve:** Botones de subtab en la parte superior de `EnviosScreen`.

#### F-04 · Multi-upload de archivos de envíos
**Qué se hizo:** El uploader de archivos de envíos acepta múltiples archivos a la vez (los 30 archivos `_envios_*.txt`). La subida es secuencial y filtra duplicados por `idPedido`.  
**Cómo se ve:** El input de archivo en `ConfigScreen` permite selección múltiple. El progreso se muestra archivo por archivo.

#### F-05 · Cancelar vuelo planificado desde DrawerVuelo
**Qué se hizo:** El drawer de detalle de vuelo incluye un botón "CANCELAR VUELO" que llama a `POST /api/simulation/cancel-flight/{code}`, fuerza replanificación con Simulated Annealing.  
**Cómo se ve:** Botón rojo en el footer del `DrawerVuelo`, visible solo cuando el vuelo está en estado PLANIFICADO o EN_TRÁNSITO.

#### B-01 · Deshabilitar Tabu Search (solo SA activo)
**Qué se hizo:** `PlanningService` fue modificado para ignorar la selección de algoritmo y usar siempre Simulated Annealing. El código de Tabu Search permanece en el codebase pero nunca se invoca.  
**Por qué:** El equipo decidió trabajar con un solo algoritmo para simplificar la demo y eliminar comportamiento no determinista en presentaciones.

---

### Nivel 2 — Observabilidad y detalle operacional

#### F-06 · Endpoint envíos por vuelo + DrawerVuelo con asignados
**Qué se hizo:** Nuevo endpoint `GET /api/simulation/flight/{code}/envios` que retorna los envíos asignados a un vuelo específico. El `DrawerVuelo` los muestra en una tabla con estado, origen, destino y cantidad de maletas.  
**Cómo se ve:** Al hacer clic en un vuelo en el mapa o en la lista, el drawer lateral derecho muestra el panel "ENVÍOS ASIGNADOS" con la lista completa.

#### F-07 · Split salidas/llegadas en panel de aeropuerto
**Qué se hizo:** El `DrawerAeropuerto` separa los vuelos en dos pestañas: "SALIDAS" y "LLEGADAS", con filtro por estado.  
**Cómo se ve:** Dos botones toggle en la sección de vuelos del drawer de aeropuerto.

#### F-08 · Búsqueda de aeropuertos y vuelos en AirportFilterPanel
**Qué se hizo:** El panel lateral de filtros incluye inputs de búsqueda para aeropuertos (por código IATA o nombre) y vuelos (por código). Los resultados se filtran en tiempo real.  
**Cómo se ve:** Campos de búsqueda en `AirportFilterPanel`, sobre las listas de aeropuertos y vuelos respectivamente.

#### F-09 · Dwell time en itinerario de envío
**Qué se hizo:** El `DrawerEnvio` muestra, por cada escala del itinerario, el tiempo de espera en el aeropuerto (dwell time) entre llegada y siguiente salida.  
**Cómo se ve:** Columna adicional "ESPERA" en la tabla de escalas del itinerario.

#### F-10 · Historial de vuelos en ResultadosScreen
**Qué se hizo:** La pantalla de resultados incluye una tabla de vuelos con su estado final, mostrando los cancelados y los completados.  
**Cómo se ve:** Nueva sección "HISTORIAL DE VUELOS" en `ResultadosScreen`, con tabla filtrable por estado.

---

### Nivel 3 — Visualización avanzada y detección de colapso

#### F-13 · Ruta de vuelo dividida en tramo recorrido / pendiente
**Qué se hizo:** Al seleccionar un vuelo activo en el mapa, la polilínea de ruta se divide en dos segmentos según el campo `fraction` del vuelo:
- **Tramo recorrido:** color blanco/gris pizarra (`#ffffff` dark / `#64748b` light), weight 2, opacity 0.6, sin guiones.
- **Tramo pendiente:** azul (`#4d9fff`), weight 1.5, opacity 0.7, guionado (`6 5`).

El punto de división usa `mercatorLerp` (interpolación en espacio de píxeles Mercator) para que coincida exactamente con la posición del ícono del avión, evitando el desajuste visual que ocurre con interpolación lineal lat/lng.  
**Cómo se ve:** El avión vuela a lo largo de la ruta; la parte ya recorrida se muestra sólida y tenue, la parte pendiente punteada y brillante.

#### B-08 · Detección automática de colapso operacional
**Qué se hizo:**
- Nueva clase `ColapsoPunto` (dominio) con campos `dia`, `pctSlaVencido`, `aeropuertoMasCritico`, `topAeropuertos`.
- `ParametrosSimulacion` tiene el campo `umbralColapsoPorcentajeSlaVencido` (default 50%).
- `SimulationEngine.avanzarDia()` evalúa al final de cada día, en modo COLAPSO, si el % de envíos RETRASADOS supera el umbral. Cuando se cruza, guarda el snapshot en `colapsoPunto` (no se sobreescribe).
- `SimulationStateDTO` expone `colapsoPunto`.
- Al detectarse, se registra en el log de operaciones: `[COLAPSO] Operación colapsó en Día X — SLA vencido: Y%`.

**Cómo se ve:** El campo `colapsoPunto` aparece en `GET /api/simulation/state` una vez disparado. El frontend lo consume para F-16 y F-17.

---

### Nivel 4 — Respuesta automática al colapso

#### F-16 · Pausa automática y banner de colapso
**Qué se hizo:**
- `App.jsx` monitorea `backendState.colapsoPunto` con un `useRef` (`colapsoPuntoAlertedRef`) para detectar el momento exacto en que aparece por primera vez.
- Al detectarlo: se detiene el auto-step (`setAutoStep(false)`) y se limpia el intervalo — la simulación se pausa automáticamente.
- Se muestra un banner persistente de 32px de alto entre la TopBar y el contenido, con fondo `rgba(240,75,75,0.12)` y borde rojo, indicando día del colapso, % SLA vencido, aeropuerto crítico, y un botón "VER REPORTE →".
- La TopBar muestra una pestaña adicional "⚠ COLAPSO" en rojo cuando `colapsoPunto` existe.

**Cómo se ve:** La simulación se frena sola. Aparece una franja roja translúcida debajo de la barra de navegación. La pestaña ⚠ COLAPSO aparece en la navegación y persiste hasta el reset.

#### F-17 · Pantalla de reporte de colapso (ColapsoScreen)
**Qué se hizo:** Nueva pantalla `ColapsoScreen.jsx` accesible desde la pestaña "⚠ COLAPSO" o el botón del banner. Contiene:
- **3 KPI cards:** Día del colapso, % SLA vencido, aeropuerto más crítico.
- **Gráfico de línea** (react-chartjs-2): evolución del % SLA vencido por día, con el punto del colapso resaltado (radio 6), área bajo la curva en rojo translúcido.
- **Top 5 aeropuertos críticos:** tabla con % ocupación al momento del colapso, coloreado por semáforo (rojo ≥85%, ámbar ≥60%, verde resto). Usa el snapshot `topAeropuertos` capturado en el momento del colapso.
- **Envíos retrasados (muestra):** tabla con los primeros 5 envíos en estado RETRASADO, mostrando ruta y cantidad de maletas.

**Cómo se ve:** Pantalla de análisis post-colapso con estética del sistema (fuente mono, colores del tema). Botón "← VOLVER" regresa a la pantalla anterior. Si no hubo colapso, muestra mensaje informativo.

---

### Nivel 5 — Observabilidad granular de aeropuertos

#### X-11 · Tooltip granular en aeropuertos (B-9, B-16, B-17, B-18)
**Qué se hizo:**
- `AeropuertoDTO` enriquecido con dos campos calculados en backend: `maletasEnAlmacenLocal` (maletas con estado `EN_ALMACEN` cuya `ubicacionActual` es este IATA) y `maletasEnTransitoEntrantes` (maletas `EN_VUELO` cuyo vuelo actual tiene destino este IATA).
- `SimulationEngine.getEstado()` pre-computa dos mapas O(maletas) antes de mapear los aeropuertos a DTO, evitando O(aeropuertos × maletas).
- `App.jsx` `normalizedAirports` agrega `vuelosSalientes` / `vuelosLlegando` contando desde `simState.vuelos` por IATA.
- `MapView.jsx` `<Tooltip>` enriquecido: muestra "En espera: N maletas", "Llegando: M maletas", "Vuelos: X salen · Y llegan" — solo cuando el valor es > 0.

**Cómo se ve:** Al hacer hover sobre cualquier aeropuerto en el mapa, el tooltip incluye el conteo de maletas actualmente en su almacén (incluyendo escalas intermedias), maletas en vuelos que se dirigen hacia él, y conteo de vuelos activos salientes/entrantes.

#### B-35 · Segundos en reloj simulado (TopBar)
**Qué se hizo:** `fechaSimuladaDisplay` en `App.jsx` reformateado a `MM-DD HH:MM:SS`, eliminando el año (que no varía) y agregando los segundos desde `realElapsedSeconds % 60`. El hack de concatenación `:SS` en `TopBar.jsx` fue eliminado.  
**Cómo se ve:** Bloque SIM muestra, por ejemplo, `06-01 08:14:42` actualizado cada segundo.

#### A-1 · Versión explícita en pom.xml
**Qué se hizo:** `backend/pom.xml` actualizado de `0.0.1-SNAPSHOT` a `1.0.0`.  
**Cómo se ve:** Respuesta directa a pregunta A-1 de la rúbrica sobre versión del software.

---

## Stand by — No implementado

### F-11 · Panel de cancelaciones
**Qué es:** Un panel o sección dedicada que lista todos los vuelos cancelados durante la simulación, con el impacto en envíos afectados y el resultado de la replanificación.  
**Por qué stand by:** Requeriría persistir el historial de cancelaciones con su contexto (envíos afectados antes/después del replanning). El `SimulationEngine` actualmente solo registra el log de texto, no una estructura consultable.

### F-12 · Rutas canceladas en mapa
**Qué es:** Visualizar en el mapa las rutas de los vuelos que fueron cancelados, diferenciadas visualmente (ej. polilínea roja o punteada diferente).  
**Por qué stand by:** Los vuelos cancelados se eliminan del estado activo. Para mostrarlos en el mapa habría que mantener una colección separada de vuelos cancelados con sus coordenadas, lo cual implica cambios en `SimulationStateDTO` y en el sistema de capas de `MapView`.

### F-15 · Gráfico histórico de ocupación de almacenes
**Qué es:** Un gráfico que muestra cómo evolucionó la ocupación de los almacenes de los aeropuertos día a día durante la simulación.  
**Por qué stand by:** Requiere B-07 como prerequisito: el backend debe acumular un historial de ocupaciones por aeropuerto por día en `SimulationStateDTO`. Actualmente solo se expone la ocupación actual.

### B-04 · Endpoint GET /api/simulation/cancelaciones
**Qué es:** Nuevo endpoint que expone la lista de cancelaciones de vuelos ocurridas durante la simulación, con tipo (1=programada, 2=en tránsito, 3=masiva), código de vuelo, ruta, fecha/hora y motivo. Es prerequisito de F-11.  
**Por qué stand by:** Requiere enriquecer el objeto `Cancelacion` con el campo `tipo` (B-06) y asegurarse de que todas las rutas de cancelación en `SimulationEngine` lo poblen correctamente. Además, `SimulationEngine` actualmente no expone un método `getCancelaciones()` accesible desde el controller. Scope backend no trivial para el tiempo disponible.

### B-07 · Historial de ocupación de almacenes (backend)
**Qué es:** Acumular en `SimulationEngine` un historial día a día de la ocupación de cada aeropuerto, exponerlo en `SimulationStateDTO` como `Map<String, List<Integer>>` o estructura equivalente.  
**Por qué stand by:** Implica mayor uso de memoria durante la simulación y serialización de una estructura más grande en cada polling. Se dejó para evaluar si el impacto en rendimiento es aceptable antes de implementar.

---

### Mejoras de corrección y pulido (M01 / M04 / M05)

#### M-01 · Protección SLA para envíos cross-midnight
**Qué se hizo:** Envíos cuyo vuelo sale el último día de simulación pero llega al día siguiente (fuera de la ventana) ya no se marcan RETRASADO incorrectamente.
- `isCrossWindow()` helper privado: detecta si el plan activo tiene escala pendiente con `horaLlegadaEst` posterior a `simEnd`.
- `checkSlaViolations()`: salta (`continue`) cualquier envío donde `isCrossWindow` sea true.
- `applySimulationEnd()`: filtra los mismos envíos antes de marcar RETRASADO al cierre de simulación.

**Cómo se ve:** Envíos con vuelos cross-midnight quedan en `EN_TRANSITO` en lugar de aparecer como RETRASADO en el reporte final.

#### M-04 · Pulido de pantallas de reporte

**ResultadosScreen:**
- `sla_cumplido` ahora se calcula desde el ratio real de envíos entregados/total por aeropuerto (`enviosByAirport` memo), no del color del semáforo.
- Columna "Ciudad" agregada a la tabla de aeropuertos (7 columnas).
- Sección "Experimentación numérica" comentada (toda la UI visible al usuario).

**DashboardScreen:**
- Panel "Por continente" incluye "Cumpl. SLA %" por continente, calculado desde envíos reales (verde ≥85%, ámbar ≥70%, rojo <70%).
- Gráfico de throughput incluye línea punteada amarilla en el día actual (`currentDayPlugin` con `afterDraw`).

**ColapsoScreen:**
- Tabla "Top aeropuertos críticos" muestra ciudad como texto muted bajo el IATA.
- Título del panel retrasados: "Envíos retrasados (N de M)" con `totalRetrasados` calculado.
- Empty state explícito cuando `slaData` está vacío: "Sin historial de throughput disponible para este período."

#### M-05 · Revisión del reporte CSV exportado
**Qué se hizo:** `csvDownload()` en `ResultadosScreen` rediseñado:
- Nombre de archivo dinámico: `tasf_reporte_YYYY-MM-DD_dia-N.csv`.
- Metadata agrega `total_replanificaciones` (count de entradas de log con "replan").
- `sla_cumplido` por aeropuerto basado en envíos reales (null → `--`, true → `si`, false → `no`).
- Nueva sección `# ENVIOS` con detalle completo: `id_envio, origen, destino, estado, sla_dias, cumplido`.
- Sección `# AEROPUERTOS` incluye columna `ciudad`.

---

## Resumen por archivo

| Archivo | Cambios principales |
|---|---|
| `ColapsoPunto.java` | Clase nueva: dia, pctSlaVencido, aeropuertoMasCritico, topAeropuertos |
| `ParametrosSimulacion.java` | Campo umbralColapsoPorcentajeSlaVencido, esColapso, horaInicio |
| `SimulationStateDTO.java` | Campo colapsoPunto; endpoint vuelo→envíos |
| `SimulationEngine.java` | Detección colapso, snapshot top aeropuertos, endpoint envíos por vuelo |
| `SimulationController.java` | GET /flight/{code}/envios |
| `PlanningService.java` | Solo SA (TS deshabilitado) |
| `App.jsx` | Ref pausa colapso, banner, ColapsoScreen, props TopBar; normalizedAirports con vuelosSalientes/vuelosLlegando |
| `TopBar.jsx` | Tab condicional ⚠ COLAPSO, prop colapsoPunto; reloj SIM con segundos |
| `MapView.jsx` | Split polilínea F-13, mercatorLerp, colores tramo recorrido; tooltip granular B-9/16/17/18 |
| `ConfigScreen.jsx` | Modo colapso, umbral, multi-upload |
| `ColapsoScreen.jsx` | Nueva pantalla: KPIs + gráfico + tablas |
| `DrawerVuelo.jsx` | Tabla envíos asignados, botón cancelar vuelo |
| `DrawerAeropuerto.jsx` | Split salidas/llegadas |
| `DrawerEnvio.jsx` | Dwell time en escalas |
| `EnviosScreen.jsx` | Subtab Vuelos |
| `ResultadosScreen.jsx` | Historial vuelos |
| `AirportFilterPanel.jsx` | Búsqueda aeropuertos/vuelos |
| `AeropuertoDTO.java` | +maletasEnAlmacenLocal, +maletasEnTransitoEntrantes |
| `SimulationEngine.java` | Pre-cómputo mapas O(maletas) para tooltip; colapsoPunto; endpoint envíos por vuelo |
| `backend/pom.xml` | Versión 1.0.0 |
| `SimulationEngine.java` | M01: `isCrossWindow()`, protección en `checkSlaViolations()` y `applySimulationEnd()` |
| `ResultadosScreen.jsx` | M04: `sla_cumplido` real, columna Ciudad, experimentación comentada; M05: `csvDownload()` renovado |
| `DashboardScreen.jsx` | M04: SLA por continente, línea día actual en gráfico |
| `ColapsoScreen.jsx` | M04: ciudad en top airports, contador retrasados, empty state gráfico |
