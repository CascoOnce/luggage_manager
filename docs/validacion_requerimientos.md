# Validación de Requerimientos — Luggage Manager

**Fecha de revisión:** 2026-06-02
**Total requerimientos:** 106
**Resumen:** Conforme: 36 | Parcial: 14 | Nada/Poco: 35 | CSC (sin clasificar): 21

---

## Leyenda

| Estado | Descripción |
|--------|-------------|
| **2. Conforme** | Implementado y funcionando |
| **1. Parcial** | Implementado parcialmente — falta funcionalidad específica |
| **0. Nada/Poco** | No implementado o con evidencia mínima |
| **CSC** | Por confirmar con evaluador — no clasificable desde el código |

---

## Sección 1: Inicio y Generalidades de la Simulación

| # | Requerimiento | Evaluación | Evidencia / Observación |
|---|---------------|------------|-------------------------|
| 1 | ¿La carga de archivos/datos de envíos se hace en otra opción? | CSC | Existe `UploadController` y carga en ConfigScreen; confirmar con evaluador si la opción satisface |
| 2 | ¿Pide fecha y hora hasta nivel de minuto? | **2. Conforme** | ConfigScreen tiene date/time pickers con resolución de minutos |
| 3 | Tiempo aproximado en mostrar el mapa tras iniciar | CSC | Depende de hardware; no hay SLA de performance codificado |
| 4 | Tiempo aproximado en que el transporte se mueve tras iniciar | CSC | Idem |
| 5 | ¿Pueden conectarse otros visualizadores en distintos momentos? | **1. Parcial** | Distintos navegadores pueden abrir la URL, pero no hay sesiones independientes; comparten estado de la misma instancia de SimulationEngine |
| 6 | ¿Cada visualizador ejecuta acciones independientemente? | **1. Parcial** | No probado; la arquitectura es single-tenant — todas las acciones afectan al mismo estado global |
| 7 | ¿Todo el contenido en español? | **2. Conforme** | Todas las etiquetas, botones y mensajes están en español |
| 8 | ¿El zoom in/out es adecuado? | **2. Conforme** | Leaflet con controles de zoom; bounds ajustados a los aeropuertos cargados |
| 9 | ¿Presenta de manera completa la pantalla principal al iniciar? | **2. Conforme** | MapView + paneles laterales visibles al inicializar |
| 10 | ¿Aprovecha al máximo la pantalla mostrando todos los almacenes simultáneamente? | **2. Conforme** | `FitAirportBounds` ajusta automáticamente el viewport para mostrar los 30 aeropuertos |
| 11 | ¿Presenta pantalla limpia con elementos no disponibles deshabilitados? | **2. Conforme** | ConfigScreen oculta elementos de simulación; botones deshabilitados hasta iniciar |

---

## Sección 2: Indicadores de Tiempo en el Mapa

| # | Requerimiento | Evaluación | Evidencia / Observación |
|---|---------------|------------|-------------------------|
| 12 | ¿Presenta fecha-hora del momento simulado (nivel minuto)? | **2. Conforme** | TopBar muestra `simClockMinutes` formateado como HH:MM; disponible en simulación y colapso |
| 13 | ¿Presenta tiempo transcurrido desde inicio de simulación? | **2. Conforme** | Cronómetro de simulación en TopBar |
| 14 | ¿Presenta fecha-hora actual (momento presente, nivel minuto)? | **2. Conforme** | Reloj de pared en TopBar actualizado cada segundo |
| 15 | ¿Presenta tiempo transcurrido hasta el momento actual? | **1. Parcial** | Cronómetro disponible en pantalla simulación; no disponible en modo Operaciones (LiveScreen) |
| 16 | ¿Los 4 datos de tiempo se presentan con ubicación, tamaño y contraste adecuados? | **2. Conforme** | TopBar agrupa los indicadores de tiempo con jerarquía visual clara |

---

## Sección 3: Comportamiento de Almacenes (Aeropuertos) en el Mapa

| # | Requerimiento | Evaluación | Evidencia / Observación |
|---|---------------|------------|-------------------------|
| 17 | ¿Cada almacén se presenta en la ubicación prevista? | **2. Conforme** | Coordenadas lat/lng de la BD; `MapView` usa `L.marker` con posición exacta |
| 18 | ¿El ícono del almacén es idóneo en tamaño? | **2. Conforme** | `IconScaler` ajusta tamaño según zoom |
| 19 | ¿El ícono representa un aeropuerto? | **2. Conforme** | SVG de terminal de aeropuerto |
| 20 | ¿El ícono contrasta con el fondo del mapa? | **2. Conforme** | Ícono blanco/azul sobre mapa oscuro |
| 21 | ¿El ícono del almacén presenta colores (semáforo+vacío) según stock? | **0. Nada/Poco** | Color fijo; no hay lógica de semáforo en el ícono del marcador de aeropuerto en `MapView.jsx` |
| 22 | ¿Presenta stock/ocupación del almacén en números o porcentaje? | **2. Conforme** | Tooltip al hover muestra ocupación %; `DrawerAeropuerto` muestra detalle completo al click |

---

## Sección 4: Comportamiento de Unidades de Transporte (UT) y Tramos

| # | Requerimiento | Evaluación | Evidencia / Observación |
|---|---------------|------------|-------------------------|
| 23 | ¿Cada UT se presenta en la ubicación prevista? | **2. Conforme** | Aviones animados con posición interpolada entre origen y destino según `progress` del backend |
| 24 | ¿El ícono de cada UT es idóneo en tamaño? | **2. Conforme** | Tamaño reducido para evitar sobrecarga visual |
| 25 | ¿El ícono representa un avión? | **2. Conforme** | SVG de avión |
| 26 | ¿El ícono de la UT contrasta con el resto? | **2. Conforme** | Color amarillo/naranja sobre mapa |
| 27 | ¿El ícono de la UT presenta colores (semáforo-vacío) según stock? | **0. Nada/Poco** | Color fijo; no hay semáforo en el ícono del avión |
| 28 | ¿Presenta stock/ocupación de cada UT en números o porcentaje? | **2. Conforme** | Tooltip y `DrawerVuelo` muestran capacidad y carga actual |
| 29 | ¿La UT se desplaza con fluidez, sin saltos ni anomalías? | **2. Conforme** | Animación CSS/React con interpolación lineal de posición |
| 30 | ¿La UT se alinea con la dirección de movimiento? | **2. Conforme** | Rotación calculada con `Math.atan2` entre origen y destino |
| 31 | ¿Se presenta el tramo (origen-destino) como línea al inicio del vuelo? | **1. Parcial** | La polyline solo aparece al hacer click en el avión; no es automática |
| 32 | ¿Se presenta la ruta (origen-destino) del avión como línea al inicio del vuelo? | CSC | Ítem redundante con #31; confirmar con evaluador si hay diferencia entre "tramo" y "ruta" |
| 33 | ¿La línea del tramo tiene grosor/ideograma adecuado? | **1. Parcial** | Estilo adecuado, pero solo visible al hacer click |
| 34 | ¿Se borra o cambia la línea del tramo al ser recorrido por la UT? | **2. Conforme** | Polylines se eliminan al completar el vuelo |
| 35 | ¿Se presenta el avión en tierra cuando no vuela? | CSC | Los aviones solo se renderizan durante vuelos activos; confirmar si se requiere icono estático en tierra |

---

## Sección 5: Concepto de Evaluación — PANEL

| # | Requerimiento | Evaluación | Evidencia / Observación |
|---|---------------|------------|-------------------------|
| 36 | ¿Paneles contraídos al inicio en ubicaciones idóneas? | **2. Conforme** | `AirportFilterPanel` (izquierda) y `RightPanel` (derecha) inician colapsados |
| 37 | ¿Lista de todas las UT con ocupación en número o %? | **2. Conforme** | `RightPanel` lista vuelos activos con barra de capacidad |
| 38 | ¿Desde la lista de UT se accede a los envíos que traslada? | **1. Parcial** | Solo desde `DrawerVuelo` en simulación; no disponible en LiveScreen ni otras vistas |
| 39 | ¿Desde la lista de UT se accede a los productos que traslada? | **1. Parcial** | Idem que #38 |
| 40 | ¿Se presenta el stock actual de cada UT como semáforo-vacío? | **1. Parcial** | Barra de capacidad en RightPanel pero sin código de color semáforo; ícono fijo |
| 41 | ¿Se busca la UT por código o tramo? | **1. Parcial** | Caja de búsqueda en RightPanel filtra por código de vuelo; no busca por tramo completo |
| 42 | ¿Se busca la UT por origen? | **1. Parcial** | `AirportFilterPanel` filtra aeropuertos; no filtra TUs por aeropuerto de origen específicamente |
| 43 | ¿Se busca la UT por destino? | **1. Parcial** | Idem que #42 |
| 44 | ¿Se filtra las UT por patrón de código? | **0. Nada/Poco** | Solo búsqueda exacta/parcial; no hay filtro por patrón (wildcards, regex) |
| 45 | ¿Se filtra las UT por origen? | **0. Nada/Poco** | Sin filtro de TU por aeropuerto de origen |
| 46 | ¿Se filtra las UT por destino? | **0. Nada/Poco** | Sin filtro de TU por aeropuerto de destino |
| 47 | ¿Se ordena la lista de UT por nivel de ocupación? | **2. Conforme** | Vuelos en RightPanel se ordenan por porcentaje de ocupación |
| 48 | ¿Se ordena la lista de UT por hora de salida? | **0. Nada/Poco** | No implementado |
| 49 | ¿Se ordena la lista de UT por hora de llegada? | **0. Nada/Poco** | No implementado |
| 50 | ¿Se ordena la lista de UT por origen? | **0. Nada/Poco** | No implementado |
| 51 | ¿Se ordena la lista de UT por destino? | **0. Nada/Poco** | No implementado |
| 52 | ¿Lista de almacenes con ocupación en número o %? | **2. Conforme** | `RightPanel` sección de aeropuertos con barras de ocupación % |
| 53 | ¿Lista de almacenes con acceso a envíos (destino final y en tránsito)? | **0. Nada/Poco** | `DrawerAeropuerto` muestra vuelos entrantes/salientes, pero no lista de envíos |
| 54 | ¿Lista de almacenes con acceso a productos (maletas)? | **0. Nada/Poco** | No implementado |
| 55 | ¿Lista de almacenes en colores semáforo-vacío? | **2. Conforme** | Barras de ocupación con color verde/ámbar/rojo según thresholds configurables |
| 56 | ¿Información planificada de envíos que entran al almacén? | **0. Nada/Poco** | No implementado |
| 57 | ¿Información planificada de productos que entran al almacén? | **0. Nada/Poco** | No implementado |
| 58 | ¿Información planificada de envíos que salen del almacén? | **0. Nada/Poco** | No implementado |
| 59 | ¿Información planificada de productos que salen del almacén? | **0. Nada/Poco** | No implementado |
| 60 | ¿Se filtra almacenes por código-patrón? | **0. Nada/Poco** | Solo búsqueda de texto en AirportFilterPanel; sin filtro por patrón |
| 61 | ¿Se filtra almacenes por ubicación regional/continental? | **0. Nada/Poco** | AirportFilterPanel tiene selección de continente en origen/destino, pero no filtra la lista del panel |
| 62 | ¿Se ordena la lista de almacenes por nivel de ocupación? | **1. Parcial** | Aeropuertos en RightPanel se muestran con ocupación pero el orden no es interactivo |
| 63 | ¿Se ordena almacenes por hora de salida de la UT más próxima? | **0. Nada/Poco** | No implementado |
| 64 | ¿Se ordena almacenes por hora de llegada de la UT más próxima? | **0. Nada/Poco** | No implementado |
| 65 | ¿Lista planificada de envíos con destino, UT y cantidad? | **2. Conforme** | `EnviosScreen` muestra estado PLANIFICADO con destino, vuelo asignado y maletas |
| 66 | ¿Lista de envíos en vuelo con origen, destino, UT y cantidad? | **2. Conforme** | `EnviosScreen` muestra estado EN_TRANSITO con origen, destino, vuelo y maletas |
| 67 | ¿Lista de envíos entregados en últimas X horas? | **2. Conforme** | `EnviosScreen` filtra ENTREGADO con timestamp; `ResultadosScreen` agrega por día |
| 68 | ¿Se filtra envíos por origen? | **0. Nada/Poco** | `EnviosScreen` tiene búsqueda de texto pero sin filtro de origen |
| 69 | ¿Se filtra envíos por destino? | **0. Nada/Poco** | Idem |

---

## Sección 6: Vinculación Mapa-Panel (Bi-direccional)

| # | Requerimiento | Evaluación | Evidencia / Observación |
|---|---------------|------------|-------------------------|
| 70 | ¿Muestra en el mapa la ruta de un producto (maleta) por ID? | **0. Nada/Poco** | No implementado; `DrawerEnvio` muestra el plan textual pero no lo pinta en el mapa |
| 71 | ¿Muestra historial de ruta con datos de escalas? | **0. Nada/Poco** | `DrawerEnvio` muestra escalas en lista; no hay visualización en mapa |
| 72 | ¿Muestra en el mapa las rutas de un envío por ID? | **0. Nada/Poco** | No implementado |
| 73 | ¿Muestra historial de ruta de envío con datos de escalas? | **0. Nada/Poco** | No implementado |
| 74 | ¿Seleccionar almacén en panel → enlaza y enfoca en mapa? | **0. Nada/Poco** | La selección de aeropuerto en el panel no centra el mapa; solo sentido mapa→panel está implementado |
| 75 | ¿Seleccionar almacén en mapa → enlaza y enfoca en panel? | **2. Conforme** | Click en marcador de aeropuerto → abre `DrawerAeropuerto` automáticamente |
| 76 | ¿Seleccionar UT en panel → enlaza y enfoca en mapa? | **2. Conforme** | Click en vuelo en RightPanel → centra mapa y selecciona la UT |
| 77 | ¿Seleccionar UT en mapa → enlaza y enfoca en panel? | **2. Conforme** | Click en avión en mapa → abre `DrawerVuelo` y resalta en RightPanel |
| 78 | ¿Seleccionar envío en panel → enlaza y enfoca en mapa? | **0. Nada/Poco** | Click en envío en EnviosScreen no produce acción en el mapa |
| 79 | ¿Lista de bloqueos según hora con vuelos afectados? | CSC | Existe `cancel-flight` endpoint; no hay lista de bloqueos en UI. Confirmar con evaluador |
| 80 | Seleccionar avería tipo 1 → enlaza en mapa | CSC | No hay tipos de avería diferenciados en la implementación |
| 81 | Seleccionar avería tipo 2 → enlaza en mapa | CSC | Idem |
| 82 | Seleccionar avería tipo 3 → enlaza en mapa | CSC | Idem |
| 83 | Seleccionar avería tipo 4 → enlaza en mapa | CSC | Idem |
| 84 | ¿Filtro semáforo de almacenes en panel → refleja en mapa? | **0. Nada/Poco** | No hay filtro de semáforo que modifique visibilidad/estilo en el mapa |
| 85 | ¿Filtro semáforo de UT en panel → refleja en mapa? | **0. Nada/Poco** | No implementado |
| 86 | ¿Otros filtros de almacenes en panel → reflejan en mapa? | **0. Nada/Poco** | No implementado |
| 87 | ¿Otros filtros de UT en panel → reflejan en mapa? | **0. Nada/Poco** | No implementado |

---

## Sección 7: Cierre, Reportes y Percepciones

| # | Requerimiento | Evaluación | Evidencia / Observación |
|---|---------------|------------|-------------------------|
| 88 | ¿Indicador global del nivel de ocupación de la flota? | **0. Nada/Poco** | KPI "Vuelos activos" en TopBar; no hay indicador de ocupación agregada de flota |
| 89 | ¿Indicador de ocupación de flota como semáforo? | **2. Conforme** | KPI de SLA compliance con color verde/rojo en TopBar |
| 90 | ¿Indicador global del nivel de ocupación de los almacenes en conjunto? | **0. Nada/Poco** | `DashboardScreen` muestra por aeropuerto pero no hay agregado total |
| 91 | ¿Indicador de ocupación de almacenes en conjunto como semáforo? | **0. Nada/Poco** | No implementado como valor único global |
| 92 | ¿Se respeta el tiempo de permanencia mínima de maletas en aeropuertos? | **2. Conforme** | `ParametrosSimulacion.escalaMinima` enforced en `RoutePlannerSupport.buildCandidatePool()` |
| 93 | ¿Se conectan ≥2 navegadores desde dispositivos distintos con interacción independiente? | **0. Nada/Poco** | Sin gestión de sesiones; estado global único en `SimulationEngine` |
| 94 | ¿Cómo se manejan bloqueos en el planificador? | CSC | SA replanning vía `cancel-flight`; confirmar con evaluador si el mecanismo satisface |
| 95 | ¿Reporte del último plan estable al finalizar período de simulación? | **1. Parcial** | `ResultadosScreen` muestra métricas finales; vuelos no completados el último día quedan como EN_TRANSITO |
| 96 | ¿Reporte del último plan estable al cerrar operaciones día a día? | **0. Nada/Poco** | No hay reporte por día; solo reporte final al terminar la simulación |
| 97 | ¿Reporte del último plan estable al finalizar simulación de colapso? | **1. Parcial** | `ColapsoScreen` muestra KPIs del momento del colapso; no genera reporte de plan completo |
| 98 | Percepción global: ¿Completo? | CSC | Evaluación cualitativa del docente |
| 99 | Percepción global: ¿Apropiado? | CSC | Evaluación cualitativa del docente |
| 100 | Percepción global: ¿Claro? | CSC | Evaluación cualitativa del docente |
| 101 | Percepción global: ¿Factible? | CSC | Evaluación cualitativa del docente |
| 102 | ¿Verificable? | CSC | Evaluación cualitativa del docente |
| 103 | ¿Conformidad? | CSC | Evaluación cualitativa del docente |
| 104 | Percepción global FORTALEZA | CSC | Evaluación cualitativa del docente |
| 105 | Percepción global MEJORAR | CSC | Evaluación cualitativa del docente |
| 106 | Potencial invitación XpoSTEM | CSC | Sin acción requerida |

---

## Resumen por estado

| Estado | Cantidad | % del total clasificable |
|--------|----------|--------------------------|
| **2. Conforme** | 36 | 42% |
| **1. Parcial** | 14 | 16% |
| **0. Nada/Poco** | 35 | 41% |
| **CSC** | 21 | — |
