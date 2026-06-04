# Requerimientos en Stand By

**Fecha:** 2026-06-03
**Estado:** Pendientes de implementación — priorizados para siguiente iteración o bloqueados por dependencia

---

## SB1 — Acceso a envíos desde LiveScreen (`#38`, `#39`)

**Clasificación:** Parcial · Media

`DrawerVuelo` existe y funciona en simulación. En `LiveScreen` (modo operaciones en vivo) al hacer click en un vuelo de la lista no se abre el drawer con detalle de envíos y maletas.

**Bloqueado por:** Rediseño pendiente de `LiveScreen` en general.

**Archivos afectados:** `src/screens/LiveScreen.jsx`, `src/drawers/DrawerVuelo.jsx`

---

## SB2 — Cronómetro de sesión en LiveScreen (`#15`)

**Clasificación:** Parcial · Baja

`TopBar` muestra cronómetros REAL y SIM durante simulación. En `LiveScreen` no hay indicador de tiempo transcurrido desde que el operador inició la sesión de operaciones en vivo.

**Bloqueado por:** Mismo bloque que SB1 (rediseño LiveScreen).

**Archivos afectados:** `src/screens/LiveScreen.jsx`, `src/components/TopBar.jsx`

---

## SB3 — Reporte final con envíos no completados (`#95`, `#97`)

**Clasificación:** Parcial · Media

`ResultadosScreen` muestra métricas SLA al finalizar. Los envíos en estado `EN_TRANSITO` o `PLANIFICADO` al cierre no aparecen en el reporte. Requiere cambio en backend (marcar envíos al stop) y nueva sección en `ResultadosScreen`.

**Archivos afectados:** `backend/.../SimulationEngine.java`, `src/screens/ResultadosScreen.jsx`

---

## SB4 — Reporte diario del plan (`#96`)

**Clasificación:** Nada/Poco · Alta

No hay snapshot por día. Solo existe `ResultadosScreen` al finalizar la simulación completa. Requiere que el backend guarde un snapshot al final de cada `avanzarDia()` y un endpoint `GET /simulation/daily-report/{day}`, más UI en `DashboardScreen`.

**Archivos afectados:** `backend/.../SimulationEngine.java`, `backend/.../SimulationController.java`, `src/screens/DashboardScreen.jsx`
