# Plan de Fix — Aviones desaparecen al cambio de día

Fecha: 2026-05-23  
Estado: Pendiente de aprobación antes de implementar

---

## 1. Descripción del síntoma

Al llegar al cambio de día simulado (00:00), los aviones que estaban en pantalla
desaparecen brevemente y luego aparecen otros. Esto ocurre en **todos** los cambios
de día, no solo el primero.

---

## 2. Arquitectura relevante

```
setInterval cada 1s
  └─ setSimClockMinutes(prev + 120)   // avanza 2h simuladas por segundo
       └─ Math.min(next, 1440)         // clampea en 1440

useEffect [simClockMinutes, autoStep]
  └─ si simClockMinutes >= 1440
       └─ await api.stepSimulation()   // llama al backend
            └─ setBackendState(newState)
            └─ setSimClockMinutes(0)   // reinicia el reloj

backendFlights = useMemo(
  activeVuelosWithTimes
    .filter(v => isActiveAtMinute(simClockMinutes, v.depMin, v.arrMin))
    .map(v => ({ ...v, fraction: flightFractionAtMinute(...) }))
, [activeVuelosWithTimes, simClockMinutes])

function isActiveAtMinute(nowMin, depMin, arrMin) {
  if (arrMin > depMin) return nowMin >= depMin && nowMin < arrMin  // diurno
  return nowMin >= depMin || nowMin < arrMin                       // overnight
}
```

---

## 3. Hipótesis identificadas

Se identificaron **tres hipótesis** independientes que pueden coexistir. El síntoma
observado probablemente es la combinación de al menos dos.

---

### Hipótesis A — Filtro de vuelos incorrecto en el minuto exacto 1440

**Mecanismo:**
El reloj se clampea a `Math.min(next, 1440)`, quedando FIJO en 1440 durante el
tiempo que tarda el backend en responder. Durante ese período, `backendFlights`
se recalcula con `nowMin = 1440`.

Para todos los vuelos **diurnos** (`arrMin > depMin`), la condición es:
```
1440 >= depMin && 1440 < arrMin
```
Como `arrMin` es máximo 1439 (23:59), `1440 < arrMin` es **siempre false**.
→ **Todos los vuelos diurnos desaparecen del array al tocar minuto 1440.**

Los vuelos overnight (segunda rama del `||`) **no se ven afectados** y permanecen
visibles (verificado con vuelo SKBO→SBBR depMin=1322, arrMin=177).

**Duración del gap:** desde el tick que toca 1440 hasta que el backend responde
al `stepSimulation()`. Con el timeout de 60s puesto en la sesión anterior, este
gap puede ser de 1s (si el backend es rápido) hasta varios segundos.

**Probabilidad:** Alta. Es un bug determinista reproducible en cada día.

---

### Hipótesis B — Discontinuidad de horario al inicio del día nuevo

**Mecanismo:**
Cuando `stepSimulation()` retorna, el frontend ejecuta (en el mismo render batch):
```js
setBackendState(newState)   // vuelos del día N+1
setSimClockMinutes(0)       // reloj va a 00:00
```
En el nuevo estado, `backendFlights` se filtra con `simClockMinutes = 0`.
Solo son visibles los vuelos que satisfacen `isActiveAtMinute(0, depMin, arrMin)`:
- Vuelos diurnos con `depMin = 0` (salen exactamente a las 00:00) → casi ninguno
- Vuelos overnight con `arrMin > 0` (están en la segunda mitad de su viaje nocturno) → pocos

La mayoría de vuelos del día N+1 que salen a las 06:00, 08:00, 10:00 etc. aún no
son visibles a las 00:00. El cielo empieza casi vacío y los aviones "entran" uno
a uno conforme avanza el reloj.

**Duración del gap:** No es un gap real (no hay frame vacío), sino una transición
donde el cielo se "repuebla" gradualmente durante los primeros segundos del nuevo
día simulado. El usuario lo percibe como "entran los otros".

**Probabilidad:** Alta. Es inherente al modelo de simulación diaria con reset del reloj a 0.

---

### Hipótesis C — Acumulación de estado entre setBackendState del polling y del step

**Mecanismo:**
El polling corre cada 2 segundos con `api.getState()`. El step también actualiza
`backendState`. Si el polling y el step terminan casi al mismo tiempo, podrían
pisarse:

1. `stepSimulation()` retorna → `setBackendState(dia_N+1)` + `setSimClockMinutes(0)`
2. El polling que ya estaba en vuelo también retorna (tenía el estado del día N todavía)
3. El polling evalúa `if (state && (state.enEjecucion || state.finalizada))` → true
4. `setBackendState(dia_N)` sobreescribe el estado recién recibido

Esto causaría un "flash" donde el estado retrocede al día N por un render.

**Probabilidad:** Media-baja. Depende del timing exacto. React 18 batchea los
setState en async, pero dos Promises separadas en distintos setInterval pueden
no estar en el mismo batch.

---

### Hipótesis D — Posición de aviones "teleporta" en lugar de animar suavemente

**Mecanismo:**
`backendFlights` se recalcula cada 1 segundo (cada tick de 120 minutos).
Cada tick, la fracción de cada vuelo salta en `120 / duracionTotal`. Para un vuelo
de 2h (120min total), la fracción salta de 0 a 1 en un solo tick → el avión
teleporta de origen a destino de golpe.

Para vuelos largos (8h = 480min), la fracción salta `120/480 = 0.25` por tick.
El avión salta visualmente el 25% de la ruta cada segundo.

Esto no es un "desaparecen" sino un "saltan". Si el usuario lo describe como lag
puede estar describiendo este salto brusco en el tick previo al cambio de día
(cuando el avión salta a posición cercana al final de su ruta y luego desaparece
con el bug de Hipótesis A).

**Probabilidad:** Media. Es un síntoma de animación, no de desaparición, pero puede
confundirse con el síntoma principal en vuelos cortos.

---

## 4. Árbol de causas y efectos

```
Usuario ve: "aviones desaparecen y aparecen otros"
│
├─ Desaparecen (gap vacío) ← Hipótesis A (1440 filter bug) + latencia red
│                                                            
├─ Aparecen otros gradualmente ← Hipótesis B (día nuevo empieza en 00:00)
│
├─ Flash raro ocasional ← Hipótesis C (race condition polling vs step)
│
└─ Movimiento brusco antes de desaparecer ← Hipótesis D (animación por ticks)
```

---

## 5. Plan de verificación (antes de implementar)

Para confirmar cuál hipótesis está activa, agregar temporalmente estos logs
en `App.jsx` (NO son parte del fix, solo verificación):

```js
// En el useMemo de backendFlights:
const backendFlights = useMemo(() => {
  const result = activeVuelosWithTimes.filter(...)
  console.log(`[tick] clock=${simClockMinutes} visible=${result.length}`)
  return result
}, [...])
```

Si en la consola se ve:
- `clock=1320 visible=18` → `clock=1440 visible=2` → `clock=1440 visible=2` → `clock=0 visible=3`
  → **Hipótesis A confirmada** (salto de 18 a 2 en el tick de 1440)

- `clock=1440 visible=2` durante varios segundos antes de `clock=0`
  → **latencia de red visible**

- `clock=0 visible=3` → `clock=120 visible=7` → etc.
  → **Hipótesis B confirmada** (cielo se repuebla gradual)

---

## 6. Fixes propuestos

### Fix A — Tratar minuto 1440 como 1439 en `isActiveAtMinute` (1 línea)

**Archivo:** `src/App.jsx`

```js
function isActiveAtMinute(nowMin, depMin, arrMin) {
  if (depMin == null || arrMin == null) return false
  const m = nowMin >= 1440 ? 1439 : nowMin  // ← única línea nueva
  if (arrMin > depMin) {
    return m >= depMin && m < arrMin
  }
  return m >= depMin || m < arrMin
}
```

**Efecto:** Durante el tick fijo en 1440 (y la espera de red), los vuelos diurnos
permanecen visibles en su posición de las 23:59. El gap visual se elimina o
reduce a los segundos de latencia real del backend.

**Riesgo:** Mínimo. Solo cambia el comportamiento en `nowMin >= 1440`.

---

### Fix B — Compensar el overshoot al resetear el reloj

**Archivo:** `src/App.jsx`

En lugar de resetear el reloj a exactamente 0, compensar con el tiempo que pasó
entre que se disparó el step y cuando respondió:

```js
// Guardar el momento en que se disparó el step
const stepFiredAtRef = useRef(null)

useEffect(() => {
  if (!autoStep || simClockMinutes < 1440) return
  stepFiredAtRef.current = Date.now()
  let cancelled = false
  ;(async () => {
    const newState = await api.stepSimulation()
    if (cancelled || !newState) return
    const elapsed = Date.now() - stepFiredAtRef.current
    const overshootMinutes = Math.floor((elapsed / 1000) * SIM_MINUTES_PER_REAL_SECOND)
    setBackendState(newState)
    setSimClockMinutes(Math.min(overshootMinutes, 1439))  // nuevo día empieza donde corresponde
    ...
  })()
  return () => { cancelled = true }
}, [simClockMinutes, autoStep])
```

**Efecto:** Si el step tardó 3 segundos reales, el nuevo día empieza en el minuto
360 (06:00) en lugar de 0. Los vuelos matutinos ya son visibles. La transición
se siente continua.

**Riesgo:** Bajo. Si el cálculo del overshoot es impreciso, el día N+1 empieza
unos minutos antes/después de las 00:00, lo que es aceptable para una simulación visual.

---

### Fix C — Proteger `setBackendState` del polling contra el estado del step (guard)

**Archivo:** `src/App.jsx`

Introducir un ref que indique "step en progreso, ignorar polling":

```js
const stepInProgressRef = useRef(false)

// En startPolling:
if (state && (state.enEjecucion || state.finalizada)) {
  if (!stepInProgressRef.current) {   // ← guard
    setBackendState(state)
    ...
  }
}

// En el step effect:
stepInProgressRef.current = true
const newState = await api.stepSimulation()
stepInProgressRef.current = false
setBackendState(newState)
setSimClockMinutes(...)
```

**Efecto:** El polling no sobreescribe el resultado del step mientras este está
en vuelo.

**Riesgo:** Bajo. El único efecto secundario es que el polling no actualiza el
estado durante el segundo o dos que dura el step. Aceptable.

---

### Fix D — Animación suave entre ticks (interpolación en MapView)

**Archivo:** `src/components/MapView.jsx`

En lugar de usar `flight.fraction` directamente (que salta cada segundo), usar
una `lerp` animada entre la fracción anterior y la nueva a lo largo del segundo:

```js
// En FlightLayer:
const [animFractions, setAnimFractions] = useState({})
const prevFractionsRef = useRef({})

useEffect(() => {
  // Arrancar animación de interpolación para cada vuelo
  const start = Date.now()
  const animate = () => {
    const t = Math.min((Date.now() - start) / 1000, 1)
    const next = {}
    activeFlights.forEach(f => {
      const prev = prevFractionsRef.current[f.id] ?? f.fraction
      next[f.id] = prev + (f.fraction - prev) * t
    })
    setAnimFractions(next)
    if (t < 1) requestAnimationFrame(animate)
    else prevFractionsRef.current = Object.fromEntries(activeFlights.map(f => [f.id, f.fraction]))
  }
  requestAnimationFrame(animate)
}, [activeFlights])
```

**Efecto:** Los aviones se mueven suavemente durante el segundo entre ticks en
lugar de teleportar. Este fix es independiente de A/B/C.

**Riesgo:** Medio. Agrega estado de animación a MapView. Si `activeFlights` cambia
mientras la animación corre, hay que manejar el caso de vuelos que desaparecen
del array. También puede causar renders frecuentes vía `rAF`.

---

## 7. Prioridad recomendada de implementación

| Fix | Impacto | Esfuerzo | Prioridad |
|-----|---------|----------|-----------|
| A — Tratar 1440 como 1439 | Elimina el gap principal | 1 línea | **1° — implementar primero** |
| B — Compensar overshoot al resetear | Transición más fluida | ~10 líneas | **2° — después de validar A** |
| C — Guard polling vs step | Elimina race condition | ~5 líneas | **3° — si se confirma hipótesis C** |
| D — Interpolación suave | Movimiento continuo | ~30 líneas | **4° — mejora visual independiente** |

---

## 8. Lo que NO se va a cambiar

- La lógica del backend de overnight flights está correcta (verificado: `arrivalDateTime()` +
  matching por `LocalDate` en `processDepartures/Arrivals()`).
- El frontend ya maneja overnight flights correctamente (rama `||` en `isActiveAtMinute`
  y aritmética modular en `flightFractionAtMinute`).
- El schedule diario repetitivo del backend no se va a cambiar: los vuelos repiten
  cada día por diseño.
