# Mejoras Pendientes — TASF.B2B Luggage Manager

**Generado:** 2026-06-01 | **Branch:** feature/backend

> Documento de alcance futuro. Cada ítem está descrito a nivel técnico con el impacto esperado en el sistema.

---

## M-01 · Filtrado de envíos fuera de la ventana de simulación

### Problema
Actualmente `SimulationEngine.checkSlaViolations()` marca como `RETRASADO` cualquier envío cuyo SLA haya expirado en función de la fecha simulada actual, sin distinguir si el envío fue planificado para completarse dentro o fuera del período de simulación. Un envío con fecha de entrega planificada en el Día 4 de una simulación de 3 días aparece en métricas como incumplimiento de SLA, cuando en realidad simplemente está fuera del alcance temporal del escenario.

### Comportamiento esperado
- Un envío cuya ruta planificada completa en un día mayor al período de simulación (`diaActual + escalasRestantes > totalDias`) no debe ser marcado `RETRASADO`.
- Debe adoptar un estado neutro — `FUERA_VENTANA` o simplemente mantenerse en `EN_TRANSITO` — que lo excluya del cálculo de % SLA vencido y de los conteos de incumplimiento.
- En el frontend, estos envíos no deben aparecer en tablas de "retrasados" ni computarse en la barra de cumplimiento SLA de `TopBar` ni en `ResultadosScreen`.

### Archivos involucrados
| Capa | Archivo | Cambio |
|------|---------|--------|
| Backend | `domain/EstadoEnvio.java` | Agregar valor `FUERA_VENTANA` al enum |
| Backend | `simulation/SimulationEngine.java` | `checkSlaViolations()`: excluir envíos con fecha de entrega estimada > fecha fin simulación |
| Backend | `simulation/SimulationEngine.java` | `buildKpis()`: excluir `FUERA_VENTANA` del denominador de SLA |
| Frontend | `src/screens/EnviosScreen.jsx` | Agregar estado y color para `FUERA_VENTANA` en `STATUS_COLOR` |
| Frontend | `src/components/TopBar.jsx` | KPI "Cumpl. SLA" usa solo envíos dentro de la ventana |

---

## M-02 · Animación progresiva de ocupación de almacenes

### Problema
`ocupacionActual` de cada aeropuerto se actualiza al inicio de cada día simulado (`updateWarehouseOccupation()` en `avanzarDia()`). Durante los ~12 segundos reales que dura cada día simulado, el porcentaje en los íconos del mapa, en `RightPanel` y en los tooltips permanece fijo hasta el siguiente `POST /step`. Visualmente esto produce saltos discretos en lugar de un movimiento fluido.

### Comportamiento esperado
La barra de ocupación y el color del semáforo de cada aeropuerto se actualizan continuamente durante el día, interpolando entre el valor del inicio del día (conocido) y una estimación del fin del día, usando el progreso de `simClockMinutes` (0–1440) como factor.

### Implementación sugerida
- `App.jsx`: mantener un `prevOccupation` snapshot (mapa `iata → ocupación`) del día anterior y el actual.
- `normalizedAirports` memo: interpolar `currentOccupation` entre `prevOccupation[iata]` y `currentOccupation[iata]` según `simClockMinutes / 1440`.
- No requiere cambio de backend — se trabaja solo con los últimos dos estados recibidos por polling.

### Archivos involucrados
| Archivo | Cambio |
|---------|--------|
| `src/App.jsx` | Agregar `prevAirports` ref, actualizar en cada `POST /step`; interpolar en `normalizedAirports` |

---

## M-03 · Mejoras en gestión de archivos de envíos (ConfigScreen)

### Problema
El flujo actual de carga de archivos tiene las siguientes deficiencias:
1. No hay retroalimentación visual de qué archivos están seleccionados antes de hacer clic en "Subir".
2. No es posible eliminar un archivo individual de la selección sin deseleccionar todos.
3. Durante la carga secuencial de múltiples archivos, solo existe un indicador genérico de loading (sin progreso).
4. La validación de extensión `.txt` se aplica a nivel del nombre (regex `FILE_PATTERN`), pero archivos no `.txt` pueden ser seleccionados si el usuario manipula el diálogo del sistema operativo.

### Mejoras propuestas

#### 3a. Lista de archivos seleccionados con opción de eliminar
Tras seleccionar archivos, mostrar una lista con el nombre de cada archivo (con badge de extensión `.txt`), un ícono de estado (pendiente / en curso / completado / error) y un botón de eliminación individual (`×`). La lista persiste hasta que se inicia la subida.

#### 3b. Barra de progreso durante la subida
Durante `handleUpload()`, la iteración secuencial ya conoce el índice del archivo actual (`i / total`). Agregar un estado `uploadProgress` (`{ current: number, total: number, currentFile: string }`) y renderizar una barra de progreso que avance archivo por archivo.

#### 3c. Validación estricta de extensión `.txt`
Agregar validación explícita de extensión antes del regex de nombre:
```js
const notTxt = files.find(f => !f.name.toLowerCase().endsWith('.txt'))
if (notTxt) { setUploadFileError(`Solo se aceptan archivos .txt`) ; return }
```
El atributo `accept=".txt"` ya existe en el input pero no es enforced por todos los navegadores.

### Archivos involucrados
| Archivo | Cambio |
|---------|--------|
| `src/screens/ConfigScreen.jsx` | Lista de archivos con delete, estado `uploadProgress`, validación `.txt` explícita |

---

## M-04 · Revisión de pantallas de reporte

### ResultadosScreen
- **Sección SLA por aeropuerto**: la columna `sla_cumplido` se deriva del semáforo (`rojo → no`), no del SLA real de los envíos que pasaron por ese aeropuerto. Debería basarse en el ratio de envíos entregados a tiempo vs retrasados asociados al aeropuerto.
- **Historial de vuelos**: actualmente muestra solo estado final. Agregar columna de maletas transportadas y columna de cancelaciones ocurridas.
- **Exportar**: el botón "EXPORTAR REPORTE CSV" y "DESCARGAR REGISTRO DE EXPERIMENTOS" son dos acciones distintas con estilos similares — diferenciación visual más clara (primario vs secundario).

### DashboardScreen
- El gráfico de throughput (SLA OK / Breach por día) usa colores fijos. Agregar leyenda explícita dentro del gráfico.
- La tabla de aeropuertos por ocupación no muestra el nombre completo de la ciudad — solo IATA. Agregar tooltip o columna de ciudad.
- Considerar agregar un indicador del día actual dentro del gráfico (línea vertical).

### ColapsoScreen
- La tabla "Top aeropuertos críticos" muestra IATA y %. Agregar nombre de ciudad para contexto.
- Si `slaData` está vacío (no hay `throughputHistorial`), el gráfico no se renderiza pero no hay mensaje alternativo claro. Agregar un estado vacío explícito.
- Los envíos en "muestra retrasados" muestran solo 5. Agregar un contador total de retrasados al título del panel.

### Archivos involucrados
| Archivo | Cambio |
|---------|--------|
| `src/screens/ResultadosScreen.jsx` | Lógica `sla_cumplido`, diferenciación botones |
| `src/screens/DashboardScreen.jsx` | Leyenda gráfico, columna ciudad en tabla |
| `src/screens/ColapsoScreen.jsx` | Nombre ciudad en tabla, estado vacío gráfico, contador retrasados |

---

## M-05 · Revisión del reporte CSV exportado

### Estado actual
El archivo generado por `csvDownload()` en `ResultadosScreen.jsx` incluye:
- **Metadata**: `fecha_simulada`, `dias_simulacion`, `cumplimiento_sla_pct`, `sla_vencidos`
- **Tabla de aeropuertos**: `aeropuerto`, `recibidas`, `enviadas`, `ocup_prom_pct`, `ocup_max_pct`, `estado`, `sla_cumplido`

### Problemas identificados
1. **`sla_cumplido` incorrecto**: se deriva del color semáforo del aeropuerto, no del cumplimiento real de SLA de envíos. Un aeropuerto con almacén al 90% puede haber entregado todos sus envíos a tiempo.
2. **Sin datos de envíos**: el reporte no incluye el detalle por envío (ID, origen, destino, estado, SLA). Para una auditoría real esto es crítico.
3. **Nombre del archivo**: `tasf_reporte_dia_X.csv` no incluye la fecha simulada, lo que dificulta identificar el reporte fuera del sistema.
4. **Sin resumen de algoritmo**: el reporte no indica qué algoritmo se usó, el umbral de colapso (si aplica) ni el número de replanificaciones realizadas.
5. **Encoding**: el BOM `﻿` (U+FEFF) está incluido para compatibilidad con Excel en Windows, pero no se documenta ni se puede desactivar.

### Mejoras propuestas
- Corregir `sla_cumplido` para que refleje envíos entregados a tiempo desde/hacia ese aeropuerto.
- Agregar una segunda sección al CSV con resumen de envíos: `id_envio`, `origen`, `destino`, `estado`, `sla_dias`, `cumplido`.
- Nombre de archivo: `tasf_reporte_YYYY-MM-DD_dia-X.csv` usando `fechaSimulada`.
- Agregar fila de metadata: `algoritmo`, `umbral_colapso_pct`, `total_replanificaciones`.

### Archivos involucrados
| Archivo | Cambio |
|---------|--------|
| `src/screens/ResultadosScreen.jsx` | Función `csvDownload()`: sección envíos, nombre archivo, metadata algoritmo |

---

## Prioridad sugerida

| ID | Impacto en evaluación | Esfuerzo |
|----|----------------------|----------|
| M-01 | Alto — afecta métricas SLA visibles al evaluador | Medio |
| M-03 | Medio — mejora UX del flujo principal de carga | Bajo |
| M-05 | Medio — calidad del artefacto exportable | Bajo |
| M-04 | Medio — pulido de pantallas de reporte | Medio |
| M-02 | Bajo — visual, no funcional | Bajo |
