import React, { useMemo, useRef, useState, useEffect } from 'react'
import { api, startSimulation } from '../services/api.js'
import AirportFilterPanel from './AirportFilterPanel.jsx'
import OpsEnviosIngress from './OpsEnviosIngress.jsx'
import DrawerEnvio from '../drawers/DrawerEnvio.jsx'

const FILE_PATTERN = /_envios_[A-Za-z]{4}_\.txt$/i

// Cap how many list rows are rendered to the DOM. With ~39k envios, mapping the whole
// filtered list produced tens of thousands of nodes that re-rendered every poll/tick and
// froze the browser ("this page is slowing down"). Users filter to find rows, so a capped
// window + a "refine your filters" hint keeps the UI responsive.
const MAX_ENVIO_ROWS = 200
const MAX_LIST_ROWS = 300

const PERIOD_OPTIONS = [
  { key: '5',       label: '5 DÍAS',    sublabel: 'Simulación estándar' },
  { key: 'colapso', label: 'COLAPSO',   sublabel: 'Sin límite — hasta el colapso' },
]

import { MdWarehouse, MdFlight, MdSettings, MdTune, MdDateRange, MdLuggage } from 'react-icons/md'

const VuelosIcon  = () => <MdFlight size={20} />
const EnviosIcon  = () => <MdLuggage size={20} />
const AlmacenIcon = () => <MdWarehouse size={20} />
const ConfigIcon  = () => <MdSettings size={20} />
const FiltrosIcon = () => <MdTune size={20} />
const OpsDiaIcon  = () => <MdDateRange size={20} />

function parseTimeStr2(t) {
  if (!t || !t.includes(':')) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// Backend serializes LocalDateTime (escala horaSalidaEst/horaLlegadaEst) as a
// naive string with no zone suffix, e.g. "2026-07-08T14:30:00" — but the value
// is always UTC. `new Date(...)` on a string like that is parsed as LOCAL time
// by JS, silently shifting it by the browser's UTC offset. Force UTC here.
function parseUtcDateTime(str) {
  if (!str) return null
  const iso = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(str) ? str : `${str}Z`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function minutesToHHMM2(totalMin) {
  const m = ((totalMin % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function toLocalTime(utcHHMM, huso) {
  if (!utcHHMM || huso == null) return null
  const utcMin = parseTimeStr2(utcHHMM)
  if (utcMin == null) return null
  const localMin = utcMin + huso * 60
  return minutesToHHMM2(localMin)
}

const SIM_SECTIONS = [
  { id: 'ops-dia', Icon: OpsDiaIcon,  label: 'OPERACIONES DÍA A DÍA', action: 'ops' },
  { id: 'vuelos',  Icon: VuelosIcon,  label: 'VUELOS'        },
  { id: 'envios',  Icon: EnviosIcon,  label: 'ENVÍOS'        },
  { id: 'almacen', Icon: AlmacenIcon, label: 'ALMACÉN'       },
  { id: 'config',  Icon: ConfigIcon,  label: 'CONFIGURACIÓN' },
  { id: 'filtros', Icon: FiltrosIcon, label: 'FILTROS'       },
]

const OPS_SECTIONS = [
  { id: 'vuelos',      Icon: VuelosIcon,  label: 'VUELOS'          },
  { id: 'envios',      Icon: EnviosIcon,  label: 'ENVÍOS'          },
  { id: 'almacen',     Icon: AlmacenIcon, label: 'ALMACÉN'         },
  { id: 'ops-ingress', Icon: OpsDiaIcon,  label: 'INGRESO ENVÍOS'  },
  { id: 'filtros',     Icon: FiltrosIcon, label: 'FILTROS'         },
]

// ── helpers ──────────────────────────────────────────────────────────────────
function warehouseColor(ap, threshold, theme) {
  const occ = ap.currentOccupation ?? ap.ocupacionActual ?? 0
  const cap = ap.warehouseCapacity ?? ap.capacidadAlmacen ?? 600
  const pct = cap > 0 ? (occ / cap) * 100 : 0
  if (pct === 0)             return theme === 'light' ? '#1a6fd4' : '#4d9fff'
  if (pct >= threshold)      return '#f04b4b'
  if (pct >= threshold - 20) return '#f5a623'
  return '#22d07a'
}

// ── SECTION: VUELOS ──────────────────────────────────────────────────────────
const SEMAFORO_VU = [
  { key: 'verde', label: 'Verde', color: '#22d07a' },
  { key: 'ambar', label: 'Ámbar', color: '#f5a623' },
  { key: 'rojo',  label: 'Rojo',  color: '#f04b4b' },
  { key: 'vacio', label: 'Vacío', color: '#4d9fff' },
]

function vuSemaforo(f) {
  const pct = f.capacity > 0 ? (f.currentLoad / f.capacity) * 100 : 0
  if (pct === 0)    return 'vacio'
  if (pct >= 85)    return 'rojo'
  if (pct >= 60)    return 'ambar'
  return 'verde'
}

function VuelosSection({ flights, plannedFlights, cancelledFlights, selectedFlight, setSelectedFlight, setMapSelectedVuelo, theme, onVueloFilterChange, nowMin }) {
  const [tab,          setTab]          = useState('activos')
  const [query,        setQuery]        = useState('')
  const [sortField,    setSortField]    = useState('occupancy')
  const [sortDir,      setSortDir]      = useState('desc')
  const [filterOrigin, setFilterOrigin] = useState('')
  const [filterDest,   setFilterDest]   = useState('')
  const [semaforoFilt, setSemaforoFilt] = useState([])

  const list = tab === 'activos' ? (flights || []) : tab === 'planificados' ? (plannedFlights || []) : (cancelledFlights || [])

  // Propagate origin/dest/semaforo filters to map
  useEffect(() => {
    onVueloFilterChange?.({ origin: filterOrigin, dest: filterDest, semaforo: semaforoFilt })
  }, [filterOrigin, filterDest, semaforoFilt]) // eslint-disable-line react-hooks/exhaustive-deps

  const originOptions = useMemo(() =>
    [...new Set(list.map(f => f.origin).filter(Boolean))].sort().filter(x => !filterDest || x !== filterDest)
  , [list, filterDest])
  const destOptions = useMemo(() =>
    [...new Set(list.map(f => f.destination).filter(Boolean))].sort().filter(x => !filterOrigin || x !== filterOrigin)
  , [list, filterOrigin])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = list.filter(f => {
      if (filterOrigin && f.origin      !== filterOrigin) return false
      if (filterDest   && f.destination !== filterDest)   return false
      if (semaforoFilt.length > 0 && !f.isCancelled && !semaforoFilt.includes(vuSemaforo(f))) return false
      if (!q) return true
      return (
        f.id?.toLowerCase().includes(q) ||
        f.origin?.toLowerCase().includes(q) ||
        f.destination?.toLowerCase().includes(q)
      )
    })
    const occ = f => f.capacity > 0 ? (f.currentLoad / f.capacity) * 100 : 0
    const parseLocalTime = (utcStr, huso) => {
      const localStr = toLocalTime(utcStr, huso) ?? utcStr
      if (!localStr || !localStr.includes(':')) return null
      const [h, m] = localStr.split(':').map(Number)
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null
      return h * 60 + m
    }
    
    return [...filtered].sort((a, b) => {
      let av, bv
      if (sortField === 'origin')           { av = (a.origin || '').toLowerCase();      bv = (b.origin || '').toLowerCase() }
      else if (sortField === 'dest')        { av = (a.destination || '').toLowerCase(); bv = (b.destination || '').toLowerCase() }
      else if (sortField === 'departureTime') { av = parseLocalTime(a.horaSalida, a.husOrigen); bv = parseLocalTime(b.horaSalida, b.husOrigen) }
      else if (sortField === 'arrivalTime')   { av = parseLocalTime(a.horaLlegada, a.husDestino); bv = parseLocalTime(b.horaLlegada, b.husDestino) }
      else                                  { av = occ(a); bv = occ(b) }
      if (av == null && bv == null) return 0
      if (av == null) return 1; if (bv == null) return -1
      if (typeof av === 'number') return sortDir === 'desc' ? bv - av : av - bv
      return sortDir === 'desc' ? (av < bv ? 1 : -1) : (av < bv ? -1 : 1)
    })
  }, [list, query, filterOrigin, filterDest, semaforoFilt, sortField, sortDir])

  const isDark = theme !== 'light'
  const selBg  = isDark ? '#1e2130' : '#f1f5f9'
  const selBdr = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '10px 12px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', marginBottom: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: 2 }}>
        <button onClick={() => setTab('activos')} style={{ flex: 1, padding: '4px 0', border: 'none', background: tab === 'activos' ? 'rgba(61,139,255,0.15)' : 'transparent', color: tab === 'activos' ? 'var(--blue)' : 'var(--muted)', borderRadius: 3, fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer', transition: 'all 0.15s' }}>
          ACTIVOS
        </button>
        <button onClick={() => setTab('planificados')} style={{ flex: 1, padding: '4px 0', border: 'none', background: tab === 'planificados' ? 'rgba(61,139,255,0.15)' : 'transparent', color: tab === 'planificados' ? 'var(--blue)' : 'var(--muted)', borderRadius: 3, fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer', transition: 'all 0.15s' }}>
          PRÓXIMOS
        </button>
        <button onClick={() => setTab('cancelados')} style={{ flex: 1, padding: '4px 0', border: 'none', background: tab === 'cancelados' ? 'rgba(240,75,75,0.15)' : 'transparent', color: tab === 'cancelados' ? 'var(--red)' : 'var(--muted)', borderRadius: 3, fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer', transition: 'all 0.15s' }}>
          CANCELADOS
        </button>
      </div>
      <input
        value={query} onChange={e => setQuery(e.target.value)}
        placeholder="Buscar vuelo, origen, destino…"
        style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13, padding: '5px 8px', borderRadius: 2, outline: 'none', marginBottom: 6 }}
      />
      <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
        {[
          { label: 'Origen', val: filterOrigin, set: setFilterOrigin, opts: originOptions },
          { label: 'Destino', val: filterDest, set: setFilterDest, opts: destOptions },
        ].map(({ label, val, set, opts }) => (
          <select key={label} value={val} onChange={e => set(e.target.value)}
            style={{ flex: 1, background: selBg, border: `1px solid ${val ? '#3d8bff88' : selBdr}`, color: val ? '#60a5fa' : 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12, padding: '4px 5px', borderRadius: 2, outline: 'none', cursor: 'pointer' }}>
            <option value="">{label}</option>
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
        {SEMAFORO_VU.map(({ key, label, color }) => {
          const active = semaforoFilt.includes(key)
          return (
            <button key={key} onClick={() => setSemaforoFilt(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])}
              style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 7px', borderRadius: 3, border: `1px solid ${active ? `${color}88` : 'var(--border)'}`, background: active ? `${color}18` : 'transparent', color: active ? color : 'var(--muted)', cursor: 'pointer' }}>
              {label}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 8, alignItems: 'center' }}>
        <select value={sortField} onChange={e => setSortField(e.target.value)}
          style={{ flex: 1, background: selBg, border: `1px solid ${selBdr}`, color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '4px 5px', borderRadius: 2 }}>
          <option value="occupancy">Ocupación</option>
          <option value="departureTime">Hora salida</option>
          <option value="arrivalTime">Hora llegada</option>
          <option value="origin">Origen</option>
          <option value="dest">Destino</option>
        </select>
        <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          style={{ background: 'none', border: '1px solid var(--border)', padding: '3px 7px', cursor: 'pointer', borderRadius: 2, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 13 }}>
          {sortDir === 'desc' ? '↓' : '↑'}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', margin: '0 -12px' }}>
        {shown.slice(0, MAX_LIST_ROWS).map(f => {
          const pct   = f.capacity > 0 ? (f.currentLoad / f.capacity) * 100 : 0
          const color = pct === 0 ? '#4d9fff' : pct >= 85 ? '#f04b4b' : pct >= 60 ? '#f5a623' : '#22d07a'
          const sel   = selectedFlight === f.id
          if (f.isCancelled) {
            const sel   = selectedFlight === f.id
            return (
              <div key={f.uid || `${f.id}-${f.fecha}`}
                onClick={() => { setSelectedFlight(sel ? null : f.id); if (setMapSelectedVuelo) setMapSelectedVuelo(f) }}
                style={{ padding: '8px 12px', borderBottom: '1px solid rgba(240,75,75,0.1)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: sel ? 'rgba(240,75,75,0.09)' : 'transparent', borderLeft: `2px solid ${sel ? 'var(--red)' : 'transparent'}`, transition: 'background 0.15s', userSelect: 'none' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: 'var(--red)', boxShadow: `0 0 5px var(--red)` }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--red)', fontWeight: 500 }}>{f.origin} → {f.destination} ({f.id})</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    Día: {f.fecha} · {f.hora}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{f.motivo}</div>
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, padding: '2px 6px', borderRadius: 3, background: `rgba(240,75,75,0.1)`, color: 'var(--red)', border: `1px solid rgba(240,75,75,0.4)`, flexShrink: 0 }}>
                  {f.currentLoad} 🧳
                </span>
              </div>
            )
          }
          return (
            <div key={f.id}
              onClick={() => { setSelectedFlight(sel ? null : f.id); if (setMapSelectedVuelo) setMapSelectedVuelo(f) }}
              style={{ padding: '8px 12px', borderBottom: '1px solid rgba(99,152,255,0.07)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: sel ? 'rgba(61,139,255,0.09)' : 'transparent', borderLeft: `2px solid ${sel ? '#3d8bff' : 'transparent'}`, transition: 'background 0.15s', userSelect: 'none' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: color, boxShadow: `0 0 5px ${color}` }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--text-bright)', fontWeight: 500 }}>{f.origin} → {f.destination}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {f.currentLoad}/{f.capacity} · {f.type === 'continental' ? 'CONT' : 'INT'}
                  {f.horaSalida && (() => {
                    const sal = toLocalTime(f.horaSalida, f.husOrigen) ?? f.horaSalida
                    const lleg = f.horaLlegada ? (toLocalTime(f.horaLlegada, f.husDestino) ?? f.horaLlegada) : ''
                    return <span style={{ marginLeft: 6 }}>· ✈ {sal}{lleg ? `→${lleg}` : ''}</span>
                  })()}
                </div>
                <div style={{ height: 2, background: 'rgba(255,255,255,0.07)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: color, transition: 'width 0.4s' }} />
                </div>
              </div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, padding: '2px 6px', borderRadius: 3, background: `${color}18`, color, border: `1px solid ${color}40`, flexShrink: 0 }}>
                {pct.toFixed(2)}%
              </span>
            </div>
          )
        })}
        {shown.length > MAX_LIST_ROWS && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', padding: '10px 12px', textAlign: 'center', borderTop: '1px solid rgba(99,152,255,0.07)' }}>
            Mostrando {MAX_LIST_ROWS} de {shown.length.toLocaleString()} — usa los filtros para refinar
          </div>
        )}
        {shown.length === 0 && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)', padding: '16px 12px' }}>Sin vuelos {tab === 'activos' ? 'activos' : tab === 'planificados' ? 'próximos' : 'cancelados'}</div>
        )}
      </div>
    </div>
  )
}

// ── SECTION: ENVÍOS ─────────────────────────────────────────────────────────
const ESTADO_COLOR = {
  PENDIENTE:   '#4d9fff',
  EN_TRANSITO: '#f5a623',
  ENTREGADO:   '#22d07a',
  RETRASADO:   '#f04b4b',
}

function parseEnvioIdFromMaletaId(maletaId) {
  const match = maletaId.match(/^(.+)-(\d+)$/)
  return match ? match[1] : null
}

function EscalasDetalle({ escalas }) {
  if (!escalas || escalas.length === 0) return null
  const fmt = (dt) => {
    if (!dt) return '—'
    const s = typeof dt === 'string' ? dt : String(dt)
    const t = s.includes('T') ? s.split('T')[1]?.slice(0, 5) : s.slice(0, 5)
    return t || '—'
  }
  return (
    <div style={{ marginTop: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
      {escalas.map((esc, i) => {
        const isFirst = i === 0
        const isLast  = i === escalas.length - 1
        const tipo    = isFirst ? 'ORIGEN' : isLast ? 'DESTINO' : 'ESCALA'
        const tipoColor = isFirst ? '#4d9fff' : isLast ? '#22d07a' : '#f5a623'
        return (
          <div key={i} style={{ padding: '7px 10px', borderBottom: i < escalas.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: tipoColor, marginTop: 5, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-bright)', fontWeight: 600 }}>{esc.codigoAeropuerto}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 5px', borderRadius: 3, background: `${tipoColor}18`, color: tipoColor, border: `1px solid ${tipoColor}40` }}>{tipo}</span>
              </div>
              {esc.codigoVuelo && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Vuelo: {esc.codigoVuelo}</div>
              )}
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                {!isFirst && esc.horaLlegadaEst && <span>Llega: {fmt(esc.horaLlegadaEst)}</span>}
                {!isFirst && esc.horaLlegadaEst && !isLast && esc.horaSalidaEst && <span style={{ margin: '0 6px', opacity: 0.4 }}>·</span>}
                {!isLast && esc.horaSalidaEst && <span>Sale: {fmt(esc.horaSalidaEst)}</span>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BuscarRutaPanel({ simState, onShowEnvioRoute, appMode }) {
  const [searchMode, setSearchMode] = useState('envio')   // 'maleta' | 'envio'
  const [inputId,  setInputId]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [result,   setResult]   = useState(null)       // { envioId, escalas, origen, destino }

  async function handleBuscar() {
    const id = inputId.trim()
    if (!id) return
    setLoading(true); setError(null); setResult(null)
    try {
      let envioId = id
      if (searchMode === 'maleta') {
        const parsed = parseEnvioIdFromMaletaId(id)
        if (parsed) envioId = parsed
      }
      const envio = appMode === 'ops' 
        ? await api.getOpsEnvioById(envioId) 
        : await api.getEnvioById(envioId)
      const escalas = envio?.planDetalle?.escalas || []
      setResult({ envioId: envio.idEnvio, escalas, origen: envio.aeropuertoOrigen, destino: envio.aeropuertoDestino })
      onShowEnvioRoute?.(envioId)
    } catch {
      setError('No se encontró ruta para ese ID')
    } finally {
      setLoading(false)
    }
  }

  const selBg = 'rgba(88,166,255,0.1)'

  return (
    <div style={{ marginBottom: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 4, padding: '10px 10px 8px' }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--blue)', display: 'block', marginBottom: 8 }}>Buscar ruta en mapa</span>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {[{ key: 'maleta', label: 'Por maleta' }, { key: 'envio', label: 'Por envío' }].map(({ key, label }) => (
          <button key={key} onClick={() => { setSearchMode(key); setResult(null); setError(null) }}
            style={{ flex: 1, padding: '4px 0', border: `1px solid ${searchMode === key ? '#3d8bff88' : 'var(--border)'}`, background: searchMode === key ? selBg : 'transparent', color: searchMode === key ? 'var(--blue)' : 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11, borderRadius: 3, cursor: 'pointer', letterSpacing: 0.5 }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 5 }}>
        <input
          value={inputId} onChange={e => setInputId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleBuscar()}
          placeholder={searchMode === 'maleta' ? 'ID maleta (ej: ENV001-3)' : 'ID envío (ej: ENV001)'}
          style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '5px 7px', borderRadius: 2, outline: 'none', minWidth: 0 }}
        />
        <button onClick={handleBuscar} disabled={loading || !inputId.trim()}
          style={{ padding: '5px 10px', background: loading ? 'transparent' : 'rgba(88,166,255,0.12)', border: '1px solid rgba(88,166,255,0.4)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: 11, borderRadius: 2, cursor: loading || !inputId.trim() ? 'not-allowed' : 'pointer', flexShrink: 0, opacity: !inputId.trim() ? 0.4 : 1 }}>
          {loading ? '...' : '▶ VER'}
        </button>
      </div>
      {error && <div style={{ marginTop: 6, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--red)' }}>{error}</div>}
      {result && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
            Envío: <span style={{ color: 'var(--blue)' }}>{result.envioId}</span>
            <span style={{ margin: '0 6px', opacity: 0.4 }}>·</span>
            {result.origen} → {result.destino}
          </div>
          <EscalasDetalle escalas={result.escalas} />
        </div>
      )}
    </div>
  )
}

function EntregadosPanel({ mode, simState, nowMin, airports }) {
  const [horas,      setHoras]      = useState(4)
  const [filterOrig, setFilterOrig] = useState('')
  const [filterDest, setFilterDest] = useState('')
  const [opsData,    setOpsData]    = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [tick,       setTick]       = useState(0)

  useEffect(() => {
    if (mode !== 'ops') return
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const result = await api.getOpsEnviosEntregados(horas)
        if (!cancelled) setOpsData(result)
      } catch {
        if (!cancelled) setError('Error al cargar datos')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const id = setInterval(load, 30000)
    return () => { cancelled = true; clearInterval(id) }
  }, [mode, horas, tick])

  const baseList = useMemo(() => {
    if (mode === 'ops') return opsData || []
    const fechaSimulada = simState?.fechaSimulada
    if (!fechaSimulada) return []
    const base = new Date(fechaSimulada)
    if (Number.isNaN(base.getTime())) return []
    const effectiveNow = new Date(base.getTime() + (nowMin || 0) * 60000)
    const cutoff = new Date(effectiveNow.getTime() - horas * 3600000)
    return (simState?.envios || [])
      .filter(e => {
        if (e.estado !== 'ENTREGADO') return false
        const deliveryStr = e.fechaEntrega || e.fechaLlegadaUltimoVuelo
        if (!deliveryStr) return false
        const dt = new Date(deliveryStr)
        return dt >= cutoff && dt <= effectiveNow
      })
      .sort((a, b) => {
        const da = new Date(a.fechaEntrega || a.fechaLlegadaUltimoVuelo || 0)
        const db = new Date(b.fechaEntrega || b.fechaLlegadaUltimoVuelo || 0)
        return db - da
      })
  }, [mode, opsData, simState, nowMin, horas])

  const origOpts = useMemo(() =>
    [...new Set(baseList.map(e => e.aeropuertoOrigen).filter(Boolean))].sort()
  , [baseList])

  const destOpts = useMemo(() =>
    [...new Set(baseList.map(e => e.aeropuertoDestino).filter(Boolean))].sort()
  , [baseList])

  const list = useMemo(() =>
    baseList.filter(e => {
      if (filterOrig && e.aeropuertoOrigen !== filterOrig) return false
      if (filterDest && e.aeropuertoDestino !== filterDest) return false
      return true
    })
  , [baseList, filterOrig, filterDest])

  const fmtUT = (ingreso, entrega) => {
    if (!ingreso || !entrega) return '—'
    const ms = new Date(entrega) - new Date(ingreso)
    if (ms <= 0) return '—'
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    return `${h}h ${String(m).padStart(2, '0')}m`
  }

  const selStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 4px', borderRadius: 2, outline: 'none', width: '100%', appearance: 'none', WebkitAppearance: 'none' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Horas picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>Últimas</span>
        <input
          type="number" min={1} max={24} value={horas}
          onChange={e => setHoras(Math.min(24, Math.max(1, Number(e.target.value) || 4)))}
          style={{ width: 44, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '3px 5px', borderRadius: 2, outline: 'none', textAlign: 'center' }}
        />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', flex: 1 }}>h (máx. 24)</span>
        {mode === 'ops' && (
          <button onClick={() => setTick(t => t + 1)} disabled={loading}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '0 4px', lineHeight: 1 }}
            title="Actualizar">↻</button>
        )}
      </div>

      {/* Airport filters */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 6 }}>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 2, letterSpacing: 1 }}>ORIGEN</div>
          <select value={filterOrig} onChange={e => setFilterOrig(e.target.value)} style={selStyle}>
            <option value="" style={{ background: '#161b22', color: 'var(--text)' }}>Todos</option>
            {origOpts.map(o => <option key={o} value={o} style={{ background: '#161b22', color: 'var(--text)' }}>{o}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 2, letterSpacing: 1 }}>DESTINO</div>
          <select value={filterDest} onChange={e => setFilterDest(e.target.value)} style={selStyle}>
            <option value="" style={{ background: '#161b22', color: 'var(--text)' }}>Todos</option>
            {destOpts.map(d => <option key={d} value={d} style={{ background: '#161b22', color: 'var(--text)' }}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Summary */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#22d07a', marginBottom: 6 }}>
        {list.length} / {baseList.length} envío{baseList.length !== 1 ? 's' : ''} entregado{baseList.length !== 1 ? 's' : ''}
        {loading && <span style={{ color: 'var(--muted)', marginLeft: 8 }}>actualizando…</span>}
      </div>
      {error && <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--red)', marginBottom: 6 }}>{error}</div>}

      <div style={{ flex: 1, overflowY: 'auto', margin: '0 -12px' }}>
        {list.length === 0 && !loading && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', padding: '12px 12px' }}>
            {baseList.length === 0 ? `Sin entregas en las últimas ${horas} h.` : 'Sin resultados para ese filtro.'}
          </div>
        )}
        {list.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(99,152,255,0.2)', position: 'sticky', top: 0, background: 'var(--panel, #1a1a1a)' }}>
                <th style={{ color: 'var(--muted)', textAlign: 'left',  padding: '4px 4px 4px 12px', fontWeight: 400, letterSpacing: 1 }}>ID</th>
                <th style={{ color: 'var(--muted)', textAlign: 'left',  padding: '4px',              fontWeight: 400, letterSpacing: 1 }}>ORIG</th>
                <th style={{ color: 'var(--muted)', textAlign: 'left',  padding: '4px',              fontWeight: 400, letterSpacing: 1 }}>DEST</th>
                <th style={{ color: 'var(--muted)', textAlign: 'right', padding: '4px',              fontWeight: 400, letterSpacing: 1 }}>MAL</th>
                <th style={{ color: 'var(--muted)', textAlign: 'right', padding: '4px 12px 4px 4px', fontWeight: 400, letterSpacing: 1 }}>UT</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, MAX_LIST_ROWS).map((e, i) => {
                const delivery = e.fechaEntrega || e.fechaLlegadaUltimoVuelo
                return (
                  <tr key={e.idEnvio || i} style={{ borderBottom: '1px solid rgba(99,152,255,0.06)' }}>
                    <td style={{ padding: '5px 4px 5px 12px', color: '#22d07a', whiteSpace: 'nowrap' }}>{e.idEnvio}</td>
                    <td style={{ padding: '5px 4px', color: 'var(--text-bright)' }}>{e.aeropuertoOrigen || '—'}</td>
                    <td style={{ padding: '5px 4px', color: 'var(--text-bright)' }}>{e.aeropuertoDestino || '—'}</td>
                    <td style={{ padding: '5px 4px', color: 'var(--text)', textAlign: 'right' }}>{e.cantidadMaletas}</td>
                    <td style={{ padding: '5px 12px 5px 4px', color: '#f5a623', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtUT(e.fechaHoraIngreso, delivery)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {list.length > MAX_LIST_ROWS && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', padding: '10px 12px', textAlign: 'center' }}>
            Mostrando {MAX_LIST_ROWS} de {list.length.toLocaleString()} — usa los filtros para refinar
          </div>
        )}
      </div>
    </div>
  )
}

function EnviosSection({ simState, onShowEnvioRoute, airports, onFocusMapLocation, onSelectFlight, onEnvioSelect, mode, nowMin }) {
  const [view,       setView]       = useState('lista')
  const [estado,     setEstado]     = useState('')
  const [filterOrig, setFilterOrig] = useState('')
  const [filterDest, setFilterDest] = useState('')

  const apMap = useMemo(() => {
    const m = {}
    for (const a of (airports || [])) m[a.id || a.codigoIATA] = a
    return m
  }, [airports])

  const handleEnvioClick = (e) => {
    onEnvioSelect?.({ id: e.idEnvio, estado: e.estado })
    if (e.estado === 'ENTREGADO') {
      const ap = apMap[e.aeropuertoDestino]
      if (ap?.lat && ap?.lng) onFocusMapLocation?.({ lat: ap.lat, lng: ap.lng, zoom: 7, duration: 1.2 })
    } else if (e.estado === 'EN_TRANSITO') {
      onShowEnvioRoute?.(e.idEnvio)
      const escalas = e.planDetalle?.escalas || []
      const now = mode === 'ops'
        ? new Date()
        : (() => {
            const fs = simState?.fechaSimulada
            if (!fs) return new Date()
            return new Date(new Date(fs).getTime() + (nowMin || 0) * 60000)
          })()
      const sorted = [...escalas].sort((a, b) => a.orden - b.orden)
      const currentIdx = sorted.findIndex(esc => {
        const sal = parseUtcDateTime(esc.horaSalidaEst)
        const lleg = parseUtcDateTime(esc.horaLlegadaEst)
        return sal && lleg && sal <= now && lleg > now
      })
      if (currentIdx >= 0) {
        const arrAp  = apMap[sorted[currentIdx].codigoAeropuerto]
        // Leg 0's "previous" stop is the envío's own origin, not null — otherwise
        // the very first leg (or a direct flight) always falls through to the
        // airport-only branch below instead of the mid-route view.
        const prevAp = currentIdx > 0 ? apMap[sorted[currentIdx - 1].codigoAeropuerto] : apMap[e.aeropuertoOrigen]
        if (arrAp && prevAp) {
          onFocusMapLocation?.({ lat: (arrAp.lat + prevAp.lat) / 2, lng: (arrAp.lng + prevAp.lng) / 2, zoom: 4, duration: 1.2 })
        } else if (arrAp) {
          onFocusMapLocation?.({ lat: arrAp.lat, lng: arrAp.lng, zoom: 5, duration: 1.2 })
        }
        onSelectFlight?.(sorted[currentIdx].codigoVuelo)
      } else {
        const ap = apMap[e.aeropuertoOrigen]
        if (ap?.lat && ap?.lng) onFocusMapLocation?.({ lat: ap.lat, lng: ap.lng, zoom: 5, duration: 1.2 })
      }
    } else {
      const ap = apMap[e.aeropuertoOrigen]
      if (ap?.lat && ap?.lng) onFocusMapLocation?.({ lat: ap.lat, lng: ap.lng, zoom: 7, duration: 1.2 })
    }
  }

  const allEnvios = simState?.envios || []

  const origOptions = useMemo(() =>
    [...new Set(allEnvios.map(e => e.aeropuertoOrigen).filter(Boolean))].sort()
  , [allEnvios])

  const destOptions = useMemo(() =>
    [...new Set(allEnvios.map(e => e.aeropuertoDestino).filter(Boolean))].sort()
  , [allEnvios])

  const list = useMemo(() =>
    allEnvios.filter(e => {
      if (estado && e.estado !== estado) return false
      if (filterOrig && e.aeropuertoOrigen !== filterOrig) return false
      if (filterDest && e.aeropuertoDestino !== filterDest) return false
      return true
    })
  , [allEnvios, estado, filterOrig, filterDest])

  const ESTADOS = ['PENDIENTE', 'EN_TRANSITO', 'ENTREGADO', 'RETRASADO']

  const selectStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 4px', borderRadius: 2, outline: 'none', width: '100%', appearance: 'none', WebkitAppearance: 'none' }

  const fetchEnvioFn = mode === 'ops' ? api.getOpsEnvioById : api.getEnvioById

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '10px 12px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {[{ key: 'lista', label: 'Lista' }, { key: 'entregados', label: 'Entregados' }].map(({ key, label }) => (
          <button key={key} onClick={() => setView(key)}
            style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 11, padding: '4px 0', borderRadius: 3, border: `1px solid ${view === key ? (key === 'entregados' ? '#22d07a55' : '#3d8bff55') : 'var(--border)'}`, background: view === key ? (key === 'entregados' ? 'rgba(34,208,122,0.1)' : 'rgba(61,139,255,0.1)') : 'transparent', color: view === key ? (key === 'entregados' ? '#22d07a' : 'var(--blue)') : 'var(--muted)', cursor: 'pointer', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            {label}
          </button>
        ))}
      </div>

      {view === 'entregados' ? (
        <EntregadosPanel mode={mode} simState={simState} nowMin={nowMin} airports={airports} />
      ) : (
        <>
          <BuscarRutaPanel simState={simState} onShowEnvioRoute={onShowEnvioRoute} appMode={mode} />
          {/* Origen / Destino dropdowns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 6 }}>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 2, letterSpacing: 1 }}>ORIGEN</div>
              <select value={filterOrig} onChange={e => setFilterOrig(e.target.value)} style={selectStyle}>
                <option value="" style={{ background: '#161b22', color: 'var(--text)' }}>Todos</option>
                {origOptions.map(o => <option key={o} value={o} style={{ background: '#161b22', color: 'var(--text)' }}>{o}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 2, letterSpacing: 1 }}>DESTINO</div>
              <select value={filterDest} onChange={e => setFilterDest(e.target.value)} style={selectStyle}>
                <option value="" style={{ background: '#161b22', color: 'var(--text)' }}>Todos</option>
                {destOptions.map(d => <option key={d} value={d} style={{ background: '#161b22', color: 'var(--text)' }}>{d}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            <button onClick={() => setEstado('')}
              style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '2px 8px', borderRadius: 3, border: `1px solid ${!estado ? '#3d8bff88' : 'var(--border)'}`, background: !estado ? 'rgba(61,139,255,0.1)' : 'transparent', color: !estado ? 'var(--blue)' : 'var(--muted)', cursor: 'pointer', letterSpacing: 0.5 }}>
              TODOS
            </button>
            {ESTADOS.map(s => (
              <button key={s} onClick={() => setEstado(estado === s ? '' : s)}
                style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '2px 8px', borderRadius: 3, border: `1px solid ${estado === s ? `${ESTADO_COLOR[s]}88` : 'var(--border)'}`, background: estado === s ? `${ESTADO_COLOR[s]}18` : 'transparent', color: estado === s ? ESTADO_COLOR[s] : 'var(--muted)', cursor: 'pointer', letterSpacing: 0.3 }}>
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', margin: '0 -12px' }}>
            {list.slice(0, MAX_ENVIO_ROWS).map((e, i) => {
              const color = ESTADO_COLOR[e.estado] || 'var(--muted)'
              return (
                <div key={e.idEnvio || i}
                  onClick={() => handleEnvioClick(e)}
                  style={{ padding: '8px 12px', borderBottom: '1px solid rgba(99,152,255,0.07)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-bright)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.aeropuertoOrigen} → {e.aeropuertoDestino}
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {e.idEnvio} · {e.cantidadMaletas} 🧳
                    </div>
                  </div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '2px 6px', borderRadius: 3, background: `${color}18`, color, border: `1px solid ${color}40`, flexShrink: 0 }}>
                    {(e.estado || '—').replace('_', ' ')}
                  </span>
                </div>
              )
            })}
            {list.length > MAX_ENVIO_ROWS && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', padding: '10px 12px', textAlign: 'center', borderTop: '1px solid rgba(99,152,255,0.07)' }}>
                Mostrando {MAX_ENVIO_ROWS} de {list.length.toLocaleString()} — usa los filtros (origen / destino / estado) para refinar
              </div>
            )}
            {list.length === 0 && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)', padding: '16px 12px' }}>Sin envíos{estado || filterOrig || filterDest ? ' (filtro activo)' : ''}</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── SECTION: ALMACÉN ─────────────────────────────────────────────────────────
const SEMAFORO_AP = [
  { key: 'verde', label: 'Verde', color: '#22d07a' },
  { key: 'ambar', label: 'Ámbar', color: '#f5a623' },
  { key: 'rojo',  label: 'Rojo',  color: '#f04b4b' },
  { key: 'vacio', label: 'Vacío', color: '#4d9fff' },
]

function apSemaforo(ap, threshold) {
  const occ = ap.currentOccupation ?? ap.ocupacionActual ?? 0
  const cap = ap.warehouseCapacity ?? ap.capacidadAlmacen ?? 600
  const pct = cap > 0 ? (occ / cap) * 100 : 0
  if (pct === 0)          return 'vacio'
  if (pct >= threshold)   return 'rojo'
  if (pct >= threshold - 20) return 'ambar'
  return 'verde'
}

function AlmacenSection({ airports, threshold, theme, setMapSelectedAirport, onAirportFilterChange, onFocusMapLocation }) {
  const [pattern,       setPattern]       = useState('')
  const [continent,     setContinent]     = useState('')
  const [sortField,     setSortField]     = useState('occupation')
  const [sortDir,       setSortDir]       = useState('desc')
  const [semaforoFilt,  setSemaforoFilt]  = useState([])
  const list = airports || []

  const isDark = theme !== 'light'
  const selBg  = isDark ? '#1e2130' : '#f1f5f9'

  // Propagate filters to map whenever they change
  useEffect(() => {
    onAirportFilterChange?.({ continent, pattern: pattern.trim(), semaforo: semaforoFilt })
  }, [continent, pattern, semaforoFilt]) // eslint-disable-line react-hooks/exhaustive-deps

  const continents = useMemo(() =>
    [...new Set(list.map(a => a.continente || a.continent || '').filter(Boolean))].sort()
  , [list])

  const shown = useMemo(() => {
    const patRaw = pattern.trim()
    const re = patRaw && patRaw.includes('*') ? (() => {
      const esc = patRaw.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*')
      try { return new RegExp(`^.*${esc}.*$`, 'i') } catch { return null }
    })() : null
    const filtered = list.filter(ap => {
      if (continent && (ap.continente || ap.continent || '') !== continent) return false
      if (re && !re.test(ap.codigoIATA || ap.id || '')) return false
      if (patRaw && !patRaw.includes('*') && !(ap.codigoIATA || ap.id || '').toLowerCase().includes(patRaw.toLowerCase())) return false
      if (semaforoFilt.length > 0 && !semaforoFilt.includes(apSemaforo(ap, threshold))) return false
      return true
    })
    return [...filtered].sort((a, b) => {
      if (sortField === 'nextDeparture') {
        const diff = (a.nextDepartureWait ?? Infinity) - (b.nextDepartureWait ?? Infinity);
        return sortDir === 'asc' ? diff : -diff;
      }
      if (sortField === 'nextArrival') {
        const diff = (a.nextArrivalWait ?? Infinity) - (b.nextArrivalWait ?? Infinity);
        return sortDir === 'asc' ? diff : -diff;
      }
      const aOcc = a.currentOccupation ?? a.ocupacionActual ?? 0
      const aCap = a.warehouseCapacity ?? a.capacidadAlmacen ?? 600
      const bOcc = b.currentOccupation ?? b.ocupacionActual ?? 0
      const bCap = b.warehouseCapacity ?? b.capacidadAlmacen ?? 600
      const diff = (bOcc / bCap) - (aOcc / aCap)
      return sortDir === 'desc' ? diff : -diff
    })
  }, [list, pattern, continent, semaforoFilt, threshold, sortDir, sortField])
  const toggleSemaforo = (key) =>
    setSemaforoFilt(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '10px 12px', overflow: 'hidden' }}>
      <input
        value={pattern} onChange={e => setPattern(e.target.value)}
        placeholder="Buscar almacén..."
        style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13, padding: '5px 8px', borderRadius: 2, outline: 'none', marginBottom: 6 }}
      />
      <div style={{ display: 'flex', gap: 5, marginBottom: 6, alignItems: 'center' }}>
        <select value={continent} onChange={e => setContinent(e.target.value)}
          style={{ flex: 1, background: selBg, border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '4px 5px', borderRadius: 2, minWidth: 0 }}>
          <option value="">Continente</option>
          {continents.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={sortField} onChange={e => setSortField(e.target.value)}
          style={{ flex: 1, background: selBg, border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '4px 5px', borderRadius: 2, minWidth: 0 }}>
          <option value="occupation">Ocupación</option>
          <option value="nextDeparture">Próxima Salida</option>
          <option value="nextArrival">Próxima Llegada</option>
        </select>
        <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          style={{ background: 'none', border: '1px solid var(--border)', padding: '3px 7px', cursor: 'pointer', borderRadius: 2, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 13, flexShrink: 0 }}>
          {sortDir === 'desc' ? '↓' : '↑'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {SEMAFORO_AP.map(({ key, label, color }) => {
          const active = semaforoFilt.includes(key)
          return (
            <button key={key} onClick={() => toggleSemaforo(key)}
              style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 7px', borderRadius: 3, border: `1px solid ${active ? `${color}88` : 'var(--border)'}`, background: active ? `${color}18` : 'transparent', color: active ? color : 'var(--muted)', cursor: 'pointer' }}>
              {label}
            </button>
          )
        })}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {shown.map(ap => {
          const color = warehouseColor(ap, threshold, theme)
          const occ   = ap.currentOccupation ?? ap.ocupacionActual ?? 0
          const cap   = ap.warehouseCapacity  ?? ap.capacidadAlmacen ?? 600
          const pct   = cap > 0 ? (occ / cap) * 100 : 0
          return (
            <div key={ap.id} style={{ marginBottom: 10, cursor: 'pointer' }} onClick={() => {
              setMapSelectedAirport?.(ap)
              if (ap.lat && ap.lng) onFocusMapLocation?.({ lat: ap.lat, lng: ap.lng })
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)' }}>
                  {ap.id} — {ap.name}
                  {sortField === 'nextDeparture' && ap.nextDepartureWait !== Infinity && (
                    <span style={{ color: 'var(--blue)', marginLeft: 8, fontSize: 11 }}>Sale en {ap.nextDepartureWait}m</span>
                  )}
                  {sortField === 'nextArrival' && ap.nextArrivalWait !== Infinity && (
                    <span style={{ color: 'var(--blue)', marginLeft: 8, fontSize: 11 }}>Llega en {ap.nextArrivalWait}m</span>
                  )}
                  {sortField === 'nextDeparture' && ap.debugDep && ap.debugDep.length > 0 && ap.nextDepartureWait !== Infinity && (
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                      {(() => {
                         const d = ap.debugDep.find(x => x.wait === ap.nextDepartureWait)
                         return d ? <div key={d.id}>{d.id}: Sale a {d.time} (Esp={d.wait}m)</div> : null
                      })()}
                    </div>
                  )}
                  {sortField === 'nextArrival' && ap.debugArr && ap.debugArr.length > 0 && ap.nextArrivalWait !== Infinity && (
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                      {(() => {
                         const d = ap.debugArr.find(x => x.wait === ap.nextArrivalWait)
                         return d ? <div key={d.id}>{d.id}: Llega a {d.time} (Esp={d.wait}m)</div> : null
                      })()}
                    </div>
                  )}
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color }}>{pct.toFixed(2)}%</span>
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: color, borderRadius: 3, transition: 'width 0.4s' }} />
              </div>
            </div>
          )
        })}
        {shown.length === 0 && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>Sin aeropuertos con actividad</div>
        )}
      </div>
    </div>
  )
}

// ── SECTION: CONFIGURACIÓN ───────────────────────────────────────────────────
function ConfigSection({ onSimulationStarted, onClose, theme }) {
  const [periodo,                  setPeriodo]                  = useState('5')
  const [fechaInicio,              setFechaInicio]              = useState('2026-06-01')
  const [horaInicio,               setHoraInicio]               = useState('00:00')
  const [escalaMinima,             setEscalaMinima]             = useState(10)
  const [tiempoRecogida,           setTiempoRecogida]           = useState(10)
  const [semaforo,                 setSemaforo]                 = useState({ verde: 60, ambar: 85 })
  const [umbralColapso,            setUmbralColapso]            = useState(50)
  const [cancelacionesAleatorias,  setCancelacionesAleatorias]  = useState(false)
  const [porcentajeCancelacion,    setPorcentajeCancelacion]    = useState(5)
  const [loading,                  setLoading]                  = useState(false)
  const [loadingElapsed,           setLoadingElapsed]           = useState(0)
  const [error,                    setError]                    = useState(null)
  const [uploadFile,               setUploadFile]               = useState([])
  const [uploadFileError,          setUploadFileError]          = useState(null)
  const [uploadLoading,            setUploadLoading]            = useState(false)
  const [uploadResult,             setUploadResult]             = useState(null)
  const [uploadError,              setUploadError]              = useState(null)
  const [uploadProgress,           setUploadProgress]           = useState({ current: 0, total: 0 })
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!loading) { setLoadingElapsed(0); return }
    const start = Date.now()
    const id = setInterval(() => setLoadingElapsed(Math.floor((Date.now() - start) / 100) / 10), 100)
    return () => clearInterval(id)
  }, [loading])

  const semaforoError = Number(semaforo.ambar) <= Number(semaforo.verde)
    ? 'Ámbar debe ser mayor que verde'
    : null

  function handleFileChange(e) {
    const files = Array.from(e.target.files || [])
    setUploadResult(null); setUploadError(null)
    if (!files.length) { setUploadFile([]); setUploadFileError(null); return }
    const notTxt = files.find(f => !f.name.toLowerCase().endsWith('.txt'))
    if (notTxt) { setUploadFile([]); setUploadFileError('Solo archivos .txt'); return }
    const valid   = files.filter(f => FILE_PATTERN.test(f.name))
    const invalid = files.filter(f => !FILE_PATTERN.test(f.name))
    if (!valid.length) { setUploadFile([]); setUploadFileError('Formato: _envios_XXXX_.txt'); return }
    setUploadFile(valid.map(f => ({ file: f, status: 'pending', error: null })))
    setUploadFileError(invalid.length ? `Ignorados ${invalid.length} archivos` : null)
  }

  async function handleUpload() {
    if (!uploadFile.length) return
    setUploadLoading(true); setUploadError(null); setUploadResult(null)
    setUploadProgress({ current: 0, total: uploadFile.length })
    const initial = [...uploadFile]
    let total = 0; const errors = []
    for (let i = 0; i < initial.length; i++) {
      setUploadFile(prev => { const c = [...prev]; c[i] = { ...c[i], status: 'in_progress' }; return c })
      setUploadProgress({ current: i, total: initial.length })
      try {
        const res = await api.uploadEnvios(initial[i].file)
        total += res.count ?? 0
        setUploadFile(prev => { const c = [...prev]; c[i] = { ...c[i], status: 'done' }; return c })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${initial[i].file.name}: ${msg}`)
        setUploadFile(prev => { const c = [...prev]; c[i] = { ...c[i], status: 'error', error: msg }; return c })
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (errors.length) setUploadError(errors.join(' | '))
    if (total > 0 || !errors.length) setUploadResult({ count: total, files: initial.length })
    setUploadFile([]); setUploadLoading(false)
    setUploadProgress({ current: 0, total: 0 })
  }

  async function handleSimular() {
    if (semaforoError) { setError(semaforoError); return }
    const esColapso = periodo === 'colapso'
    const params = {
      algoritmo: 'SIMULATED_ANNEALING',
      dias: esColapso ? 99 : Number.parseInt(periodo, 10),
      esColapso,
      minutosEscalaMinima:          Number(escalaMinima),
      minutosRecogidaDestino:        Number(tiempoRecogida),
      umbralSemaforoVerde:           Number(semaforo.verde),
      umbralSemaforoAmbar:           Number(semaforo.ambar),
      fechaInicio, horaInicio,
      umbralColapsoPorcentajeSlaVencido: esColapso ? Number(umbralColapso) : 50,
      porcentajeCancelacionAleatoria: cancelacionesAleatorias ? Number(porcentajeCancelacion) : 0,
    }
    setLoading(true); setError(null)
    try {
      const state = await startSimulation(params)
      onSimulationStarted(state, params)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const inputNum = (val, set, min, max) => ({
    type: 'number', min, max, value: val, disabled: loading,
    onChange: e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= min && v <= max) set(v) },
    style: { width: 64, textAlign: 'right', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 14, padding: '5px 7px', appearance: 'textfield', MozAppearance: 'textfield', WebkitAppearance: 'none', boxSizing: 'border-box' }
  })

  return (
    <>
      {loading && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(13,17,23,0.88)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid rgba(88,166,255,0.15)', borderTopColor: 'var(--blue)', animation: 'spin 0.75s linear infinite' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--text)', letterSpacing: 1, marginBottom: 4 }}>Calculando rutas óptimas…</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 22, color: 'var(--blue-bright)', fontWeight: 700, letterSpacing: 2 }}>{loadingElapsed.toFixed(1)}s</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 2, marginTop: 4 }}>tiempo de planificación</div>
          </div>
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Periodo */}
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Tipo de periodo</span>
          {PERIOD_OPTIONS.map(opt => {
            const sel = periodo === opt.key
            return (
              <button key={opt.key} disabled={loading} onClick={() => setPeriodo(opt.key)}
                style={{ width: '100%', padding: '8px 10px', border: `1px solid ${sel ? 'var(--blue)' : 'var(--border)'}`, background: sel ? 'rgba(88,166,255,0.06)' : 'transparent', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--text)', textAlign: 'left' }}>{opt.label}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', textAlign: 'left' }}>{opt.sublabel}</div>
                </div>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: sel ? 'var(--blue)' : 'transparent', border: `1px solid ${sel ? 'var(--blue)' : 'var(--border)'}`, flexShrink: 0 }} />
              </button>
            )
          })}
        </div>

        {/* Fecha y hora */}
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Fecha y hora de inicio (UTC)</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} disabled={loading}
              colorScheme={theme !== 'light' ? 'dark' : 'light'}
              style={{ flex: 2, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 14, padding: '6px 8px', colorScheme: theme !== 'light' ? 'dark' : 'light', boxSizing: 'border-box' }} />
            <input type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} disabled={loading}
              style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 14, padding: '6px 8px', colorScheme: theme !== 'light' ? 'dark' : 'light', boxSizing: 'border-box' }} />
          </div>
        </div>

        {/* Archivos de envíos */}
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Archivos de envíos</span>
          <input ref={fileInputRef} type="file" accept=".txt" multiple onChange={handleFileChange} disabled={loading || uploadLoading} style={{ display: 'none' }} id="sp-upload-envios-input" />
          <label htmlFor="sp-upload-envios-input"
            style={{ display: 'block', width: '100%', padding: '7px 10px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, cursor: loading || uploadLoading ? 'not-allowed' : 'pointer', textAlign: 'center', boxSizing: 'border-box', opacity: loading || uploadLoading ? 0.5 : 1 }}>
            Seleccionar archivos (.txt)
          </label>
          {uploadFileError && <div style={{ marginTop: 5, color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 12 }}>{uploadFileError}</div>}
          {uploadFile.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {uploadFile.map((item, idx) => {
                const c = item.status === 'done' ? 'var(--green)' : item.status === 'error' ? 'var(--red)' : item.status === 'in_progress' ? 'var(--blue)' : 'var(--muted)'
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, marginBottom: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.file.name}</span>
                    {item.status === 'pending' && <button onClick={() => setUploadFile(p => p.filter((_, i) => i !== idx))} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 16, cursor: 'pointer', padding: 0 }}>×</button>}
                  </div>
                )
              })}
              <button onClick={handleUpload} disabled={uploadLoading || loading}
                style={{ width: '100%', padding: '6px 10px', background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.3)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, cursor: uploadLoading || loading ? 'not-allowed' : 'pointer', opacity: uploadLoading || loading ? 0.5 : 1 }}>
                {uploadLoading ? 'Subiendo...' : 'Subir'}
              </button>
            </div>
          )}
          {uploadResult && <div style={{ marginTop: 5, color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: 12 }}>{uploadResult.count} envíos cargados ({uploadResult.files} archivo{uploadResult.files !== 1 ? 's' : ''})</div>}
          {uploadError && <div style={{ marginTop: 5, color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 12 }}>{uploadError}</div>}
          <div style={{ marginTop: 5, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11, opacity: 0.6 }}>Formato: _envios_XXXX_.txt</div>
        </div>

        {/* Parámetros de conexión */}
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Parámetros de conexión</span>
          {[
            { label: 'Escala mínima (min)',         val: escalaMinima,   set: setEscalaMinima,   min: 1, max: 60 },
            { label: 'Tiempo recogida destino (min)', val: tiempoRecogida, set: setTiempoRecogida, min: 1, max: 60 },
          ].map(({ label, val, set, min, max }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 13 }}>{label}</span>
              <input {...inputNum(val, set, min, max)} />
            </div>
          ))}
        </div>

        {/* Condición de colapso */}
        {periodo === 'colapso' && (
          <div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Condición de colapso</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 13 }}>Umbral SLA vencido (%)</span>
              <input {...inputNum(umbralColapso, setUmbralColapso, 10, 90)} style={{ ...inputNum(umbralColapso, setUmbralColapso, 10, 90).style }} />
            </div>
          </div>
        )}

        {/* Semáforo */}
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Rangos de semáforo</span>
          {[
            { key: 'verde', color: 'var(--green)', label: 'Verde',  desc: 'Normal' },
            { key: 'ambar', color: 'var(--amber)', label: 'Ámbar',  desc: 'Elevada' },
          ].map(item => (
            <div key={item.key} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color }} />
              <div>
                <div style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13 }}>{item.label}</div>
                <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>{item.desc}</div>
              </div>
              <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 13 }}>{'<'}</span>
              <input
                type="number" value={semaforo[item.key]} disabled={loading}
                onChange={e => { const v = Number(e.target.value); setSemaforo(p => ({ ...p, [item.key]: Number.isFinite(v) ? v : p[item.key] })) }}
                style={{ width: 52, textAlign: 'right', background: 'rgba(255,255,255,0.04)', border: `1px solid ${semaforoError && item.key === 'ambar' ? 'var(--red)' : 'var(--border)'}`, color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13, padding: '4px 6px', appearance: 'textfield', MozAppearance: 'textfield', WebkitAppearance: 'none' }}
              />
            </div>
          ))}
          {semaforoError && <div style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 12, marginTop: 2 }}>{semaforoError}</div>}
        </div>

        {/* Cancelaciones */}
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Cancelaciones aleatorias</span>
          <button type="button" disabled={loading} onClick={() => setCancelacionesAleatorias(v => !v)}
            style={{ width: '100%', padding: '7px 10px', border: `1px solid ${cancelacionesAleatorias ? 'var(--blue)' : 'var(--border)'}`, background: cancelacionesAleatorias ? 'rgba(88,166,255,0.06)' : 'transparent', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--text)' }}>{cancelacionesAleatorias ? 'Habilitadas' : 'Deshabilitadas'}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{cancelacionesAleatorias ? 'ON' : 'OFF'}</span>
          </button>
          {cancelacionesAleatorias && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)', flexShrink: 0 }}>% por día</label>
              <input type="number" min={1} max={50} value={porcentajeCancelacion} disabled={loading}
                onChange={e => setPorcentajeCancelacion(e.target.value)}
                style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 14, padding: '5px 8px' }} />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ borderLeft: '2px solid var(--red)', background: 'rgba(248,81,73,0.06)', padding: '8px 10px', color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 13 }}>{error}</div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
          <button onClick={onClose} disabled={loading}
            style={{ flex: 1, padding: '8px 0', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
            Cancelar
          </button>
          <button onClick={handleSimular} disabled={Boolean(semaforoError) || loading}
            style={{ flex: 2, padding: '8px 0', background: 'rgba(88,166,255,0.12)', border: '1px solid rgba(88,166,255,0.4)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, cursor: Boolean(semaforoError) || loading ? 'not-allowed' : 'pointer', opacity: Boolean(semaforoError) || loading ? 0.35 : 1 }}>
            {loading ? 'PROCESANDO...' : '▶ SIMULAR'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── SECTION: FILTROS ─────────────────────────────────────────────────────────
function FiltrosSection({ airports, originIds, setOriginIds, destIds, setDestIds, threshold, setThreshold }) {
  return (
    <AirportFilterPanel
      airports={airports}
      originIds={originIds}
      setOriginIds={setOriginIds}
      destIds={destIds}
      setDestIds={setDestIds}
      threshold={threshold}
      setThreshold={setThreshold}
    />
  )
}

function OpsIngressSection({ airports, onEnviosChanged, opsBase }) {
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <OpsEnviosIngress airports={airports} onEnviosChanged={onEnviosChanged || (() => {})} opsBase={opsBase} />
    </div>
  )
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────
export default function SidePanel({
  mode = 'simulacion',
  activeSection,
  onSectionChange,
  // Vuelos
  flights,
  plannedFlights,
  cancelledFlights,
  selectedFlight,
  setSelectedFlight,
  setMapSelectedVuelo,
  setMapSelectedAirport,
  // Envíos
  simState,
  onShowEnvioRoute,
  // Almacén
  airports,
  threshold,
  setThreshold,
  // Vinculación mapa
  onVueloFilterChange,
  onAirportFilterChange,
  onFocusMapLocation,
  // Configuración
  onSimulationStarted,
  // Filtros
  originIds,
  setOriginIds,
  destIds,
  setDestIds,
  theme,
  onOpenOps,
  opsIngressAirports = [],
  onOpsEnviosChanged,
  opsBase,
  isOwner = true,
  hasSimulation = false,
  nowMin = null,
}) {
  const sections = mode === 'ops' ? OPS_SECTIONS : SIM_SECTIONS
  const [selectedEnvio, setSelectedEnvio] = useState(null)
  const fetchEnvioFn = mode === 'ops' ? api.getOpsEnvioById : api.getEnvioById

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--panel)', borderRight: '1px solid var(--border)', position: 'relative' }}>
      {selectedEnvio && (
        <DrawerEnvio
          envioId={selectedEnvio.id}
          currentEstado={selectedEnvio.estado}
          fetchEnvio={fetchEnvioFn}
          onClose={() => setSelectedEnvio(null)}
          onShowInMap={onShowEnvioRoute}
        />
      )}
      {/* Icon strip */}
      <div style={{ width: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', gap: 4, flexShrink: 0, borderRight: activeSection ? '1px solid var(--border)' : 'none' }}>
        {sections.map(({ id, Icon, label, action }) => {
          // ops-dia and config are restricted ONLY while a simulation is running and user is not owner
          const restricted = hasSimulation && !isOwner && (action === 'ops' || id === 'config')
          return (
            <button
              key={id}
              onClick={() => {
                if (restricted) return
                if (action === 'ops') {
                  onOpenOps?.()
                  return
                }
                onSectionChange(activeSection === id ? null : id)
              }}
              title={restricted ? 'Solo el iniciador de la simulación tiene este acceso' : label}
              style={{
                width: 40, height: 40,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: activeSection === id ? 'rgba(88,166,255,0.14)' : action === 'ops' ? 'rgba(34,197,94,0.08)' : 'transparent',
                border: 'none', borderRadius: 8,
                cursor: restricted ? 'not-allowed' : 'pointer',
                color: restricted
                  ? 'var(--muted)'
                  : activeSection === id ? 'var(--blue)' : action === 'ops' ? '#22c55e' : 'var(--muted)',
                opacity: restricted ? 0.35 : 1,
                transition: 'color 0.15s, background 0.15s',
              }}
            >
              <Icon />
            </button>
          )
        })}
      </div>

      {/* Content panel */}
      {activeSection && (
        <div style={{ width: 360, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--blue)', fontWeight: 700 }}>
              {sections.find(s => s.id === activeSection)?.label}
            </span>
            <button onClick={() => onSectionChange(null)}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>
              ✕
            </button>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {activeSection === 'vuelos'  && <VuelosSection  flights={flights} plannedFlights={plannedFlights} cancelledFlights={cancelledFlights} selectedFlight={selectedFlight} setSelectedFlight={setSelectedFlight} setMapSelectedVuelo={setMapSelectedVuelo} theme={theme} onVueloFilterChange={onVueloFilterChange} nowMin={nowMin} />}
            {activeSection === 'envios'  && <EnviosSection  simState={simState} onShowEnvioRoute={onShowEnvioRoute} airports={airports} onFocusMapLocation={onFocusMapLocation} onSelectFlight={setSelectedFlight} onEnvioSelect={setSelectedEnvio} mode={mode} nowMin={nowMin} />}
            {activeSection === 'almacen' && <AlmacenSection airports={airports} threshold={threshold} theme={theme} setMapSelectedAirport={setMapSelectedAirport} onAirportFilterChange={onAirportFilterChange} onFocusMapLocation={onFocusMapLocation} />}
            {activeSection === 'config'  && <ConfigSection  onSimulationStarted={onSimulationStarted} onClose={() => onSectionChange(null)} theme={theme} />}
            {activeSection === 'filtros' && <FiltrosSection airports={airports} originIds={originIds} setOriginIds={setOriginIds} destIds={destIds} setDestIds={setDestIds} threshold={threshold} setThreshold={setThreshold} />}
            {activeSection === 'ops-ingress' && <OpsIngressSection airports={opsIngressAirports} onEnviosChanged={onOpsEnviosChanged} opsBase={opsBase} />}
          </div>
        </div>
      )}
    </div>
  )
}
