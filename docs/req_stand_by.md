# Requerimientos en Stand By

**Fecha:** 2026-06-03
**Estado:** Pendientes de implementación — bloqueados por dependencia o priorizados para siguiente iteración

---

## SB1 — Acceso a envíos desde LiveScreen (`#38`, `#39`)

**Clasificación:** Parcial · Complejidad Media

**Descripción:** `DrawerVuelo` ya existe y funciona en la pantalla de simulación. En `LiveScreen` (modo operaciones en vivo) no está conectado. Al hacer click en un vuelo de la lista no se abre el drawer con el detalle de envíos y maletas.

**Bloqueado por:** Corrección pendiente de `LiveScreen` en general (rediseño de la vista).

**Archivos afectados:**
- `src/screens/LiveScreen.jsx`
- `src/drawers/DrawerVuelo.jsx`

---

## SB2 — Cronómetro de sesión en LiveScreen (`#15`)

**Clasificación:** Parcial · Complejidad Baja

**Descripción:** La TopBar muestra cronómetros REAL y SIM durante la simulación. En `LiveScreen` no hay indicador de tiempo transcurrido desde que el operador inició la sesión de operaciones en vivo.

**Bloqueado por:** Corrección pendiente de `LiveScreen` (mismo bloque que SB1).

**Archivos afectados:**
- `src/screens/LiveScreen.jsx`
- `src/components/TopBar.jsx`

---

## SB3 — Reporte final con envíos no completados (`#95`, `#97`)

**Clasificación:** Parcial · Complejidad Media

**Descripción:** `ResultadosScreen` muestra métricas SLA al finalizar la simulación. Los envíos que quedan en estado `EN_TRANSITO` o `PLANIFICADO` al cierre no aparecen en el reporte — no hay sección de "no completados". Requiere cambio en backend (marcar envíos al stop) y frontend (nueva sección en ResultadosScreen).

**Bloqueado por:** Requiere modificar `SimulationEngine.java` en el backend. No bloqueado por LiveScreen.

**Archivos afectados:**
- `backend/src/main/java/com/tasf/backend/simulation/SimulationEngine.java`
- `src/screens/ResultadosScreen.jsx`
