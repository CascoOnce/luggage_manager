import React, { useEffect, useRef, useState } from 'react'
import { api } from '../services/api.js'

const s = {
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2000,
    display: 'flex', pointerEvents: 'none',
  },
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    background: 'transparent', border: 'none', cursor: 'default',
    pointerEvents: 'none',
  },
  panel: {
    position: 'absolute', left: 60, top: 10, bottom: 10, width: 340,
    background: 'rgba(22, 27, 34, 0.75)', backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: 16,
    display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden', zIndex: 2001,
    boxShadow: '4px 4px 24px rgba(0, 0, 0, 0.5)',
    pointerEvents: 'auto',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)',
    flexShrink: 0,
  },
  iata: {
    fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700,
    color: 'var(--text-bright)', letterSpacing: 1,
  },
  headerName: {
    fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--muted)',
    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  pill: (color) => ({
    fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: 0.8,
    padding: '3px 8px', borderRadius: 4,
    background: `${color}1f`, color, border: `1px solid ${color}66`,
    flexShrink: 0,
  }),
  closeBtn: {
    background: 'transparent', border: 'none',
    color: 'var(--muted)', cursor: 'pointer',
    fontFamily: 'var(--mono)', fontSize: 16, lineHeight: 1,
    padding: '2px 4px', flexShrink: 0,
  },
  section: { padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  sectionTitle: {
    fontFamily: 'var(--sans)', fontSize: 11, textTransform: 'uppercase',
    letterSpacing: 2, color: 'var(--muted)', fontWeight: 700,
    marginBottom: 10, display: 'block',
  },
  barTrack: {
    height: 4, background: 'rgba(255,255,255,0.07)',
    overflow: 'hidden', marginBottom: 6,
  },
  barFill: (pct, color) => ({
    height: '100%', width: `${Math.min(100, pct)}%`,
    background: color, transition: 'width 0.4s ease',
  }),
  barLabel: {
    display: 'flex', justifyContent: 'space-between',
    fontFamily: 'var(--mono)', fontSize: 12,
  },
  row: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'baseline', marginBottom: 7, gap: 8,
  },
  rowLabel: { fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)', flexShrink: 0 },
  rowVal: { fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-bright)', textAlign: 'right' },
  flightItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 0', borderBottom: '1px solid rgba(99,152,255,0.07)',
  },
  dot: (color) => ({
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
    background: color, boxShadow: `0 0 5px ${color}`,
  }),
  flightCode: { fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--text-bright)', flex: 1 },
  flightMeta: { fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' },
  stat: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '10px 0',
  },
  statVal: { fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 600, color: 'var(--text-bright)' },
  statLabel: { fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 3 },
  maletasPopupOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2010,
  },
  maletasPopup: {
    position: 'absolute', right: 12, width: 200, maxHeight: 200,
    background: 'rgba(22, 27, 34, 0.98)', backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  maletasPopupHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
    padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)',
    fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--text-bright)',
    whiteSpace: 'nowrap',
  },
  maletasPopupList: { overflowY: 'auto', padding: '4px 6px' },
  maletasPopupItem: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', padding: '5px 6px',
    borderRadius: 6,
  },
}

// Thresholds match the map/side-panel semaforo (App.jsx `threshold` slider, default
// 80 → umbralVerde=60/umbralRojo=80) or the fixed 60/85 scheme used where there's no slider.
function semaforoColor(pct, umbralVerde, umbralRojo) {
  if (pct === 0) return 'var(--blue)'
  if (pct >= umbralRojo) return 'var(--red)'
  if (pct >= umbralVerde) return 'var(--amber)'
  return 'var(--green)'
}

function semaforoLabel(pct, umbralVerde, umbralRojo) {
  if (pct === 0) return 'VACÍO'
  if (pct >= umbralRojo) return 'CRÍTICO'
  if (pct >= umbralVerde) return 'ALTO'
  return 'NORMAL'
}

function flightColor(load, cap) {
  const p = cap > 0 ? (load / cap) * 100 : 0
  if (p >= 90) return 'var(--red)'
  if (p >= 70) return 'var(--amber)'
  return 'var(--green)'
}

const sumarMaletas = (lista) => {
  if (!lista || lista.length === 0) return 0;
  return lista.reduce((total, e) => total + (e.cantidadMaletas || 0), 0);
}

const pad2 = (n) => String(n).padStart(2, '0')

// Clasifica envíos en almacén según el rol del aeropuerto actual en su ruta.
function agruparPorRol(lista, iata) {
  const salida = [], llegada = [], escala = []
  for (const e of lista || []) {
    if (e.aeropuertoOrigen === iata) salida.push(e)
    else if (e.aeropuertoDestino === iata) llegada.push(e)
    else escala.push(e)
  }
  return { salida, llegada, escala }
}

const TAB_STYLE = (active) => ({
  fontFamily: 'var(--mono)', fontSize: 12, textTransform: 'uppercase',
  letterSpacing: 1.2, padding: '8px 12px', cursor: 'pointer',
  background: 'transparent', border: 'none', outline: 'none',
  borderBottom: active ? '2px solid var(--blue)' : '2px solid transparent',
  color: active ? 'var(--text-bright)' : 'var(--muted)',
})

function EnvioRow({ e, singleLine, onClick }) {
  if (singleLine) {
    return (
      <div
        onClick={onClick}
        style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', gap: 8, cursor: onClick ? 'pointer' : 'default' }}
      >
        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--blue)', flexShrink: 0 }}>
          {e.idEnvio}
        </span>
        
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {e.aeropuertoOrigen} → {e.aeropuertoDestino}
          {e.codigoVuelo && <span style={{ color: 'var(--text)' }}> · {e.codigoVuelo}</span>}
        </span>

        {e.hora && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--amber)', flexShrink: 0, textAlign: 'right' }}>
            {e.hora}
          </span>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>
          {pad2(e.cantidadMaletas)} 🧳
        </div>

        {e.sla != null && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>
            SLA {e.sla}d
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      onClick={onClick}
      style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: onClick ? 'pointer' : 'default' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--blue)' }}>{e.idEnvio}</span>
        {(e.fecha || e.hora) && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--amber)', display: 'flex', alignItems: 'baseline', gap: 4 }}>
            {e.fecha && <span style={{ color: 'var(--muted)' }}>{e.fecha.includes('-') ? e.fecha.split('-').slice(1).reverse().join('/') : e.fecha}</span>}
            <span>{e.hora}</span>
            <span style={{ fontSize: 9, color: 'var(--muted)', padding: '0 3px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3 }}>UTC</span>
          </span>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
          {e.codigoVuelo ? (
            <span style={{ color: 'var(--text-bright)' }}>✈️ {e.codigoVuelo.replace(/-\d{2}:\d{2}$/, '')}</span>
          ) : (
            <span style={{ opacity: 0.5 }}>Sin vuelo</span>
          )}
          {e.sla != null && (
            <span style={{ fontSize: 10, padding: '1px 4px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3 }}>
              SLA {e.sla}d
            </span>
          )}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-bright)' }}>
          {pad2(e.cantidadMaletas)} 🧳
        </div>
      </div>
    </div>
  )
}

// Extract HH:MM from a time string (LocalTime "HH:MM[:SS]" or ISO "…THH:MM…").
function hhmm(t) {
  if (!t) return ''
  const s = String(t)
  const part = s.includes('T') ? (s.split('T')[1] || '') : s
  return part.slice(0, 5)
}

// UTC HH:MM + huso → local HH:MM. Flight times in the DTO are UTC (see backend
// DataLoaderService: horaSalida = stored local − huso). LCL = UTC + huso.
function addHuso(hhmmStr, huso) {
  if (!hhmmStr || huso == null) return ''
  const [hh, mm] = hhmmStr.split(':').map(Number)
  const localH = (((hh + huso) % 24) + 24) % 24
  return `${String(localH).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// Sim clock runs in UTC; each airport displays its own local wall time (UTC + huso).
function localTimeLabel(huso, nowMinuteUtc) {
  if (huso == null || nowMinuteUtc == null) return null
  const localMin = ((Math.floor(nowMinuteUtc) + huso * 60) % 1440 + 1440) % 1440
  const hh = String(Math.floor(localMin / 60)).padStart(2, '0')
  const mm = String(localMin % 60).padStart(2, '0')
  const sign = huso >= 0 ? '+' : '-'
  return `${hh}:${mm} LCL · UTC${sign}${Math.abs(huso)}`
}

export default function DrawerAeropuerto({ airport, vuelos, onClose, hideInventoryTabs = false, nowMinuteUtc = null, fetchInventory = api.getAirportInventory, umbralVerde = 60, umbralRojo = 85 }) {
  const [tab, setTab] = useState('info')
  const [inventory, setInventory] = useState(null)
  const [loadingInv, setLoadingInv] = useState(false)
  const [maletasPopup, setMaletasPopup] = useState(null) // { idEnvio, cantidadMaletas, top } | null
  const [vueloPopup, setVueloPopup] = useState(null)     // { codigoVuelo, fecha, hora, envios, top } | null
  const panelRef = useRef(null)
  
  const [expandedIn, setExpandedIn] = useState(true)
  const [expandedOut, setExpandedOut] = useState(true)
  const [expandedNoRoute, setExpandedNoRoute] = useState(true)

  const [expandedSalida, setExpandedSalida] = useState(true)
  const [expandedLlegada, setExpandedLlegada] = useState(true)
  const [expandedEscala, setExpandedEscala] = useState(true)

  // Key on airport.id, not the object: App re-derives a fresh airport object every clock tick
  // (live occupancy), and keying on identity would reset the tab/inventory on every frame.
  useEffect(() => {
    if (!airport) return
    setTab('info')
    setInventory(null)
    setMaletasPopup(null)
    setVueloPopup(null)
  }, [airport?.id])

  useEffect(() => {
    if (!airport) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [airport?.id, onClose])

  // Refetch on tab open and each time the sim clock crosses a 15-sim-min boundary, so
  // "Inventario" tracks who's physically in the warehouse now without a server call per tick.
  // (120 was too coarse: at ~4 sim-min/real-sec it only refetched every ~30s.)
  const invWindow = nowMinuteUtc != null ? Math.floor(nowMinuteUtc / 15) : null
  useEffect(() => {
    if (!airport || tab === 'info') return
    setLoadingInv(true)
    fetchInventory(airport.id, nowMinuteUtc)
      .then(setInventory)
      .catch(() => setInventory(null))
      .finally(() => setLoadingInv(false))
  }, [airport?.id, tab, invWindow])

  if (!airport) return null

  const occ = airport.currentOccupation ?? airport.ocupacionActual ?? 0
  const cap = airport.warehouseCapacity ?? airport.capacidadAlmacen ?? 600
  const pct = cap > 0 ? (occ / cap) * 100 : 0
  // Show "<0.01%" when there are bags but rounding drops it to 0
  const pctLabel = pct > 0 && pct < 0.01 ? '<0.01%' : `${pct.toFixed(2)}%`
  const color = semaforoColor(pct, umbralVerde, umbralRojo)

  const iata = airport.id
  // Tablero: próximos 6 a SALIR/LLEGAR desde "ahora" (UTC), ordenados por proximidad.
  // nowMinuteUtc = reloj de sim (UTC) o hora real UTC en ops. Comparar en UTC da el mismo
  // resultado que comparar en local del aeropuerto (mismo instante).
  const nowMin = nowMinuteUtc != null ? (((Math.floor(nowMinuteUtc) % 1440) + 1440) % 1440) : 0
  const toMin = (t) => { const s = hhmm(t); if (!s) return null; const [h, m] = s.split(':').map(Number); return h * 60 + m }
  const waitFrom = (t) => { const mm = toMin(t); return mm == null ? Infinity : (mm - nowMin + 1440) % 1440 }
  const salidas = (vuelos || []).filter((v) => (v.origin || v.origen) === iata)
    .sort((a, b) => waitFrom(a.horaSalida) - waitFrom(b.horaSalida)).slice(0, 6)
  const llegadas = (vuelos || []).filter((v) => (v.destination || v.destino) === iata)
    .sort((a, b) => waitFrom(a.horaLlegada) - waitFrom(b.horaLlegada)).slice(0, 6)

  return (
    <div style={s.overlay}>
      <button aria-label="Cerrar" style={s.backdrop} onClick={onClose} />
      <aside style={s.panel} ref={panelRef}>

        {/* Header */}
        <div style={s.header}>
          <span style={s.iata}>{airport.id}</span>
          {localTimeLabel(airport.huso, nowMinuteUtc) && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>
              {localTimeLabel(airport.huso, nowMinuteUtc)}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <span style={s.pill(color)}>{semaforoLabel(pct, umbralVerde, umbralRojo)}</span>
          <button style={s.closeBtn} onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <button style={TAB_STYLE(tab === 'info')} onClick={() => { setTab('info'); setMaletasPopup(null); setVueloPopup(null); }}>Info</button>
          {!hideInventoryTabs && <button style={TAB_STYLE(tab === 'inventario')} onClick={() => { setTab('inventario'); setMaletasPopup(null); setVueloPopup(null); }}>Inventario</button>}
          {!hideInventoryTabs && <button style={TAB_STYLE(tab === 'planificado')} onClick={() => { setTab('planificado'); setMaletasPopup(null); setVueloPopup(null); }}>Planificado</button>}
        </div>

        {tab === 'inventario' && (() => {
          const { salida, llegada, escala } = agruparPorRol(inventory?.enAlmacen, iata)
          const rowClick = (e) => (ev) => {
            const panel = panelRef.current
            if (!panel) return
            const panelRect = panel.getBoundingClientRect()
            const itemRect = ev.currentTarget.getBoundingClientRect()
            const sectionNode = ev.currentTarget.closest('.seccion-container')
            
            // top relative to panel (accounting for scroll)
            let topPos = itemRect.top - panelRect.top + panel.scrollTop
            
            if (sectionNode) {
              const sr = sectionNode.getBoundingClientRect()
              const sTop = sr.top - panelRect.top + panel.scrollTop
              const sBottom = sr.bottom - panelRect.top + panel.scrollTop
              const estimatedHeight = Math.min(220, 45 + ((e.cantidadMaletas || 0) * 26))
              if (topPos + estimatedHeight > sBottom) topPos = sBottom - estimatedHeight
              if (topPos < sTop) topPos = sTop
            }
            setMaletasPopup((p) => (p?.idEnvio === e.idEnvio ? null : { idEnvio: e.idEnvio, cantidadMaletas: e.cantidadMaletas || 0, top: topPos, fecha: e.fecha, hora: e.hora }))
          }
          const seccion = (title, color, lista, expanded, setExpanded, borderTop) => (
            <div className="seccion-container" style={{ display: 'flex', flexDirection: 'column', flex: expanded ? 1 : 'none', minHeight: 0 }}>
              <div
                onClick={() => setExpanded(!expanded)}
                style={{
                  padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer', background: 'rgba(255,255,255,0.03)',
                  borderTop: borderTop ? '1px solid var(--border)' : 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <span style={{ ...s.sectionTitle, color, marginBottom: 0 }}>
                  {title}: {lista.length} envíos ({sumarMaletas(lista)} maletas)
                </span>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
              </div>
              {expanded && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
                  {lista.length === 0
                    ? <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', padding: '10px 0' }}>Sin envíos</div>
                    : lista.map((e, i) => <EnvioRow key={`${e.idEnvio}-${i}`} e={e} singleLine onClick={rowClick(e)} />)
                  }
                </div>
              )}
            </div>
          )
          return (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', position: 'relative' }}>
              {loadingInv && <div style={{ padding: '14px 16px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>Cargando...</div>}
              {!loadingInv && !inventory && (
                <div style={{ padding: '14px 16px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', opacity: 0.6 }}>
                  Sin datos — simulación no activa
                </div>
              )}
              {!loadingInv && inventory && (
                <>
                  {seccion('Saliendo (origen)', 'var(--text-bright)', salida, expandedSalida, setExpandedSalida, false)}
                  {seccion('Llegando (destino)', 'var(--text-bright)', llegada, expandedLlegada, setExpandedLlegada, true)}
                  {seccion('En escala', 'var(--text-bright)', escala, expandedEscala, setExpandedEscala, true)}
                </>
              )}
            </div>
          )
        })()}


        {tab === 'planificado' && (() => {
          // Helper: compute local datetime string from UTC fecha+hora and airport huso
          const toLocal = (fecha, hora) => {
            if (!fecha || !hora || airport.huso == null) return null
            const [yyyy, mm, dd] = fecha.split('-')
            const [hh, min] = hora.split(':')
            const d = new Date(Date.UTC(yyyy, mm - 1, dd, hh, min))
            d.setUTCHours(d.getUTCHours() + airport.huso)
            const lH = String(d.getUTCHours()).padStart(2, '0')
            const lMin = String(d.getUTCMinutes()).padStart(2, '0')
            const lD = String(d.getUTCDate()).padStart(2, '0')
            const lM = String(d.getUTCMonth() + 1).padStart(2, '0')
            const lY = d.getUTCFullYear()
            return { hora: `${lH}:${lMin}`, fecha: `${lY}-${lM}-${lD}` }
          }

          // Group a list of envíos by codigoVuelo
          const groupByVuelo = (lista) => {
            const map = new Map()
            for (const e of (lista || [])) {
              const key = e.codigoVuelo || '__sin_vuelo__'
              if (!map.has(key)) map.set(key, { envios: [], hora: e.hora, fecha: e.fecha })
              map.get(key).envios.push(e)
            }
            return Array.from(map.entries()).map(([cod, v]) => ({ codigoVuelo: cod, ...v, totalMaletas: sumarMaletas(v.envios) }))
          }

          const fmtFecha = (f) => f && f.includes('-') ? f.split('-').slice(1).reverse().join('/') + '/' + f.split('-')[0].slice(2) : f

          const onVueloClick = (grupo) => (ev) => {
            const panel = panelRef.current
            if (!panel) return
            const panelRect = panel.getBoundingClientRect()
            const itemRect = ev.currentTarget.getBoundingClientRect()
            const sectionNode = ev.currentTarget.closest('.seccion-container')

            let topPos = itemRect.top - panelRect.top + panel.scrollTop

            if (sectionNode) {
              const sr = sectionNode.getBoundingClientRect()
              const sTop = sr.top - panelRect.top + panel.scrollTop
              const sBottom = sr.bottom - panelRect.top + panel.scrollTop
              const estimatedH = Math.min(280, 70 + grupo.envios.length * 32)
              if (topPos + estimatedH > sBottom) topPos = sBottom - estimatedH
              if (topPos < sTop) topPos = sTop
            }
            setVueloPopup((p) => p?.codigoVuelo === grupo.codigoVuelo ? null : { ...grupo, top: topPos })
            setMaletasPopup(null)
          }

          const onEnvioClick = (e) => (ev) => {
            const panel = panelRef.current
            if (!panel) return
            const panelRect = panel.getBoundingClientRect()
            const itemRect = ev.currentTarget.getBoundingClientRect()
            let topPos = itemRect.top - panelRect.top + panel.scrollTop
            const estimatedH = Math.min(220, 45 + (e.cantidadMaletas || 0) * 26)
            if (topPos + estimatedH > panelRef.current.scrollHeight - 20) topPos -= estimatedH
            setMaletasPopup((p) => p?.idEnvio === e.idEnvio ? null : { idEnvio: e.idEnvio, cantidadMaletas: e.cantidadMaletas || 0, top: topPos, fecha: e.fecha, hora: e.hora })
          }

          const renderVueloList = (grupos, emptyMsg) => (
            grupos.length === 0
              ? <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', padding: '10px 0' }}>{emptyMsg}</div>
              : grupos.map((g) => {
                  const local = toLocal(g.fecha, g.hora)
                  const isActive = vueloPopup?.codigoVuelo === g.codigoVuelo
                  return (
                    <div
                      key={g.codigoVuelo}
                      onClick={onVueloClick(g)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0',
                        borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer',
                        background: isActive ? 'rgba(99,152,255,0.06)' : 'transparent',
                        borderRadius: isActive ? 4 : 0,
                      }}
                    >
                      <span style={{ fontSize: 12 }}>✈️</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-bright)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {g.codigoVuelo === '__sin_vuelo__' ? 'Sin vuelo' : g.codigoVuelo.replace(/-\d{2}:\d{2}$/, '')}
                      </span>
                      {g.hora && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--amber)', flexShrink: 0 }}>{g.hora}</span>}
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', padding: '0 3px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3, flexShrink: 0 }}>UTC</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>· {pad2(g.totalMaletas)} 🧳</span>
                    </div>
                  )
                })
          )

          const gruposEntrando = groupByVuelo(inventory?.planificadosEntrando)
          const gruposSaliendo = groupByVuelo(inventory?.planificadosSaliendo)

          return (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', position: 'relative' }}>
              {loadingInv && <div style={{ padding: '14px 16px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>Cargando...</div>}
              {!loadingInv && !inventory && (
                <div style={{ padding: '14px 16px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', opacity: 0.6 }}>
                  Sin datos — simulación no activa
                </div>
              )}
              {!loadingInv && inventory && (
                <>
                  {/* ENTRADAS */}
                  <div className="seccion-container" style={{ display: 'flex', flexDirection: 'column', flex: expandedIn ? 1 : 'none', minHeight: 0 }}>
                    <div
                      onClick={() => setExpandedIn(!expandedIn)}
                      style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                    >
                      <span style={{ ...s.sectionTitle, color: 'var(--text-bright)', marginBottom: 0 }}>
                        Por entrar hoy: {gruposEntrando.length} vuelos ({sumarMaletas(inventory.planificadosEntrando)} maletas)
                      </span>
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>{expandedIn ? '▲' : '▼'}</span>
                    </div>
                    {expandedIn && (
                      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
                        {renderVueloList(gruposEntrando, 'Sin llegadas planificadas')}
                      </div>
                    )}
                  </div>

                  {/* SALIDAS */}
                  <div className="seccion-container" style={{ display: 'flex', flexDirection: 'column', flex: expandedOut ? 1 : 'none', minHeight: 0 }}>
                    <div
                      onClick={() => setExpandedOut(!expandedOut)}
                      style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: 'rgba(255,255,255,0.03)', borderTop: '1px solid var(--border)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                    >
                      <span style={{ ...s.sectionTitle, color: 'var(--text-bright)', marginBottom: 0 }}>
                        Por salir hoy: {gruposSaliendo.length} vuelos ({sumarMaletas(inventory.planificadosSaliendo)} maletas)
                      </span>
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>{expandedOut ? '▲' : '▼'}</span>
                    </div>
                    {expandedOut && (
                      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
                        {renderVueloList(gruposSaliendo, 'Sin salidas planificadas')}
                      </div>
                    )}
                  </div>

                </>
              )}
            </div>
          )
        })()}

        {tab === 'info' && <>
        {/* Occupancy */}
        <div style={s.section}>
          <span style={s.sectionTitle}>Ocupación de almacén</span>
          <div style={s.barTrack}>
            <div style={s.barFill(pct, color)} />
          </div>
          <div style={s.barLabel}>
            <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>
              {occ.toLocaleString()} / {cap.toLocaleString()} maletas
            </span>
            <span style={{ color, fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700 }}>{pctLabel}</span>
          </div>
        </div>

        {/* Info General */}
        <div style={s.section}>
          <span style={s.sectionTitle}>Info general</span>
          <div style={s.row}>
            <span style={s.rowLabel}>Nombre</span>
            <span style={s.rowVal}>{airport.name || airport.nombre || '—'}</span>
          </div>
          <div style={s.row}>
            <span style={s.rowLabel}>Ciudad</span>
            <span style={s.rowVal}>{airport.ciudad || '—'}</span>
          </div>
          <div style={s.row}>
            <span style={s.rowLabel}>Continente</span>
            <span style={s.rowVal}>{airport.continent || airport.continente || '—'}</span>
          </div>
          <div style={s.row}>
            <span style={s.rowLabel}>Coords</span>
            <span style={s.rowVal}>
              {airport.lat != null ? `${airport.lat.toFixed(3)}, ${airport.lng.toFixed(3)}` : '—'}
            </span>
          </div>
        </div>

        {/* Salidas / Llegadas */}
        <div style={{ ...s.section, flex: 1, overflowY: 'auto' }}>
          {/* Salidas */}
          <div style={{ marginBottom: 12 }}>
            <span style={{ ...s.sectionTitle, color: 'var(--blue)' }}>Salidas ↑ ({salidas.length})</span>
            {salidas.length === 0 ? (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>Sin salidas</span>
            ) : salidas.map((v, i) => {
              const code = v.id || v.codigoVuelo || `FL-${i}`
              const load = v.maletasAsignadas ?? v.currentLoad ?? v.cargaActual ?? 0
              const vcap = v.capacity ?? v.capacidadTotal ?? 300
              const c = flightColor(load, vcap)
              
              let displayCode = code.replace(`${iata}-`, '')
              if (/\d{2}:\d{2}$/.test(displayCode)) displayCode = displayCode.slice(0, -6)
              // Hora de SALIDA (UTC) desde el campo, no del sufijo del código (que es local).
              const flightTime   = hhmm(v.horaSalida)
              const localTimeStr = addHuso(flightTime, airport.huso)

              return (
                <div key={`s-${code}`} style={{ ...s.flightItem, justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={s.dot(c)} />
                    <span style={s.flightCode}>{displayCode}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {flightTime && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {flightTime} <span style={{ fontSize: 9, color: 'var(--muted)', padding: '0 3px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3 }}>UTC</span>
                        </span>
                        {localTimeStr && (
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-bright)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {localTimeStr} <span style={{ fontSize: 9, color: 'var(--blue)', padding: '0 3px', border: '1px solid rgba(99,152,255,0.2)', borderRadius: 3, background: 'rgba(99,152,255,0.1)' }}>LCL</span>
                          </span>
                        )}
                      </div>
                    )}
                    <span style={{ ...s.flightMeta, color: c, width: 45, textAlign: 'right' }}>{((load / vcap) * 100).toFixed(0)}%</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Llegadas */}
          <div>
            <span style={{ ...s.sectionTitle, color: 'var(--blue)' }}>Llegadas ↓ ({llegadas.length})</span>
            {llegadas.length === 0 ? (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>Sin llegadas</span>
            ) : llegadas.map((v, i) => {
              const code = v.id || v.codigoVuelo || `FL-${i}`
              const load = v.maletasAsignadas ?? v.currentLoad ?? v.cargaActual ?? 0
              const vcap = v.capacity ?? v.capacidadTotal ?? 300
              const c = flightColor(load, vcap)
              
              let displayCode = code.replace(`-${iata}`, '')
              if (/\d{2}:\d{2}$/.test(displayCode)) displayCode = displayCode.slice(0, -6)
              // Hora de LLEGADA (UTC) desde el campo. El sufijo del código es la hora de
              // salida, no de llegada — usarlo aquí mostraba la hora equivocada.
              const flightTime   = hhmm(v.horaLlegada)
              const localTimeStr = addHuso(flightTime, airport.huso)

              return (
                <div key={`l-${code}`} style={{ ...s.flightItem, justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={s.dot(c)} />
                    <span style={s.flightCode}>{displayCode}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {flightTime && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {flightTime} <span style={{ fontSize: 9, color: 'var(--muted)', padding: '0 3px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3 }}>UTC</span>
                        </span>
                        {localTimeStr && (
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-bright)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {localTimeStr} <span style={{ fontSize: 9, color: 'var(--blue)', padding: '0 3px', border: '1px solid rgba(99,152,255,0.2)', borderRadius: 3, background: 'rgba(99,152,255,0.1)' }}>LCL</span>
                          </span>
                        )}
                      </div>
                    )}
                    <span style={{ ...s.flightMeta, color: c, width: 45, textAlign: 'right' }}>{((load / vcap) * 100).toFixed(0)}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Stats */}
        <div style={{ ...s.section, display: 'flex', borderBottom: 'none' }}>
          <div style={s.stat}>
            <span style={s.statVal}>{occ.toLocaleString()}</span>
            <span style={s.statLabel}>Maletas</span>
          </div>
          <div style={{ width: 1, background: 'var(--border)', margin: '8px 0' }} />
          <div style={s.stat}>
            <span style={s.statVal}>{cap.toLocaleString()}</span>
            <span style={s.statLabel}>Capacidad</span>
          </div>
          <div style={{ width: 1, background: 'var(--border)', margin: '8px 0' }} />
          <div style={s.stat}>
            <span style={{ ...s.statVal, color }}>{pctLabel}</span>
            <span style={s.statLabel}>Ocupación</span>
          </div>
        </div>
        </>}

        {/* VUELO POPUP (nivel 1) */}
        {vueloPopup && (
          <div style={s.maletasPopupOverlay} onClick={() => { setVueloPopup(null); setMaletasPopup(null) }}>
            <div
              style={{ ...s.maletasPopup, top: vueloPopup.top ?? 60, width: 240, maxHeight: 280 }}
              onClick={(ev) => ev.stopPropagation()}
            >
              <div style={s.maletasPopupHeader}>
                <span style={{ color: 'var(--blue)' }}>✈️ {vueloPopup.codigoVuelo === '__sin_vuelo__' ? 'Sin vuelo' : vueloPopup.codigoVuelo.replace(/-\d{2}:\d{2}$/, '')}</span>
                <button style={s.closeBtn} onClick={() => { setVueloPopup(null); setMaletasPopup(null) }} aria-label="Cerrar">✕</button>
              </div>
              {(vueloPopup.fecha || vueloPopup.hora) && (() => {
                let local = null;
                if (vueloPopup.fecha && vueloPopup.hora && airport.huso != null) {
                  const [yyyy, mm, dd] = vueloPopup.fecha.split('-')
                  const [hh, min] = vueloPopup.hora.split(':')
                  const d = new Date(Date.UTC(yyyy, mm - 1, dd, hh, min))
                  d.setUTCHours(d.getUTCHours() + airport.huso)
                  local = {
                    hora: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
                    fecha: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
                  }
                }
                return (
                  <div style={{ padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--amber)' }}>
                      <span style={{ color: 'var(--muted)' }}>⏱</span>
                      {vueloPopup.fecha && <span style={{ color: 'var(--muted)' }}>{vueloPopup.fecha}</span>}
                      {vueloPopup.hora && <span>{vueloPopup.hora}</span>}
                      <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--muted)', padding: '0 3px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3 }}>UTC</span>
                    </div>
                    {local && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--text-bright)' }}>
                        <span style={{ color: 'transparent' }}>⏱</span>
                        <span style={{ color: 'var(--muted)' }}>{local.fecha}</span>
                        <span>{local.hora}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--blue)', padding: '0 3px', border: '1px solid rgba(99,152,255,0.2)', borderRadius: 3, background: 'rgba(99,152,255,0.1)' }}>LCL</span>
                      </div>
                    )}
                    <div style={{ color: 'var(--muted)', marginTop: 2 }}>{vueloPopup.envios.length} envíos · {pad2(vueloPopup.totalMaletas)} 🧳</div>
                  </div>
                )
              })()}
              <div style={s.maletasPopupList}>
                {vueloPopup.envios.map((e, i) => (
                  <div
                    key={`vp-${e.idEnvio}-${i}`}
                    onClick={(ev) => {
                      const panel = panelRef.current
                      if (!panel) return
                      const panelRect = panel.getBoundingClientRect()
                      const itemRect = ev.currentTarget.getBoundingClientRect()
                      let topPos = itemRect.top - panelRect.top + panel.scrollTop
                      const estimatedH = Math.min(220, 45 + (e.cantidadMaletas || 0) * 26)
                      if (topPos + estimatedH > panel.scrollHeight - 20) topPos -= estimatedH
                      setMaletasPopup((p) => p?.idEnvio === e.idEnvio ? null : { idEnvio: e.idEnvio, cantidadMaletas: e.cantidadMaletas || 0, top: topPos, fecha: e.fecha, hora: e.hora, hideTime: true })
                    }}
                    style={{
                      ...s.maletasPopupItem,
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      background: maletasPopup?.idEnvio === e.idEnvio ? 'rgba(99,152,255,0.1)' : 'transparent',
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ color: 'var(--blue)', fontSize: 12 }}>{e.idEnvio}</span>
                    <span style={{ color: 'var(--text-bright)', fontSize: 12 }}>{pad2(e.cantidadMaletas)} 🧳</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {maletasPopup && (
          <div style={s.maletasPopupOverlay} onClick={() => setMaletasPopup(null)}>
            <div style={{ ...s.maletasPopup, top: maletasPopup.top ?? 60 }} onClick={(ev) => ev.stopPropagation()}>
              <div style={s.maletasPopupHeader}>
                <span style={{ color: 'var(--blue)' }}>{maletasPopup.idEnvio}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  🧳 {pad2(maletasPopup.cantidadMaletas)}
                </span>
                <button style={s.closeBtn} onClick={() => setMaletasPopup(null)} aria-label="Cerrar">✕</button>
              </div>
              {(!maletasPopup.hideTime && (maletasPopup.fecha || maletasPopup.hora)) && (() => {
                let localDatetime = null;
                if (maletasPopup.fecha && maletasPopup.hora && airport.huso != null) {
                  const [yyyy, mm, dd] = maletasPopup.fecha.split('-');
                  const [hh, min] = maletasPopup.hora.split(':');
                  const d = new Date(Date.UTC(yyyy, mm - 1, dd, hh, min));
                  d.setUTCHours(d.getUTCHours() + airport.huso);
                  const lY = d.getUTCFullYear();
                  const lM = String(d.getUTCMonth() + 1).padStart(2, '0');
                  const lD = String(d.getUTCDate()).padStart(2, '0');
                  const lH = String(d.getUTCHours()).padStart(2, '0');
                  const lMin = String(d.getUTCMinutes()).padStart(2, '0');
                  localDatetime = `${lY}-${lM}-${lD} ${lH}:${lMin}`;
                }
                return (
                  <div style={{
                    padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--amber)',
                    borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 4
                  }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ color: 'var(--muted)' }}>⏱</span>
                      {maletasPopup.fecha && <span>{maletasPopup.fecha}</span>}
                      {maletasPopup.hora && <span>{maletasPopup.hora}</span>}
                      <span style={{ color: 'var(--muted)', fontSize: 10, marginLeft: 'auto', border: '1px solid rgba(255,255,255,0.1)', padding: '0 4px', borderRadius: 3 }}>UTC</span>
                    </div>
                    {localDatetime && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--text-bright)' }}>
                        <span style={{ color: 'transparent' }}>⏱</span>
                        <span>{localDatetime.split(' ')[0]}</span>
                        <span>{localDatetime.split(' ')[1]}</span>
                        <span style={{ color: 'var(--blue)', fontSize: 10, marginLeft: 'auto', border: '1px solid rgba(99,152,255,0.2)', padding: '0 4px', borderRadius: 3, background: 'rgba(99,152,255,0.1)' }}>LCL</span>
                      </div>
                    )}
                  </div>
                )
              })()}
              <div style={s.maletasPopupList}>
                {Array.from({ length: maletasPopup.cantidadMaletas }, (_, i) => (
                  <div key={i} style={s.maletasPopupItem}>
                    <span style={{ color: 'var(--blue)', fontSize: 18, lineHeight: 1 }}>•</span>
                    <span>{maletasPopup.idEnvio}-{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </aside>

    </div>
  )
}
