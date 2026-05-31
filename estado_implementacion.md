# Estado de Implementación vs Rúbrica de Evaluación

**Proyecto:** Tasf.B2B — Luggage Manager | **Semestre:** 2026-1 | **Fecha de análisis:** 2026-05-28

> Documento generado a partir de inspección directa del código fuente (Spring Boot backend + React frontend).
> No reemplaza las respuestas formales al evaluador — sirve como guía interna para preparar la defensa y priorizar trabajo pendiente.

---

## Leyenda

| Símbolo | Significado |
|---------|-------------|
| ✅ | Implementado y funcional |
| ⚠️ | Parcialmente implementado — funciona pero incompleto o falta algo visible |
| ❌ | Sin implementar |
| N/A | No aplica al código (artefacto externo / criterio subjetivo del evaluador) |

---

## SECCIÓN A — Respuestas a Preguntas Generales (Pre-escenarios)

> Estos criterios son preguntas descriptivas, no sí/no. Las respuestas reflejan lo que hay en el código.

| # | Criterio | Respuesta | Estado | Notas |
|---|----------|-----------|--------|-------|
| 1 | Versión del software | v1.0 (sin versión explícita en código) | ⚠️ | No hay `pom.xml` version tag definida; inferido de CI/CD |
| 2 | Fecha de subida | Automática vía GitHub Actions al hacer push a `main` | ✅ | CI/CD pipeline en `.github/workflows/ci-cd.yml` |
| 3 | Nombre del algoritmo(s) | **Simulated Annealing** + **Tabu Search** (Java) | ✅ | `SimulatedAnnealingAlgorithm.java`, `TabuSearchAlgorithm.java` |
| 4 | Problemas o pendientes | Ver secciones ⚠️ y ❌ de este documento | — | Estudiantes deben reportar activamente |
| 5 | Desplegado en servidor del lab | Despliegue a EC2 (AWS), no confirmado en lab PUCP | ⚠️ | Ver `ci-cd.yml`; requiere confirmar con laboratorio |
| 6 | Tiempo Ta (ejecución planificador) | ~2–15 segundos según volumen de envíos | ⚠️ | No configurable; parámetros SA/TS hardcoded en código |
| 7 | Tiempo Sa (salto de simulación) | **12 segundos reales = 1 día simulado** | ✅ | `App.jsx`: 120 min/seg → 1440 min = 12 seg/día |
| 8 | Tiempo Sc (monitoreo de operaciones) | **2 segundos** (polling GET `/api/simulation/state`) | ✅ | `App.jsx` loop de polling |
| 9 | Tiempo hasta primera simulación | ~10–30 segundos desde "SIMULAR" (depende de volumen) | ⚠️ | Sin spinner de tiempo estimado |
| 10 | Modo de ejecución del planificador | **Por Demanda**: al inicio + ante cada cancelación | ✅ | `PlanningService`: SA al inicio; TS en incidencias |
| 11 | Registro de envíos de maletas | **GUI** (upload `_envios_*.txt`) + **Script** (pre-seed DB al startup) | ✅ | `ConfigScreen.jsx:165–244`, `DataLoaderService.java` |
| 12 | Carga del mapa mundial | **Hard-code** (Leaflet + aeropuertos de BD al iniciar) | ✅ | `MapView.jsx`, datos de `GET /api/airports` |
| 13 | Registro de flota de vuelos | **Script** (`planes_vuelo.txt` → BD al startup via `@PostConstruct`) | ✅ | `DataLoaderService.java:98–112` |
| 14 | Registro de cancelaciones de vuelos | **GUI** (botón cancel) + **API** `POST /api/simulation/cancel-flight/{code}` | ✅ | `SimulationEngine.java:772–800` |
| 15 | Registro de retrasos/incidencias | **Automático** (5–8% por vuelo/día) + **API** manual | ✅ | `SimulationEngine.java:729–770` |
| 16 | Registro de aeropuertos/almacenes | **Script** (`aeropuertos.txt` → BD al startup) | ✅ | `DataLoaderService.java:76–96` |
| 17 | Carga de planes de vuelo | **Script** (`planes_vuelo.txt` → BD al startup) | ✅ | `DataLoaderService.java:98–112` |
| 18 | Carga de tramos/segmentos aéreos | **Script** (mismos que planes de vuelo; tramos = vuelos) | ✅ | `FlightParser.java` |
| 19 | Gestión de base de datos | **RDBMS** — MySQL 8 en AWS RDS | ✅ | `application-local.properties:10–12` |
| 20 | Carga de data histórica a BD | Auto-seed `@PostConstruct` si tablas vacías; luego query por ventana de fechas | ✅ | `DataLoaderService.java:67–144` |
| 21 | Dataset completo del curso | ✅ **30 aeropuertos**, **2 866 vuelos**, **30 archivos de envíos** seeded | ✅ | `classpath:data/aeropuertos.txt`, `planes_vuelo.txt`, `data/Envios/` |
| 22 | Independencia de carga para 3 escenarios | Misma BD; filtrado en runtime según `ParametrosSimulacion` (dias, esColapso, fechaInicio) | ⚠️ | No hay BD separada por escenario; el filtro de fecha hace la diferencia |

---

## SECCIÓN B — Criterios Completamente Implementados ✅

### Mapa

| # | Descripción | Dónde en el código |
|---|-------------|-------------------|
| B-1 | Se solicita fecha y hora de inicio | `ConfigScreen.jsx:27,154–162` — `<input type="date">` con default `2026-06-01` |
| B-2 | Mapa mundial completo como pantalla principal | `MapView.jsx` — Leaflet con Cartodb basemap, center `[20,0]` |
| B-3 | Aprovecha al máximo la pantalla | Layout full-screen; sidebar colapsable |
| B-4 | Paneles deshabilitados/ocultos al inicio | Tabs ENVÍOS/DASHBOARD grises sin simulación (`TopBar.jsx:165`) |
| B-5 | Aeropuerto principal en posición correcta | Coordenadas de `aeropuertos.txt` → BD → `GET /api/airports` → `MapView.jsx` |
| B-6 | Ícono idóneo para aeropuerto principal | `FaMapMarker` + `CiAirportSign1` superpuestos; contraste configurado por tema |
| B-7 | Stock de maletas en números/porcentaje (hover) | Tooltip: `"Warehouse: XX% (current / capacity)"` en `MapView.jsx` |
| B-8 | Stock de maletas en colores semáforo | Verde/ámbar/rojo según umbral del slider (`LeftPanel.jsx:103–121`) |
| B-12 | Aeropuerto de conexión en posición correcta en mapa | Todos los aeropuertos (incluyendo escalas) mostrados con el mismo sistema |
| B-13 | Ícono idóneo para aeropuerto de conexión | Mismo ícono que aeropuerto principal |
| B-14 | Stock de maletas en aeropuerto de conexión (números/hover) | Mismo tooltip de warehouse |
| B-15 | Stock de conexión en colores semáforo | Mismo sistema de umbrales |
| B-23 | Vuelo en tránsito en posición estimada en mapa | Interpolación `mercatorLerp` en `MapView.jsx:176–184` |
| B-24 | Ícono de avión idóneo para vuelo en tránsito | SVG plane 30×30px, `MapView.jsx:144–162` |
| B-25 | Ícono alineado con el tramo (dirección) | `screenAngle` calculado desde coordenadas pantalla `MapView.jsx:165–172` |
| B-26 | Desplazamiento coherente con dirección y velocidad | `mercatorLerp` + rotación sincronizada; anima suavemente |
| B-27 | Vuelo se desplaza con fluidez | Interpolación continua frame a frame |
| B-28 | Carga de maletas de vuelo en tránsito en números (hover) | Tooltip con load/capacity al pasar mouse |
| B-29 | Carga de vuelo en tránsito en colores semáforo | Verde <70%, ámbar 70–90%, rojo ≥90% |
| B-33 | Mecanismo para mostrar/ocultar ruta de vuelo | Click en vuelo → muestra ruta punteada; click en mapa → deselecciona |
| B-37 | Tiempo transcurrido (dd, hh, mm) dentro de lo simulado | `TopBar.jsx:191–204` — "DÍA X / Y" + reloj simulado |
| B-38 | Tiempo transcurrido en tiempo real | Elapsed HH:MM:SS en `TopBar.jsx` |
| B-39 | Bloque de tiempos con fuente pertinente | `TopBar.jsx` — bloque dedicado con monospace |
| B-40 | Ocupación/disponibilidad de flota en números | KPI "Vuelos activos" en `TopBar.jsx:148–155` |
| B-41 | Ocupación de flota en colores | KPI coloreado por umbral |
| B-42 | Vuelos en tránsito en datos | `RightPanel.jsx:85–111` — lista de vuelos activos con load % |
| B-43 | Llenado de almacenes en números | `RightPanel.jsx:113–143` — ocupación % por aeropuerto |
| B-44 | Llenado de almacenes en colores | Barras horizontales verde/ámbar/rojo |
| B-48 | Click aeropuerto principal en mapa → panel de detalle | `MapView.jsx:299` → `DrawerAeropuerto.jsx` |
| B-49 | Click aeropuerto de conexión en mapa → panel | Mismo mecanismo |
| B-50 | Click vuelo en tránsito en mapa → panel de detalle | `MapView.jsx:237` → `DrawerVuelo.jsx` |
| B-54 | Selección de vuelo desde panel → resaltado en mapa | `RightPanel.jsx` click → `setSelectedFlight()` → glow en mapa |

### Panel

| # | Descripción | Dónde en el código |
|---|-------------|-------------------|
| B-59 | Stock de maletas de aeropuerto en panel en números | `DrawerAeropuerto.jsx:141–152` + `RightPanel.jsx:113–143` |
| B-60 | Stock en colores en panel | Barra horizontal coloreada |
| B-62 | Aeropuerto de conexión → ubicación en mapa | Todos visibles en mapa como marcadores |
| B-65 | Lista de maletas/envíos planificados | `EnviosScreen.jsx` — tabla completa con búsqueda y filtros |
| B-66 | Vuelos que atienden cada maleta (plan de viaje) | `DrawerEnvio.jsx` — timeline de escalas por envío |
| B-67 | Ruta completa de la maleta con todas las escalas | `DrawerEnvio.jsx` — todos los tramos visibles |
| B-68 | Buscar envío planificado | `EnviosScreen.jsx:143–158` — búsqueda por ID, origen, destino |
| B-69 | Buscar envío ya entregado | Misma búsqueda + filtro de estado ENTREGADO |
| B-71 | Lista de vuelos de la flota con carga actual | `RightPanel.jsx:85–111` — vuelos activos con load/capacity |
| B-72 | Rutas planificadas de un vuelo específico | `DrawerVuelo.jsx:172–209` — trayecto origen→destino |
| B-76 | Estado del vuelo (operativo/cancelado/retrasado) | `DrawerVuelo.jsx` — status pill visible |

### Otros

| # | Descripción | Dónde en el código |
|---|-------------|-------------------|
| B-81 | Manejo de cancelaciones en planificador | Por Demanda: inmediato al cancelar → TS en `PlanningService.java:47` |
| B-82 | Reporte final de simulación | `ResultadosScreen.jsx` — SLA %, métricas, log de ops, CSV export |

---

## SECCIÓN B — Criterios Parcialmente Implementados ⚠️

| # | Descripción | Lo que hay | Lo que falta |
|---|-------------|------------|--------------|
| B-9 | Lista maletas/envíos planificados que salen (hover) | Info de vuelos en `DrawerAeropuerto.jsx` (click) | Mostrar en tooltip al hover, sin necesidad de click |
| B-10 | Lista de vuelos que parten (hover) | `DrawerAeropuerto.jsx` muestra vuelos conectados | No diferencia "parten" vs "arriban"; requiere click |
| B-11 | Lista de vuelos que arriban (hover) | Misma lista anterior sin separar por dirección | Separar salidas y llegadas; mostrar en hover |
| B-16 | Lista de maletas que arriban a aeropuerto de conexión (hover) | Drawer muestra vuelos conectados | Sin lista de maletas entrantes específicamente |
| B-17 | Lista de vuelos que parten de aeropuerto de conexión | Mismo drawer | Sin diferenciación por dirección |
| B-18 | Lista de vuelos en espera/tránsito en aeropuerto de conexión | Drawer muestra estado de vuelos | Sin categoría "en espera" explícita |
| B-19 | Cancelaciones de vuelos visibles en mapa | Vuelos cancelados **desaparecen** del mapa (`MapView.jsx:259`) | Mostrar línea/ícono en color de cancelación en lugar de ocultar |
| B-20 | Color idóneo para vuelo cancelado o ruta bloqueada | Sin visualización de cancellation | Agregar ruta en rojo/gris con dash pattern |
| B-21 | Info de cancelación al pasar mouse | Sin objeto de cancelación en mapa | Tooltip con vuelo, ruta y hora de cancelación |
| B-22 | Grosor/ideograma idóneo para cancelación | Sin renderizado | Línea gruesa o ícono de bloqueo en la ruta |
| B-30 | Línea de ruta aérea planificada | Solo se muestra para **el vuelo seleccionado** (`MapView.jsx:212`) | Opción para mostrar todas las rutas simultáneamente |
| B-31 | Grosor/ideograma idóneo de ruta | Ruta punteada solo para vuelo seleccionado | Extender a otras rutas si se muestran |
| B-32 | Rutas con colores semánticos y leyenda visible | Leyenda en `LeftPanel.jsx:123–142` (por estado de SLA) | Leyenda de colores de tipo de ruta (continental/intercontinental) en mapa |
| B-34 | Tramo actual del vuelo diferenciando lo recorrido | Muestra línea completa origen→destino | Dividir en "tramo recorrido" (gris) y "tramo pendiente" (color) |
| B-35 | Fecha, hora, minuto y **segundo** del tiempo simulado | `TopBar.jsx` muestra `YYYY-MM-DD HH:MM` | Agregar segundos en el reloj simulado |
| B-36 | Fecha, hora, minuto y segundo del tiempo **real actual** | Muestra tiempo elapsed (`HH:MM:SS`), no hora de pared | Agregar reloj de hora actual del sistema (`new Date()`) |
| B-45 | Cancelación Tipo 1 (programada) reflejada en mapa | Backend cancela el vuelo y lo quita del estado activo | Mapa no muestra indicador visual de que fue cancelado |
| B-46 | Cancelación Tipo 2 (en tránsito) reflejada en mapa | `rescueBags()` en backend funciona | Sin representación visual en mapa |
| B-47 | Cancelación Tipo 3 (masiva) reflejada en mapa | `cancelRandomFlightsAndReplan()` implementado pero **no expuesto** en `avanzarDia()` | Conectar método al ciclo de simulación |
| B-51 | Seleccionar cancelación desde mapa → panel de detalle | No hay objeto de cancelación renderizado en mapa | Requiere primero implementar B-19 |
| B-52 | Seleccionar aeropuerto principal desde panel → centra en mapa | `AirportFilterPanel` muestra/oculta aeropuertos | Sin `flyTo()` o centering en mapa |
| B-53 | Seleccionar aeropuerto de conexión desde panel → centra | Mismo caso | Sin centering en mapa |
| B-55 | Seleccionar cancelación desde panel → centra en mapa | Sin panel de cancelaciones | Requiere implementar panel de cancelaciones primero |
| B-61 | Buscar aeropuerto/almacén principal | `AirportFilterPanel` tiene checkboxes por continente | Sin campo de búsqueda textual por nombre o IATA |
| B-63 | Lista de cancelaciones según hora y aeropuerto | Log de operaciones tiene eventos de cancelación (`[INCIDENCIA]`) | Sin panel/tabla dedicado de cancelaciones |
| B-64 | Lista de vuelos cancelados | `EnviosScreen` muestra envíos CANCELADO; log de ops muestra vuelos | Sin tabla dedicada de vuelos cancelados (VuelosScreen es dead code) |
| B-70 | Lista de vuelos de la flota Tasf.B2B | `RightPanel` muestra solo vuelos **activos** | `VuelosScreen.jsx` existe pero no hay tab que navegue a ella |
| B-73 | Maletas asignadas a un vuelo específico | `DrawerVuelo.jsx` muestra `load/capacity` numérico | Sin lista de maletas individuales asignadas |
| B-74 | Buscar vuelo específico | Sin campo de búsqueda de vuelos | `RightPanel` no tiene search; no hay pantalla de búsqueda de vuelos |
| B-75 | Tiempo de permanencia de maletas en aeropuerto de escala | `DrawerEnvio.jsx` timeline muestra hora de salida de cada tramo | Sin cálculo explícito del dwell time entre llegada y salida de escala |
| B-77 | Período en que un vuelo está cancelado/en mantenimiento | `DrawerVuelo.jsx` muestra status pill | Sin rango horario de inicio/fin de cancelación |
| B-82 | Reporte final con última planificación en los **3 escenarios** | `ResultadosScreen.jsx` muestra resultado del último escenario corrido | Sin comparación entre escenarios; cada ejecución sobreescribe el estado |

---

## SECCIÓN B — Sin Implementar ❌

| # | Descripción | Comentario |
|---|-------------|------------|
| B-56 | Seleccionar vuelo con cancelación Tipo 1 desde panel → abre mapa en ese punto | Sin panel de cancelaciones Type 1 |
| B-57 | Ídem Tipo 2 | Sin panel de cancelaciones Type 2 |
| B-58 | Ídem Tipo 3 | Sin panel de cancelaciones Type 3; Tipo 3 no expuesto |
| B-78 | Lista de vuelos con cancelación Tipo 1 | Sin pantalla/panel dedicado |
| B-79 | Lista de vuelos con cancelación Tipo 2 | Sin pantalla/panel dedicado |
| B-80 | Lista de vuelos con cancelación Tipo 3 | Sin pantalla/panel dedicado |
| B-83 | Percepción global — FORTALEZA | Criterio del evaluador | N/A |
| B-84 | Percepción global — OPORTUNIDAD DE MEJORA | Criterio del evaluador | N/A |
| B-85 | Video de simulación semanal 30–90 min | Artefacto externo | N/A |
| B-86 | XpoSTEM | Evento presencial | N/A |

---

## SECCIÓN C — Criterios Completamente Implementados ✅

### Escenario 1 — Simulación Semanal

| # | Descripción | Dónde en el código |
|---|-------------|-------------------|
| E1-1 | Parametrizar período (3/5/7 días) | `ConfigScreen.jsx:6–10` — radio buttons; enviado como `dias` en `ParametrosSimulacion` |
| E1-3 | Respetar plazos: 1 día mismo continente / 2 días distinto | `RoutePlannerSupport.java:80–93` — `enforceSlaFromContinent()` |
| E1-4 | Replanificar rutas ante cancelaciones durante simulación | `SimulationEngine.java:792–796` — `replanificar(..., conIncidencia=true)` → Tabu Search |
| E1-7 | Gráfica/indicador de cumplimiento de plazos al final | `DashboardScreen.jsx:266–279` — stacked bar chart SLA OK/Breach; `ResultadosScreen.jsx:298–315` — barras % |

### Escenario 2 — Operaciones en Tiempo Real

| # | Descripción | Dónde en el código |
|---|-------------|-------------------|
| E2-1 | Registrar nuevos envíos en tiempo real | `ConfigScreen.jsx:165–244` → `POST /api/upload/envios` → `EnvioUploadService.java` |
| E2-2 | Planificador genera/ajusta rutas en tiempo real | `SimulationEngine.java:407–442` — `agregarNuevosEnvios()` + replan automático |
| E2-4 | Plan de viaje por maleta al momento del envío | `DrawerEnvio.jsx` — plan completo con escalas y vuelos |
| E2-5 | Reporte de monitoreo por demanda | `EnviosScreen.jsx` + `DrawerEnvio.jsx` — consultable en cualquier momento |
| E2-6 | Verificar restricciones de capacidad de almacén | `RoutePlannerSupport.java:232–239` — hard constraint `≤ capacity * 0.9` |
| E2-7 | Verificar restricciones de capacidad de vuelo | `RoutePlannerSupport.java:224–229` — hard constraint exacto |

### Escenario 3 — Colapso

| # | Descripción | Dónde en el código |
|---|-------------|-------------------|
| E3-2 | Detecta y notifica visualmente almacén supera capacidad (semáforo) | `RightPanel.jsx:113–143` + `DashboardScreen.jsx:304–348` — rojo cuando ≥ umbral |
| E3-5 | Planificador replanifica antes de declarar colapso | `SimulationEngine.java:796` — replan con incidencia siempre antes de marcar RETRASADO |

### Sección D — RNF

| # | Descripción | Dónde en el código |
|---|-------------|-------------------|
| RNF-1 | Dos soluciones algorítmicas en Java | `SimulatedAnnealingAlgorithm.java` + `TabuSearchAlgorithm.java`; interfaz `MetaheuristicAlgorithm.java` |

---

## SECCIÓN C y D — Criterios Parcialmente Implementados ⚠️

| # | Descripción | Lo que hay | Lo que falta |
|---|-------------|------------|--------------|
| E1-2 | Simulación semanal entre 30 y 90 minutos | ~84 seg para 7 días (12 seg/día simulado) | Verificar si el requerimiento es de velocidad de visualización o de ejecución total del algoritmo |
| E1-5 | Evolución de stock de maletas en almacenes a lo largo del período | `DashboardScreen` muestra throughput diario (SLA OK/Breach) | Sin gráfico de ocupación de cada almacén por día |
| E1-6 | Historial de vuelos (completados, cancelados, retrasados) al final | Log de operaciones + `ResultadosScreen` con métricas generales | Sin tabla estructurada de vuelos con estado final |
| E2-3 | Actualización de monitoreo de maletas de forma **manual por aeropuerto** | Actualización automática vía polling 2s | Sin acción manual del operador para registrar llegada/salida |
| E3-1 | Parametrizar escenario de colapso (demanda/cancelaciones) | `esColapso` flag en `ParametrosSimulacion.java:18` | No expuesto en `ConfigScreen`; solo activable via API directa |
| E3-6 | Comparar resultado de 2 algoritmos en escenario de colapso | `ExperimentacionController.java:40–70` — registro y CSV export | Sin comparación side-by-side en UI; requiere 2 corridas + análisis manual del CSV |
| RNF-2 | Dos algoritmos evaluados por experimentación numérica | `MetricaAlgoritmo.java` captura `tiempoEjecucionMs` y `rutasEvaluadas`; CSV exportable | Sin reporte/dashboard comparativo en UI |
| RNF-3 | Colores semáforo parametrizables en rangos | Umbrales verde/ámbar en `ConfigScreen.jsx:273–301` | Rojo es derivado (todo lo ≥ ámbar); no se puede configurar el umbral exacto del rojo |

---

## SECCIÓN C y D — Sin Implementar ❌

| # | Descripción | Comentario |
|---|-------------|------------|
| E3-3 | Detecta y notifica visualmente cuando la operación **colapsa** (imposibilidad de cumplir plazos) | El sistema marca envíos como RETRASADO pero no hay notificación global de "colapso total" |
| E3-4 | Reporte/gráfica del punto de colapso (momento, métricas, causa) | Sin pantalla ni endpoint dedicado para punto de colapso |
| RNF-4 | Funciona en equipamiento del laboratorio de Ing. Informática | Despliegue a EC2 (AWS); no verificado en infraestructura del lab PUCP |
| RNF-5 | Evidencia del proceso NTP-ISO/IEC 29110-5-1-2 (VSE) | Sin documentación de proceso en el repositorio |
| RNF-6 | Videos de presentación final grabados | Artefacto externo, no en código |
| RNF-7 | Videos de avances y finales de los 3 escenarios | Artefacto externo, no en código |

---

## Resumen Ejecutivo

| Categoría | ✅ Completo | ⚠️ Parcial | ❌ Sin implementar |
|-----------|------------|-----------|-------------------|
| Sección A (22 criterios) | 17 | 5 | 0 |
| Sección B — Mapa/Panel (86 criterios) | 28 | 30 | 28* |
| Sección C — Escenarios (20 criterios) | 10 | 7 | 3 |
| Sección D — RNF (7 criterios) | 1 | 3 | 3 |
| **Total (135 criterios)** | **~56 (41%)** | **~45 (33%)** | **~34 (25%)** |

*Incluye N/A (B-83, B-84, B-85, B-86) que son criterios de evaluador o artefactos externos.

---

## Observaciones y Recomendaciones

### Fortalezas del sistema (para defender en evaluación)

1. **Algoritmos metaheurísticos completos y diferenciados**: SA para planificación general; TS obligatorio ante incidencias. Separación clara de responsabilidades.
2. **Restricciones duras implementadas**: Capacidad de almacén (90% del total) y capacidad de vuelo verificadas en ambos algoritmos. SLA continental/intercontinental enforced.
3. **Visualización dinámica de vuelos en tránsito**: Interpolación Mercator real, rotación de ícono según dirección, animación fluida sin saltos.
4. **Dashboard de análisis completo**: KPIs en tiempo real, gráfico de throughput, tabla de aeropuertos por ocupación, barras SLA final.
5. **Carga de envíos en tiempo real**: Upload de archivo `.txt` durante simulación con replanificación automática.
6. **Semáforos parametrizables**: Umbral verde/ámbar configurable por el usuario antes de iniciar.
7. **Exportación y registro de experimentos**: CSV descargable de resultados para comparación manual de algoritmos.

### Prioridad alta (alto impacto, mínimo esfuerzo)

| Item | Esfuerzo | Impacto en rúbrica |
|------|----------|-------------------|
| **B-19 a B-22**: Mostrar cancelaciones en mapa (línea roja en lugar de ocultar) | Medio | Alto — 4 criterios en B + habilita B-51, B-55, B-56–58 |
| **E3-1**: Exponer checkbox `esColapso` en ConfigScreen | Bajo | 1 criterio pero habilita E3-3/E3-4 |
| **B-70**: Activar VuelosScreen (ya existe, solo falta el tab) | Muy bajo | 1 criterio + habilita B-74, B-73 |
| **B-36**: Mostrar hora de pared actual (no elapsed) | Muy bajo | 1 criterio |
| **B-47**: Conectar `cancelRandomFlightsAndReplan()` en `avanzarDia()` | Bajo | 1 criterio + habilita visualización Tipo 3 |

### Prioridad media (esfuerzo moderado)

| Item | Esfuerzo | Impacto en rúbrica |
|------|----------|-------------------|
| **B-34**: Diferenciar tramo recorrido vs pendiente en ruta de vuelo | Medio | Visual llamativo |
| **E1-2**: Ajustar velocidad de simulación para cumplir 30–90 min | Medio | Aclarar requerimiento primero |
| **E3-3/E3-4**: Detector de colapso con notificación y reporte | Alto | 2 criterios en E3 |
| **B-63/B-64**: Panel de cancelaciones estructurado | Medio | Habilita B-56–58, B-78–80 |

### Items que dependen de artefactos externos (gestión, no código)

- **RNF-4**: Coordinar con laboratorio PUCP para verificar despliegue
- **RNF-5**: Preparar evidencia del proceso VSE (actas, tareas, historial de versiones)
- **RNF-6/RNF-7**: Grabar videos de demostración de los 3 escenarios
- **B-85**: Video de simulación semanal de 30–90 min de ejecución

---

*Generado a partir de inspección del código fuente en `feature/backend` — 2026-05-28*
