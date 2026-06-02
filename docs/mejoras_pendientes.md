# Mejoras Pendientes — TASF.B2B Luggage Manager

**Actualizado:** 2026-06-01 | **Branch:** main

> M01, M04, M05 completados — ver `RESUMEN_IMPLEMENTACION.md`.  
> Excluye stand-by: F-11, F-12, F-15, B-04, B-07.  
> Excluye externos: RNF-4/5/6/7, B-83/84/85/86.

---

## M-02 · Animación progresiva de ocupación de almacenes

### Problema
`ocupacionActual` se actualiza al inicio de cada día simulado. Durante los ~12 segundos reales que dura cada día, los íconos del mapa y los paneles permanecen fijos hasta el siguiente `POST /step`. Visualmente produce saltos discretos en lugar de movimiento fluido.

### Comportamiento esperado
La barra de ocupación y el color del semáforo de cada aeropuerto se actualizan continuamente interpolando entre el valor del inicio del día y una estimación del fin del día, usando el progreso de `simClockMinutes` (0–1440) como factor.

### Implementación
- `App.jsx`: mantener un `prevAirports` ref (snapshot del día anterior) actualizado en cada `POST /step`.
- `normalizedAirports` memo: interpolar `ocupacionActual` entre `prevAirports[iata]` y `currentOccupation[iata]` según `simClockMinutes / 1440`.
- Sin cambios de backend.

### Archivos involucrados
| Archivo | Cambio |
|---------|--------|
| `src/App.jsx` | `prevAirports` ref, actualizar en cada step, interpolar en `normalizedAirports` |

---

## M-03 · Mejoras en gestión de archivos de envíos (ConfigScreen)

### Problema
1. Sin retroalimentación visual de archivos seleccionados antes de subir.
2. No es posible eliminar un archivo individual de la selección.
3. Sin indicador de progreso durante carga multi-archivo.
4. Validación de extensión `.txt` no es robusta (solo regex de nombre).

### Mejoras propuestas

#### 3a. Lista de archivos con delete individual
Mostrar lista pre-subida con nombre, badge `.txt`, ícono de estado y botón `×` por archivo. La lista persiste hasta iniciar la subida.

#### 3b. Barra de progreso durante upload
Estado `uploadProgress: { current, total, currentFile }`. Renderizar barra que avanza archivo por archivo durante `handleUpload()`.

#### 3c. Validación explícita `.txt`
```js
const notTxt = files.find(f => !f.name.toLowerCase().endsWith('.txt'))
if (notTxt) { setUploadFileError('Solo se aceptan archivos .txt'); return }
```
Complementa el `accept=".txt"` del input (no enforced por todos los navegadores).

### Archivos involucrados
| Archivo | Cambio |
|---------|--------|
| `src/screens/ConfigScreen.jsx` | Lista pre-subida con delete, estado `uploadProgress`, validación `.txt` explícita |

---

## Stand-by

> Implementación bloqueada por decisión de alcance. No priorizar hasta nuevo aviso.

| ID | Criterio(s) | Descripción | Bloqueado por |
|----|-------------|-------------|---------------|
| **X-04** | B-30, B-31 | Toggle para mostrar todas las rutas simultáneamente en mapa | Impacto de rendimiento con muchos vuelos activos; requiere diseño de throttling |
| **X-07** | B-77 | Rango horario de cancelación/mantenimiento de vuelo | Backend debe guardar `fechaHoraCancelacion` en `VueloEntity`; scope no trivial |
| **X-08** | B-64 | Tabla estructurada de vuelos cancelados | Depende de datos estructurados de cancelación (F-11/B-04 stand-by) |

---

## Externos (no código — gestión)

| Criterio | Acción |
|----------|--------|
| RNF-4 | Coordinar con lab PUCP para verificar despliegue en su infraestructura |
| RNF-5 | Preparar evidencia VSE: actas de reunión, historial tareas, commits |
| RNF-6, RNF-7 | Grabar videos de los 3 escenarios (30–90 min) |
| B-85 | Video de simulación semanal completa |
