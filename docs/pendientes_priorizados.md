# Pendientes Priorizados — Luggage Manager

**Generado:** 2026-05-31 | **Branch:** feature/backend

> Excluye stand-by: F-11, F-12, F-15, B-04, B-07.
> Excluye externos: RNF-4/5/6/7, B-83/84/85/86, A-5.

---

## Por qué siguen registrados

El documento `estado_implementacion.md` refleja la rúbrica **completa** del curso. De los ~35 criterios ⚠️/❌ pendientes:

- **7 son externos** (videos, lab PUCP, proceso VSE) — no son código, son gestión
- **9 dependen de stand-by** (B-04/07/F-11/F-12/F-15) — bloqueados por decisión previa
- **~19 son implementables** — algunos triviales (1 línea), otros medianos, ninguno arquitecturalmente complejo

---

## Nivel 1 — Fácil (< 2h, 1–2 archivos cada uno)

| ID | Criterio(s) | Qué falta | Archivo principal |
|----|-------------|-----------|-------------------|
| **X-01** | B-35 | Segundos en tiempo simulado en TopBar | `TopBar.jsx:224` — ya existe `realElapsedSeconds`, solo formatear `:SS` |
| **X-02** | B-52, B-53 | Clic en aeropuerto desde panel → `flyTo()` en mapa | `AirportFilterPanel.jsx` + pasar `mapRef` desde `App.jsx` |
| **X-03** | RNF-3 | Umbral rojo configurable (actualmente derivado de ámbar) | `ConfigScreen.jsx:273–301` — agregar tercer slider/input |
| **X-04** | A-1 | Versión explícita en `pom.xml` | `backend/pom.xml` — `<version>1.0.0</version>` |
| **X-05** | B-47 | Cancelación Tipo 3 conectada al ciclo de simulación | `SimulationEngine.java:avanzarDia()` — llamar `cancelRandomFlightsAndReplan()` cuando `esColapso=true` |

---

## Nivel 2 — Medio (2–5h, varios archivos)

| ID | Criterio(s) | Qué falta | Complejidad |
|----|-------------|-----------|-------------|
| **X-06** | B-30, B-31 | Toggle para mostrar **todas** las rutas simultáneamente en mapa | Checkbox en `AirportFilterPanel` → loop en `MapView` renderizando `<Polyline>` por cada vuelo activo |
| **X-07** | B-70 | Tab VUELOS como pantalla funcional (actualmente dead code) | Agregar `'vuelos'` a `TopBar.jsx:tabs`, conectar nav a `VuelosScreen.jsx` existente |
| **X-08** | B-32 | Leyenda de colores de rutas visible en mapa | Componente mini-leyenda sobre `MapView` (overlay CSS, sin librería) |
| **X-09** | B-77 | Rango horario de cancelación/mantenimiento de vuelo | Backend: guardar `fechaHoraCancelacion` en `VueloEntity`; frontend: mostrar en `DrawerVuelo.jsx` |
| **X-10** | B-64 | Tabla estructurada de vuelos cancelados | Subtab "CANCELADOS" en `EnviosScreen.jsx` usando datos ya disponibles en `backendState.vuelos` filtrados por estado |

---

## Nivel 3 — Requiere diseño (> 5h)

| ID | Criterio(s) | Qué falta | Por qué es complejo |
|----|-------------|-----------|---------------------|
| **X-11** | B-9, B-16, B-17, B-18 | Hover tooltips en aeropuerto con maletas planificadas salientes/entrantes | Nuevo endpoint `GET /api/airports/{iata}/pending-envios`; serializar en Leaflet popup sin lag |
| **X-12** | E2-3 | Actualización manual por aeropuerto (operador registra llegada/salida) | Nuevo flujo UX: input modal + endpoint `POST /api/simulation/airport/{iata}/manual-update`; define qué "manual" significa aquí |
| **X-13** | E3-6, RNF-2 | Comparar SA vs TS con dashboard numérico | Requiere re-habilitar TS en `PlanningService.java` (actualmente solo SA), ejecutar ambos en paralelo y comparar métricas en UI — rediseño del flujo de planificación |

---

## Externos (no código — gestión)

| Criterio | Acción |
|----------|--------|
| RNF-4 | Coordinar con lab PUCP para verificar despliegue en su infraestructura |
| RNF-5 | Preparar evidencia VSE: actas de reunión, historial tareas, commits como evidencia |
| RNF-6, RNF-7 | Grabar videos de los 3 escenarios (30–90 min) |
| B-85 | Video de simulación semanal completa |
| A-5 | Confirmar URL/IP de despliegue con el laboratorio |

---

## Impacto rúbrica por nivel

| Nivel | Items | Criterios directos | Criterios desbloqueados |
|-------|-------|--------------------|------------------------|
| Fácil (X-01–05) | 5 | 6 | 0 |
| Medio (X-06–10) | 5 | 6 | 2 (B-70 activa tab; B-64 cubre B-78/79/80 parcialmente) |
| Diseño (X-11–13) | 3 | 6 | 0–5 (E2-3 standalone; E3-6 desbloquea RNF-2) |

**Recomendación de orden:** X-05 → X-07 → X-02 → X-01 → X-10 → X-06 → X-03.  
X-05 (Tipo 3 en ciclo) da E3 robustez sin costo de UI. X-07 (tab Vuelos) es un archivo existente, solo conectar nav. X-02 (flyTo) es UX visible para el evaluador.
