# Tareas Pendientes — Orden de Implementación

**Base:** análisis de `estado_implementacion.md` | **Fecha:** 2026-05-28

> Ordenadas de más sencilla a más compleja dentro de cada categoría.
> Criterio de la rúbrica entre paréntesis para rastreo.

---

## FRONTEND

### Nivel 1 — Triviales (< 1 hora cada una)

#### F-01 · Activar tab de Vuelos
**Criterios:** B-70, B-72, B-73, B-74

`VuelosScreen.jsx` ya existe y tiene contenido. Solo falta agregar el tab en `TopBar.jsx`.

```
TopBar.jsx → array de tabs → agregar entrada 'vuelos' apuntando a VuelosScreen
```

---

#### F-02 · Mostrar hora de pared real en TopBar
**Criterio:** B-36

Actualmente muestra tiempo elapsed (`HH:MM:SS`). Agregar reloj del sistema al lado.

```
TopBar.jsx → usar setInterval con new Date().toLocaleTimeString()
Mostrar junto al elapsed existente, etiquetado como "HORA LOCAL"
```

---

#### F-03 · Agregar segundos al reloj simulado
**Criterio:** B-35

El reloj simulado muestra `YYYY-MM-DD HH:MM`. El estado interno tiene `simClockMinutes` con resolución de minutos. Derivar segundos del ciclo de animación (real seconds % 60).

```
TopBar.jsx / App.jsx → formatear también los segundos del elapsed real
como offset dentro del minuto simulado actual
```

---

#### F-04 · Exponer checkbox "Modo Colapso" en ConfigScreen
**Criterio:** E3-1

El backend ya tiene `esColapso: boolean` en `ParametrosSimulacion`. Solo falta el campo en la UI.

```
ConfigScreen.jsx → agregar toggle/checkbox "Simulación hasta el colapso"
→ incluir en el JSON que se envía a POST /api/simulation/start
→ cuando activo: deshabilitar selector de días (el backend lo ignora)
```

---

### Nivel 2 — Fáciles (1–3 horas cada una)

#### F-05 · Separar vuelos que parten vs. vuelos que arriban en DrawerAeropuerto
**Criterios:** B-10, B-11

`DrawerAeropuerto.jsx` muestra una lista única de vuelos conectados. Filtrar por `origen === airport.iata` vs `destino === airport.iata`.

```
DrawerAeropuerto.jsx:178–200
→ split en dos listas: "Salidas" (vuelos con origen=airport) y "Llegadas" (destino=airport)
→ mostrar bajo subtítulos separados con ícono de flecha ↑ / ↓
```

---

#### F-06 · Buscar aeropuerto por texto en AirportFilterPanel
**Criterio:** B-61

Actualmente solo hay checkboxes por continente. Agregar `<input>` de búsqueda que filtre la lista.

```
AirportFilterPanel.jsx → agregar input "Buscar aeropuerto (IATA o ciudad)"
→ filtrar la lista de aeropuertos según el texto antes de renderizar checkboxes
→ al borrar el texto, restaurar la lista completa
```

---

#### F-07 · Buscar vuelo por código en RightPanel o VuelosScreen
**Criterio:** B-74

```
RightPanel.jsx → agregar input de búsqueda sobre la lista de vuelos activos
  (filtrar por código de vuelo, origen o destino)
VuelosScreen.jsx → mismo mecanismo si se activa el tab (F-01)
```

---

#### F-08 · Mostrar dwell time en escalas (DrawerEnvio)
**Criterio:** B-75

El timeline de `DrawerEnvio.jsx` muestra hora de salida de cada vuelo. La hora de llegada del vuelo anterior y la salida del siguiente permiten calcular el tiempo de espera en la escala.

```
DrawerEnvio.jsx → entre cada par de tramos consecutivos:
  dwell = horaSalidaVueloSiguiente - horaLlegadaVueloAnterior
  mostrar "⏱ X h en [IATA]" entre los nodos del timeline
```

---

#### F-09 · Mostrar lista de maletas asignadas a un vuelo en DrawerVuelo
**Criterio:** B-73

Actualmente solo muestra `load/capacity` numérico. Requiere que el backend exponga la lista de envíos por vuelo.

```
Paso 1 (backend F depende de B-01): GET /api/flights/{code}/envios
Paso 2: DrawerVuelo.jsx → nueva sección "Maletas asignadas"
  lista scrollable de envíos con ID, origen→destino, cantidad de maletas
```

---

#### F-10 · Tabla de vuelos con estado final en ResultadosScreen
**Criterio:** E1-6

`ResultadosScreen.jsx` tiene métricas agregadas pero no una tabla por vuelo.

```
ResultadosScreen.jsx → nueva sección "Historial de vuelos"
  columnas: Código, Origen, Destino, Estado (COMPLETADO/CANCELADO), Maletas transportadas
  datos de backendState.vuelos filtrados al final de la simulación
```

---

#### F-11 · Panel de cancelaciones con lista por tipo
**Criterios:** B-63, B-64, B-78, B-79, B-80

Agregar sección en un panel existente (ej. dentro de DashboardScreen o como drawer nuevo) que muestre las cancelaciones del log de operaciones clasificadas.

```
Opción A: nueva sección en DashboardScreen
Opción B: nuevo drawer CancelacionesPanel.jsx

Lógica: filtrar backendState.logOperaciones por tag '[INCIDENCIA]'
  parsear para extraer código de vuelo, tipo y hora
  mostrar en tabla agrupada por Tipo 1 / 2 / 3
```

---

### Nivel 3 — Intermedias (3–8 horas cada una)

#### F-12 · Mostrar rutas canceladas en mapa (en lugar de ocultar el vuelo)
**Criterios:** B-19, B-20, B-21, B-22, B-45, B-46, B-47, B-51

Actualmente `MapView.jsx:259` filtra fuera los vuelos cancelados. Cambiar por renderizar su ruta con estilo distinto.

```
MapView.jsx:
  1. Mantener vuelos cancelados en la lista renderizada (quitar el filtro)
  2. Para vuelos con status === 'cancelled':
     - renderizar Polyline rojo grueso (weight: 3) con dashArray: '8 6'
     - en lugar del ícono de avión, mostrar ícono de bloqueo (✕) en punto medio de la ruta
     - tooltip: "VUELO {code} CANCELADO — {origen}→{destino} — {hora}"
  3. Click en la ruta cancelada → abrir DrawerVuelo con el vuelo cancelado
```

Habilita también: B-51 (seleccionar cancelación desde mapa → panel).

---

#### F-13 · Diferenciar tramo recorrido vs. pendiente en ruta de vuelo seleccionado
**Criterio:** B-34

Actualmente la ruta muestra solo origen→destino completa. El progreso del vuelo se conoce desde `simClockMinutes` y los horarios de salida/llegada.

```
MapView.jsx (vuelo seleccionado):
  1. Calcular fracción recorrida: progress = (simClockMinutes - departureMin) / (arrivalMin - departureMin)
  2. Calcular punto intermedio = mercatorLerp(origin, dest, progress)
  3. Renderizar dos Polylines:
     - origin → currentPos: gris (opacity 0.5, weight 2) — "recorrido"
     - currentPos → dest: azul (weight 3, dashArray original) — "pendiente"
```

---

#### F-14 · Fly-to al seleccionar aeropuerto desde panel
**Criterios:** B-52, B-53

Al hacer click en aeropuerto en `DashboardScreen` o `RightPanel`, el mapa debe centrar en ese aeropuerto.

```
App.jsx → agregar ref: mapRef = useRef()
MapView.jsx → exponer mapInstance via useImperativeHandle o callback
DashboardScreen/RightPanel → al click en aeropuerto:
  1. setActiveTab('main') para ir al mapa
  2. mapRef.current.flyTo([lat, lng], zoom=5)
  3. setSelectedAirport(airport) → abrir DrawerAeropuerto
```

---

#### F-15 · Gráfico de evolución de stock de almacenes por día
**Criterio:** E1-5

Requiere que el backend provea snapshots diarios de ocupación por aeropuerto.

```
Paso 1 (depende de B-02): endpoint GET /api/simulation/warehouse-history
Paso 2: DashboardScreen.jsx → nuevo gráfico (Chart.js Line chart)
  X: días D1, D2, ... Dn
  Y: % ocupación
  una línea por aeropuerto (toggle por continente)
  o agregado por continente para no saturar
```

---

### Nivel 4 — Complejas (8+ horas cada una)

#### F-16 · Notificación visual de colapso de operación
**Criterio:** E3-3

Requiere recibir del backend la señal de colapso detectado.

```
App.jsx → en cada polling de /state, revisar nuevo campo backendState.colapsoDetectado
Si true:
  mostrar banner rojo fijo en TopBar: "⚠️ COLAPSO DETECTADO — DÍA X — SLA al Y%"
  reproducir animación de alerta en mapa (overlay semitransparente rojo)
  pausar auto-step automáticamente
```

---

#### F-17 · Pantalla/reporte del punto de colapso
**Criterio:** E3-4

```
Nuevo tab o modal "COLAPSO" (activable solo si esColapso=true):
  - Gráfico de SLA % por día hasta el punto de colapso
  - KPI: día exacto del colapso, causa principal (almacén X al 100% / Y% de SLA vencido)
  - Tabla: top 5 aeropuertos con mayor ocupación en el momento del colapso
  - Tabla: top 5 envíos con mayor demora
  Datos: GET /api/simulation/collapse-report (nuevo endpoint backend)
```

---

#### F-18 · Comparación side-by-side de algoritmos (SA vs. TS)
**Criterios:** E3-6, RNF-2

```
ResultadosScreen.jsx → nueva sección "Comparación de Algoritmos"
  Solo activa si hay ≥2 experimentos registrados
  Tabla: Métrica | SA | TS
    - Tiempo de ejecución (ms)
    - Rutas evaluadas
    - SLA % final
    - Tiempo de planificación
    - Ocupación promedio almacenes
  Datos: GET /api/experimentos → listar todos, agrupar por algoritmo, tomar el último de cada uno
```

---

## BACKEND

### Nivel 1 — Triviales (< 1 hora cada una)

#### B-01 · Endpoint GET /api/flights/{code}/envios
**Criterio:** B-73 (habilita F-09)

`SimulationEngine` ya tiene `planMaletas` (mapa de maleta → PlanDeViaje). Filtrar por código de vuelo.

```java
// SimulationController.java → nuevo endpoint
@GetMapping("/flights/{code}/envios")
public ResponseEntity<List<EnvioDTO>> getEnviosByFlight(@PathVariable String code) {
    return ResponseEntity.ok(simulationEngine.getEnviosByFlight(code));
}

// SimulationEngine.java → nuevo método
public List<EnvioDTO> getEnviosByFlight(String codigoVuelo) {
    return envios.stream()
        .filter(e -> e.getPlanDeViaje() != null &&
                     e.getPlanDeViaje().getEscalas().stream()
                      .anyMatch(s -> s.getVuelo().getCodigoVuelo().equals(codigoVuelo)))
        .map(this::toEnvioDTO)
        .collect(toList());
}
```

---

#### B-02 · Conectar cancelRandomFlightsAndReplan() en avanzarDia()
**Criterio:** B-47

El método existe en `SimulationEngine.java:729–770` pero no es llamado durante el ciclo diario.

```java
// SimulationEngine.java → método avanzarDia()
// Agregar al inicio del día, después de procesarSalidas():
if (parametros.isEsColapso()) {
    cancelRandomFlightsAndReplan();
}
```

---

#### B-03 · Exponer parámetros configurables de algoritmos
**Criterio:** A-6 (Ta), mejora de RNF-2

`ParametrosSimulacion.java` no tiene campos para temperatura inicial, cooling rate ni tabu list size.

```java
// ParametrosSimulacion.java → agregar campos:
private Double temperaturaInicial = 1000.0;  // SA
private Double coolingRate = 0.995;           // SA
private Integer tabuListSize = null;          // TS — null = auto

// SimulatedAnnealingAlgorithm.java → usar parametros.getTemperaturaInicial() en lugar de literal
// TabuSearchAlgorithm.java → usar parametros.getTabuListSize() si no null
// ConfigScreen.jsx → agregar inputs opcionales (colapsados por defecto, "Configuración avanzada")
```

---

### Nivel 2 — Fáciles (1–3 horas cada una)

#### B-04 · Endpoint GET /api/simulation/cancelaciones
**Criterios:** B-63, B-64, B-78, B-79, B-80 (habilita F-11)

`SimulationEngine` ya mantiene una lista de `Cancelacion` objetos en memoria.

```java
// SimulationController.java → nuevo endpoint
@GetMapping("/cancelaciones")
public ResponseEntity<List<CancelacionDTO>> getCancelaciones() {
    if (!simulationEngine.isInitialized()) return ResponseEntity.noContent().build();
    return ResponseEntity.ok(simulationEngine.getCancelaciones());
}

// CancelacionDTO.java → nuevo DTO:
// codigoVuelo, origenIata, destinoIata, fecha, hora, motivo, tipo (1/2/3)
// SimulationEngine → enriquecer Cancelacion con tipo al crearla
```

---

#### B-05 · Endpoint GET /api/simulation/vuelos-historial
**Criterio:** E1-6 (habilita F-10)

Al final de la simulación, exponer estado final de todos los vuelos.

```java
// SimulationController.java → nuevo endpoint
@GetMapping("/vuelos-historial")
public ResponseEntity<List<VueloEstadoFinalDTO>> getVuelosHistorial() { ... }

// VueloEstadoFinalDTO: codigoVuelo, origen, destino, estado (COMPLETADO/CANCELADO),
//   maletasTransportadas, fechaCancelacion (nullable)
// SimulationEngine → acumular estado final en avanzarDia() al procesar salidas/llegadas
```

---

#### B-06 · Agregar tipo (1/2/3) a objetos Cancelacion
**Criterios:** B-78, B-79, B-80

`Cancelacion.java` no tiene campo `tipo`. Enriquecer al crear cada cancelación.

```java
// Cancelacion.java → agregar: private int tipo; // 1=programada, 2=en_tránsito, 3=masiva

// SimulationEngine.java:
//   cancelarVueloManualmente() → tipo = 1
//   rescueBags() cuando vuelo en estado EN_VUELO → tipo = 2
//   cancelRandomFlightsAndReplan() → tipo = 3
```

---

### Nivel 3 — Intermedias (3–8 horas cada una)

#### B-07 · Snapshots diarios de ocupación de almacenes
**Criterio:** E1-5 (habilita F-15)

Actualmente solo se guarda `ocupacionActual` (punto en el tiempo). Necesario guardar historial por día.

```java
// SimulationEngine.java → nueva estructura:
private Map<Integer, Map<String, Double>> warehouseSnapshotsByDay = new LinkedHashMap<>();
// dia → (iata → %ocupacion)

// avanzarDia() → al final de cada día:
Map<String, Double> snapshot = aeropuertos.stream()
    .collect(toMap(a -> a.getCodigoIata(),
                   a -> a.getCapacidadAlmacen() > 0
                        ? 100.0 * a.getOcupacionActual() / a.getCapacidadAlmacen()
                        : 0.0));
warehouseSnapshotsByDay.put(diaActual, snapshot);

// SimulationController.java → nuevo endpoint GET /api/simulation/warehouse-history
// Retorna: List<WarehouseDayDTO> con dia + Map<iata, pct>
```

---

#### B-08 · Lógica de detección de colapso
**Criterios:** E3-3, E3-4

Definir condición de colapso y registrar el punto exacto.

```java
// ParametrosSimulacion.java → agregar:
private double umbralColapsoPorcentajeSlaVencido = 50.0; // % de SLA vencido = colapso

// SimulationEngine.java → nuevo campo:
private ColapsoPunto colapsoPunto = null; // null = no colapsó

// checkSlaViolations() → al final de cada día:
double pctVencido = (double) slaVencidos / totalEnviosEvaluables * 100;
if (esColapso && colapsoPunto == null && pctVencido >= umbralColapsoPorcentajeSlaVencido) {
    colapsoPunto = new ColapsoPunto(diaActual, pctVencido, causaPrincipal());
    log("[COLAPSO] Operación colapsó en Día " + diaActual + " — SLA vencido: " + pctVencido + "%");
}

// ColapsoPunto.java: dia, pctSlaVencido, aeropuertoMasCritico, maletasAtascadas
// SimulationStateDTO → agregar colapsoPunto (null si no aplica)
// GET /api/simulation/collapse-report → retorna ColapsoPunto + métricas del día del colapso
```

---

#### B-09 · Actualización manual de estado de maletas por aeropuerto
**Criterio:** E2-3

Permite a un operador registrar manualmente que maletas llegaron/salieron de un aeropuerto (real-time ops).

```java
// Nuevo endpoint:
// POST /api/airports/{iata}/confirmar-llegada   body: { envioId, hora }
// POST /api/airports/{iata}/confirmar-salida    body: { codigoVuelo, hora }

// SimulationEngine.java → nuevos métodos:
//   confirmarLlegadaMaleta(iata, envioId) → actualizar estado de maleta a EN_ALMACEN en ese aeropuerto
//   confirmarSalidaVuelo(iata, codigoVuelo) → actualizar maletas del vuelo a EN_VUELO

// Frontend F depende: botón "Confirmar llegada" / "Confirmar salida" en DrawerAeropuerto
```

---

### Nivel 4 — Complejas (8+ horas cada una)

#### B-10 · Dashboard comparativo de algoritmos con datos históricos
**Criterios:** RNF-2, E3-6

Actualmente `ExperimentacionController` guarda en un CSV en memoria. Necesario persistir y exponer de forma estructurada.

```java
// ExperimentoEntity.java → nueva JPA entity:
//   id, algoritmo, diaEjecucion, cumplimientoSla, tiempoEjecucionMs,
//   rutasEvaluadas, ocupacionPromAlmacen, totalEnvios, slaVencidos, timestamp

// ExperimentacionRepository → JPA CRUD
// ExperimentacionService → guardar y consultar

// GET /api/experimentos → List<ExperimentoDTO> con todos los registros
// GET /api/experimentos/comparar?alg1=SA&alg2=TS → estadísticas agregadas por algoritmo

// Frontend F-18 consume este endpoint para la tabla comparativa
```

---

## Resumen de dependencias

```
F-09 (maletas en vuelo) ────────────────── depende de ── B-01
F-11 (panel cancelaciones) ─────────────── depende de ── B-04, B-06
F-12 (cancelaciones en mapa) ──────────── habilita ───── B-51, F-11
F-15 (gráfico stock almacenes) ─────────── depende de ── B-07
F-16 (notificación colapso) ────────────── depende de ── B-08
F-17 (reporte punto de colapso) ────────── depende de ── B-08
F-18 (comparación SA vs TS) ────────────── depende de ── B-10
B-02 (cancelRandomFlights) ─────────────── habilita ───── F-12 (Tipo 3 en mapa)
```

## Orden sugerido de implementación

```
Semana 1 (quick wins):
  B-02, B-03, B-06          ← backend trivial
  F-01, F-02, F-03, F-04   ← frontend trivial

Semana 2 (impacto visual alto):
  B-04, B-05                ← endpoints necesarios
  F-05, F-06, F-07, F-08   ← mejoras de UX
  F-12                      ← cancelaciones en mapa (mayor impacto en rúbrica)

Semana 3 (escenarios y análisis):
  B-07, B-08               ← snapshots y detección de colapso
  F-10, F-11, F-13, F-14  ← tablas y navegación
  F-15, F-16, F-17         ← colapso visual

Semana 4 (experimentación):
  B-09, B-10               ← comparación algoritmos
  F-18                     ← dashboard comparativo
```
