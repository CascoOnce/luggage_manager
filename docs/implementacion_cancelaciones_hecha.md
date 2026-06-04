# Implementación de Cancelaciones

## Backend

### 1. `ParametrosSimulacion` — nuevo campo `porcentajeCancelacionAleatoria`

Campo `double`, default `0.0`. Se envía desde el frontend al iniciar simulación. Cuando es `0`, las cancelaciones aleatorias no ocurren. Cuando es, por ejemplo, `10`, el sistema cancela aleatoriamente ~10% de los vuelos planificados cada día.

**Impacto interno:** controla si `cancelRandomFlightsAndReplan()` se activa en cada paso de simulación.

---

### 2. `SimulationEngine` — cancelaciones aleatorias cableadas

`cancelRandomFlightsAndReplan()` existía como método pero nunca era llamado. Ahora se invoca al final de cada `avanzarDia()` si `porcentajeCancelacionAleatoria > 0`. Usa el porcentaje del parámetro en lugar del 5–8% hardcodeado anterior.

**Impacto interno:** las cancelaciones aleatorias ahora son opt-in y controladas. Sin activarlas, el comportamiento de la simulación es idéntico al anterior.

---

### 3. `CancelacionDTO` + `SimulationStateDTO` — historial estructurado

Se creó `CancelacionDTO` (campos: `id`, `codigoVuelo`, `fecha`, `hora`). El estado de simulación (`SimulationStateDTO`) ahora incluye `List<CancelacionDTO> cancelaciones`, construida desde la lista interna del `SimulationEngine`.

**Impacto interno:** el frontend ya no necesita hacer grep sobre el log de operaciones para contar cancelaciones. Tiene una lista tipada con cada cancelación ocurrida (manual o aleatoria) en la simulación actual.

---

### 4. `DataLoaderService` — cancelaciones por sesión (live view)

Se agregó un `Set<String>` en memoria (`sessionCancelledFlights`) con métodos `cancelFlightForSession`, `isFlightCancelledForSession` y `clearSessionCancellations`. No persiste en BD.

**Impacto interno:** cuando se cancela un vuelo en live view, se agrega su código a este set. Los siguientes llamados a `getLiveState()` filtran esos vuelos, haciendo que desaparezcan del mapa. Al reiniciar el servidor el set se vacía.

---

### 5. `LiveService` — filtro de cancelados + método `cancelFlight`

`getLiveState()` ahora omite vuelos cuyo código esté en `sessionCancelledFlights`. Se agregó el método `cancelFlight(codigoVuelo)` que delega a `DataLoaderService`.

**Impacto visual:** un vuelo cancelado en live view desaparece del mapa y del panel lateral en el siguiente polling (cada 2 segundos).

---

### 6. `LiveController` — endpoint `POST /api/live/cancel-flight/{code}`

Endpoint nuevo que recibe el código de vuelo y llama `liveService.cancelFlight()`.

**Impacto:** habilita que el frontend pueda cancelar vuelos en modo live sin afectar la BD ni la simulación.

---

## Frontend

### 7. `api.js` — `cancelLiveFlight`

Nueva función `cancelLiveFlight(codigoVuelo)` que hace `POST /api/live/cancel-flight/{code}`. Se suma a la ya existente `cancelFlight` (para simulación).

---

### 8. `DrawerVuelo` — condición `canCancel` corregida

Antes: el botón "Cancelar vuelo" solo aparecía cuando el vuelo **no estaba activo** (`!isActivo`). Esto lo hacía inaccesible en la mayoría de casos.

Ahora: aparece para cualquier vuelo no cancelado cuando se le pasa el callback `onCancelFlight`. La lógica de negocio (si se puede cancelar) la maneja el backend.

**Impacto visual:** en live view, al hacer click en un vuelo del mapa, el DrawerVuelo muestra el botón "Cancelar vuelo" siempre que el vuelo no esté ya cancelado.

---

### 9. `ConfigScreen` — toggle de cancelaciones aleatorias

Nueva sección "Cancelaciones Aleatorias" con un botón toggle ON/OFF y un campo numérico (1–50) para el porcentaje diario. Deshabilitada por defecto.

**Impacto visual:** el operador ve la opción antes de iniciar simulación. Si la activa con 10%, cada día de simulación hay ~10% de probabilidad de que cada vuelo planificado ese día sea cancelado automáticamente.

---

### 10. `DrawerEnvio` — botón "Cancelar vuelo" por escala

En el timeline de ruta del envío, cada escala pendiente (no completada, no retrasada) muestra un botón rojo pequeño "Cancelar vuelo XXXX". Al confirmar:

1. Re-fetch del envío para validar que el estado no cambió mientras el operador veía la pantalla.
2. Si el vuelo ya no es cancelable (salió en vuelo), muestra alerta y no procede.
3. Si sigue cancelable, llama al backend, luego re-carga el detalle del envío en el drawer.

**Impacto visual:** el operador encuentra el envío buscando en la pantalla de Envíos, abre el drawer, y cancela directamente el vuelo asignado a ese envío sin salir de la pantalla.

---

### 11. `EnviosScreen` — búsqueda por código de vuelo

El campo de búsqueda ahora incluye `planResumen` en el haystack. `planResumen` contiene los códigos de vuelo de la ruta (ej. `"IB7423->LEMD | IB3401->SKBO"`).

**Impacto visual:** el operador puede escribir un código de vuelo (ej. "IB74") en la barra de búsqueda y la lista filtra solo los envíos que pasan por ese vuelo.

---

### 12. `App.jsx` — rewiring de `onCancelFlight`

- `DrawerVuelo` en la pantalla principal de simulación recibe `onCancelFlight={null}` (botón oculto — la cancelación en simulación se hace desde EnviosScreen).
- `EnviosScreen` recibe `onCancelFlight={handleCancelFlight}` (usa el endpoint de simulación).

---

### 13. `LiveScreen` — handler `handleCancelLiveFlight`

Función asíncrona que llama `api.cancelLiveFlight(codigoVuelo)` y cierra el drawer al terminar. Se pasa al `DrawerVuelo` como `onCancelFlight`.

**Impacto visual:** en live view el botón de cancelar vuelo funciona y el vuelo desaparece del mapa en el siguiente ciclo de polling.

---

### 14. `ResultadosScreen` — tabla de cancelaciones + CSV actualizado

**Pantalla:** aparece una tabla "Cancelaciones (N)" con ID, código de vuelo, fecha y hora de cada cancelación. Solo se muestra si hubo al menos una cancelación. El contador "Cancelaciones" en la grilla de KPIs usa la lista real en lugar de contar entradas del log.

**CSV exportado:** incluye una nueva sección `# CANCELACIONES` con columnas `id, codigo_vuelo, fecha, hora`, y el bloque de metadata incluye `total_cancelaciones`.
