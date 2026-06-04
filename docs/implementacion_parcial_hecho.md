# Documento de Implementación — Ítems Completados

**Fecha de cierre:** 2026-06-03
**Ítems implementados:** 6 de 9 (restantes en `req_stand_by.md`)

---

## P1 — Semáforo de color en vuelos (`#40`)

**Requerimiento:** Indicador visual de carga de cada vuelo activo usando código de color verde/ámbar/rojo.

**Implementado:**
- Thresholds: ≥85% → rojo, ≥60% → ámbar, <60% → verde
- Dot y badge de cada vuelo en `RightPanel` usan el color calculado
- Barra de progreso de carga añadida debajo del meta de cada vuelo

**Archivos:** `src/components/RightPanel.jsx`

---

## P2 — Rutas automáticas en mapa (`#31`, `#33`)

**Requerimiento:** Las polylines origen-destino deben aparecer automáticamente al inicio del vuelo, sin requerir click del usuario.

**Implementado:**
- Todos los vuelos activos muestran sus 2 tramos siempre: segmento recorrido (blanco/gris) + segmento restante (azul punteado)
- Opacidad base 0.3 (tenue). Al seleccionar un vuelo, los demás dimean a 0.15 y el seleccionado se resalta con su polyline de mayor peso
- Botón toggle "— rutas / + rutas" (bottom-right del mapa) para ocultar/mostrar todas las líneas de fondo

**Archivos:** `src/components/MapView.jsx`

---

## P3 — Búsqueda por tramo en RightPanel (`#41`)

**Requerimiento:** El buscador de vuelos debe permitir buscar por par origen-destino (ej. "SKBO-MMMX").

**Implementado:**
- El filtro de texto ahora matchea: código de vuelo, origen, destino, y el par combinado `"ORIG-DEST"`
- Compatible con búsqueda parcial en cualquier campo

**Archivos:** `src/components/RightPanel.jsx`

---

## P4 — Filtro de vuelos por aeropuerto de origen y destino (`#42`, `#43`)

**Requerimiento:** Permitir al usuario filtrar la lista de vuelos activos por aeropuerto de origen y/o destino de forma independiente.

**Implementado:**
- Dos selectores (Origen / Destino) debajo del buscador de texto en `RightPanel`
- Opciones construidas dinámicamente desde los vuelos activos reales
- Si se selecciona un origen, ese aeropuerto se excluye de las opciones de destino, y viceversa
- Filtros combinables entre sí y con el buscador de texto
- Colores adaptados a tema oscuro y claro

**Archivos:** `src/components/RightPanel.jsx`, `src/App.jsx`

---

## P5 — Ordenamiento interactivo de almacenes (`#62`)

**Requerimiento:** El usuario debe poder ordenar la lista de almacenes por porcentaje de ocupación de forma interactiva.

**Implementado:**
- Botón toggle ↓/↑ en el header de la sección "Warehouse por aeropuerto"
- Orden descendente por defecto (mayor ocupación primero), toggle a ascendente

**Archivos:** `src/components/RightPanel.jsx`

---

## P8 — Visualización compartida entre múltiples usuarios (`#5`, `#6`)

**Requerimiento:** Varios navegadores deben poder conectarse y ver la misma simulación en curso, con interacciones de UI independientes.

**Implementado (mínimo viable — frontend):**
- Al montar la app, se consulta `GET /api/simulation/state`; si hay simulación activa o finalizada, se hidrata el estado y se inicia el polling automáticamente
- Usuario B que se conecta después de que Usuario A inició la simulación ve el estado actual sin necesidad de acciones adicionales
- Toda la UI interactiva (filtros, selecciones, drawers) ya era local por naturaleza (React `useState`)
- **No implementado:** sesiones completamente independientes con `sessionId` — la simulación es una sola compartida, lo cual es el comportamiento correcto según los requerimientos

**Archivos:** `src/App.jsx`

---

## Fixes adicionales (fuera del alcance original del doc)

| Fix | Descripción | Archivos |
|-----|-------------|----------|
| TopBar responsive | KPIs, time blocks y tabs reducen padding/minWidth para adaptarse a ventanas angostas | `src/components/TopBar.jsx` |
| Reset optimista | La UI resetea inmediatamente; la llamada al backend va async sin bloquear | `src/App.jsx` |
