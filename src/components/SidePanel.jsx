import React, { useMemo, useRef, useState, useEffect } from 'react'
import { api, startSimulation } from '../services/api.js'
import AirportFilterPanel from './AirportFilterPanel.jsx'

const FILE_PATTERN = /_envios_[A-Za-z]{4}_\.txt$/i

const PERIOD_OPTIONS = [
  { key: '5',       label: '5 DÍAS',    sublabel: 'Simulación estándar' },
  { key: 'colapso', label: 'COLAPSO',   sublabel: 'Sin límite — hasta el colapso' },
]

// ── SVG icons (Feather-style 18 px) ─────────────────────────────────────────
function Ic({ children }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}
const VuelosIcon  = () => <Ic><polygon points="22 2 15 22 11 13 2 9 22 2"/><line x1="22" y1="2" x2="11" y2="13"/></Ic>
const EnviosIcon  = () => <Ic><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><line x1="3.27" y1="6.96" x2="12" y2="12.01"/><line x1="12" y1="22.08" x2="12" y2="12"/></Ic>
const AlmacenIcon = () => <Ic><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></Ic>
const ConfigIcon  = () => <Ic><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></Ic>
const FiltrosIcon = () => <Ic><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></Ic>

const SECTIONS = [
  { id: 'vuelos',  Icon: VuelosIcon,  label: 'VUELOS'        },
  { id: 'envios',  Icon: EnviosIcon,  label: 'ENVÍOS'        },
  { id: 'almacen', Icon: AlmacenIcon, label: 'ALMACÉN'       },
  { id: 'config',  Icon: ConfigIcon,  label: 'CONFIGURACIÓN' },
  { id: 'filtros', Icon: FiltrosIcon, label: 'FILTROS'       },
]

// ── helpers ──────────────────────────────────────────────────────────────────
function warehouseColor(ap, threshold) {
  const occ = ap.currentOccupation ?? ap.ocupacionActual ?? 0
  const cap = ap.warehouseCapacity ?? ap.capacidadAlmacen ?? 600
  const pct = cap > 0 ? (occ / cap) * 100 : 0
  if (pct >= threshold)      return '#f04b4b'
  if (pct >= threshold - 20) return '#f5a623'
  return '#22d07a'
}

// ── SECTION: VUELOS ──────────────────────────────────────────────────────────
function VuelosSection({ flights, selectedFlight, setSelectedFlight, setMapSelectedVuelo, theme }) {
  const [query,        setQuery]        = useState('')
  const [sortField,    setSortField]    = useState('occupancy')
  const [sortDir,      setSortDir]      = useState('desc')
  const [filterOrigin, setFilterOrigin] = useState('')
  const [filterDest,   setFilterDest]   = useState('')

  const list = flights || []

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
      if (!q) return true
      return (
        f.id?.toLowerCase().includes(q) ||
        f.origin?.toLowerCase().includes(q) ||
        f.destination?.toLowerCase().includes(q)
      )
    })
    const occ = f => f.capacity > 0 ? (f.currentLoad / f.capacity) * 100 : 0
    return [...filtered].sort((a, b) => {
      let av, bv
      if (sortField === 'origin')      { av = (a.origin || '').toLowerCase();      bv = (b.origin || '').toLowerCase() }
      else if (sortField === 'dest')   { av = (a.destination || '').toLowerCase(); bv = (b.destination || '').toLowerCase() }
      else                             { av = occ(a); bv = occ(b) }
      if (av == null && bv == null) return 0
      if (av == null) return 1; if (bv == null) return -1
      if (typeof av === 'number') return sortDir === 'desc' ? bv - av : av - bv
      return sortDir === 'desc' ? (av < bv ? 1 : -1) : (av < bv ? -1 : 1)
    })
  }, [list, query, filterOrigin, filterDest, sortField, sortDir])

  const isDark = theme !== 'light'
  const selBg  = isDark ? '#1e2130' : '#f1f5f9'
  const selBdr = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '10px 12px', overflow: 'hidden' }}>
      <input
        value={query} onChange={e => setQuery(e.target.value)}
        placeholder="Buscar vuelo, origen, destino…"
        style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 8px', borderRadius: 2, outline: 'none', marginBottom: 6 }}
      />
      <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
        {[
          { label: 'Origen', val: filterOrigin, set: setFilterOrigin, opts: originOptions },
          { label: 'Destino', val: filterDest, set: setFilterDest, opts: destOptions },
        ].map(({ label, val, set, opts }) => (
          <select key={label} value={val} onChange={e => set(e.target.value)}
            style={{ flex: 1, background: selBg, border: `1px solid ${val ? '#3d8bff88' : selBdr}`, color: val ? '#60a5fa' : 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 5px', borderRadius: 2, outline: 'none', cursor: 'pointer' }}>
            <option value="">{label}</option>
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 8, alignItems: 'center' }}>
        <select value={sortField} onChange={e => setSortField(e.target.value)}
          style={{ flex: 1, background: selBg, border: `1px solid ${selBdr}`, color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 5px', borderRadius: 2 }}>
          <option value="occupancy">Ocupación</option>
          <option value="origin">Origen</option>
          <option value="dest">Destino</option>
        </select>
        <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          style={{ background: 'none', border: '1px solid var(--border)', padding: '3px 7px', cursor: 'pointer', borderRadius: 2, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>
          {sortDir === 'desc' ? '↓' : '↑'}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', margin: '0 -12px' }}>
        {shown.map(f => {
          const pct   = f.capacity > 0 ? (f.currentLoad / f.capacity) * 100 : 0
          const color = pct === 0 ? '#4d9fff' : pct >= 85 ? '#f04b4b' : pct >= 60 ? '#f5a623' : '#22d07a'
          const sel   = selectedFlight === f.id
          return (
            <div key={f.id}
              onClick={() => { setSelectedFlight(sel ? null : f.id); if (setMapSelectedVuelo) setMapSelectedVuelo(f) }}
              style={{ padding: '8px 12px', borderBottom: '1px solid rgba(99,152,255,0.07)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: sel ? 'rgba(61,139,255,0.09)' : 'transparent', borderLeft: `2px solid ${sel ? '#3d8bff' : 'transparent'}`, transition: 'background 0.15s', userSelect: 'none' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: color, boxShadow: `0 0 5px ${color}` }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-bright)', fontWeight: 500 }}>{f.origin} → {f.destination}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{f.currentLoad}/{f.capacity} · {f.type === 'continental' ? 'CONT' : 'INT'}</div>
                <div style={{ height: 2, background: 'rgba(255,255,255,0.07)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: color, transition: 'width 0.4s' }} />
                </div>
              </div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 6px', borderRadius: 3, background: `${color}18`, color, border: `1px solid ${color}40`, flexShrink: 0 }}>
                {pct.toFixed(1)}%
              </span>
            </div>
          )
        })}
        {shown.length === 0 && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', padding: '16px 12px' }}>Sin vuelos activos</div>
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

function EnviosSection({ simState }) {
  const [query,  setQuery]  = useState('')
  const [estado, setEstado] = useState('')

  const envios = simState?.envios || simState?.aeropuertos?.flatMap?.(() => []) || []

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (simState?.envios || []).filter(e => {
      if (estado && e.estado !== estado) return false
      if (!q) return true
      return (
        (e.idEnvio || '').toLowerCase().includes(q) ||
        (e.aeropuertoOrigen || '').toLowerCase().includes(q) ||
        (e.aeropuertoDestino || '').toLowerCase().includes(q)
      )
    })
  }, [simState?.envios, query, estado])

  const ESTADOS = ['PENDIENTE', 'EN_TRANSITO', 'ENTREGADO', 'RETRASADO']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '10px 12px', overflow: 'hidden' }}>
      <input
        value={query} onChange={e => setQuery(e.target.value)}
        placeholder="Buscar ID, origen, destino…"
        style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 8px', borderRadius: 2, outline: 'none', marginBottom: 6 }}
      />
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        <button onClick={() => setEstado('')}
          style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 8px', borderRadius: 3, border: `1px solid ${!estado ? '#3d8bff88' : 'var(--border)'}`, background: !estado ? 'rgba(61,139,255,0.1)' : 'transparent', color: !estado ? 'var(--blue)' : 'var(--muted)', cursor: 'pointer', letterSpacing: 0.5 }}>
          TODOS
        </button>
        {ESTADOS.map(s => (
          <button key={s} onClick={() => setEstado(estado === s ? '' : s)}
            style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 8px', borderRadius: 3, border: `1px solid ${estado === s ? `${ESTADO_COLOR[s]}88` : 'var(--border)'}`, background: estado === s ? `${ESTADO_COLOR[s]}18` : 'transparent', color: estado === s ? ESTADO_COLOR[s] : 'var(--muted)', cursor: 'pointer', letterSpacing: 0.3 }}>
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', margin: '0 -12px' }}>
        {list.map((e, i) => {
          const color = ESTADO_COLOR[e.estado] || 'var(--muted)'
          return (
            <div key={e.idEnvio || i}
              style={{ padding: '8px 12px', borderBottom: '1px solid rgba(99,152,255,0.07)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: color }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-bright)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.aeropuertoOrigen} → {e.aeropuertoDestino}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                  {e.idEnvio} · {e.cantidadMaletas} 🧳
                </div>
              </div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 6px', borderRadius: 3, background: `${color}18`, color, border: `1px solid ${color}40`, flexShrink: 0 }}>
                {(e.estado || '—').replace('_', ' ')}
              </span>
            </div>
          )
        })}
        {list.length === 0 && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', padding: '16px 12px' }}>Sin envíos{query || estado ? ' (filtro activo)' : ''}</div>
        )}
      </div>
    </div>
  )
}

// ── SECTION: ALMACÉN ─────────────────────────────────────────────────────────
function AlmacenSection({ airports, threshold, theme }) {
  const [pattern,   setPattern]   = useState('')
  const [continent, setContinent] = useState('')
  const [sortField, setSortField] = useState('occupation')
  const [sortDir,   setSortDir]   = useState('desc')
  const list = airports || []

  const isDark = theme !== 'light'
  const selBg  = isDark ? '#1e2130' : '#f1f5f9'

  const continents = useMemo(() =>
    [...new Set(list.map(a => a.continente || a.continent || '').filter(Boolean))].sort()
  , [list])

  const shown = useMemo(() => {
    const patRaw = pattern.trim()
    const re = patRaw ? (() => {
      const esc = patRaw.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*')
      try { return new RegExp(`^${esc}$`, 'i') } catch { return null }
    })() : null
    const filtered = list.filter(ap => {
      if (continent && (ap.continente || ap.continent || '') !== continent) return false
      if (re) return re.test(ap.codigoIATA || ap.id || '')
      if (patRaw && !patRaw.includes('*')) return (ap.codigoIATA || ap.id || '').toLowerCase().includes(patRaw.toLowerCase())
      return true
    })
    return [...filtered].sort((a, b) => {
      const aOcc = a.currentOccupation ?? a.ocupacionActual ?? 0
      const aCap = a.warehouseCapacity ?? a.capacidadAlmacen ?? 600
      const bOcc = b.currentOccupation ?? b.ocupacionActual ?? 0
      const bCap = b.warehouseCapacity ?? b.capacidadAlmacen ?? 600
      const diff = (bOcc / bCap) - (aOcc / aCap)
      return sortDir === 'desc' ? diff : -diff
    }).filter(ap => (ap.currentOccupation ?? ap.ocupacionActual ?? 0) > 0)
  }, [list, pattern, continent, sortField, sortDir])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '10px 12px', overflow: 'hidden' }}>
      <input
        value={pattern} onChange={e => setPattern(e.target.value)}
        placeholder="IATA (* wildcard)"
        style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 8px', borderRadius: 2, outline: 'none', marginBottom: 6 }}
      />
      <div style={{ display: 'flex', gap: 5, marginBottom: 8, alignItems: 'center' }}>
        <select value={continent} onChange={e => setContinent(e.target.value)}
          style={{ flex: 1, background: selBg, border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 5px', borderRadius: 2 }}>
          <option value="">Continente</option>
          {continents.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          style={{ background: 'none', border: '1px solid var(--border)', padding: '3px 7px', cursor: 'pointer', borderRadius: 2, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>
          {sortDir === 'desc' ? '↓' : '↑'}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {shown.map(ap => {
          const color = warehouseColor(ap, threshold)
          const occ   = ap.currentOccupation ?? ap.ocupacionActual ?? 0
          const cap   = ap.warehouseCapacity  ?? ap.capacidadAlmacen ?? 600
          const pct   = cap > 0 ? (occ / cap) * 100 : 0
          return (
            <div key={ap.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)' }}>{ap.id} — {ap.name}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color }}>{pct.toFixed(1)}%</span>
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: color, borderRadius: 3, transition: 'width 0.4s' }} />
              </div>
            </div>
          )
        })}
        {shown.length === 0 && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>Sin aeropuertos con actividad</div>
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
    style: { width: 64, textAlign: 'right', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '5px 7px', appearance: 'textfield', MozAppearance: 'textfield', WebkitAppearance: 'none', boxSizing: 'border-box' }
  })

  return (
    <>
      {loading && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(13,17,23,0.88)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid rgba(88,166,255,0.15)', borderTopColor: 'var(--blue)', animation: 'spin 0.75s linear infinite' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', letterSpacing: 1, marginBottom: 4 }}>Calculando rutas óptimas…</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 22, color: 'var(--blue-bright)', fontWeight: 700, letterSpacing: 2 }}>{loadingElapsed.toFixed(1)}s</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 2, marginTop: 4 }}>tiempo de planificación</div>
          </div>
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Periodo */}
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Tipo de periodo</span>
          {PERIOD_OPTIONS.map(opt => {
            const sel = periodo === opt.key
            return (
              <button key={opt.key} disabled={loading} onClick={() => setPeriodo(opt.key)}
                style={{ width: '100%', padding: '8px 10px', border: `1px solid ${sel ? 'var(--blue)' : 'var(--border)'}`, background: sel ? 'rgba(88,166,255,0.06)' : 'transparent', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', textAlign: 'left' }}>{opt.label}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', textAlign: 'left' }}>{opt.sublabel}</div>
                </div>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: sel ? 'var(--blue)' : 'transparent', border: `1px solid ${sel ? 'var(--blue)' : 'var(--border)'}`, flexShrink: 0 }} />
              </button>
            )
          })}
        </div>

        {/* Fecha y hora */}
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Fecha y hora de inicio (UTC)</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} disabled={loading}
              colorScheme={theme !== 'light' ? 'dark' : 'light'}
              style={{ flex: 2, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '6px 8px', colorScheme: theme !== 'light' ? 'dark' : 'light', boxSizing: 'border-box' }} />
            <input type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} disabled={loading}
              style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '6px 8px', colorScheme: theme !== 'light' ? 'dark' : 'light', boxSizing: 'border-box' }} />
          </div>
        </div>

        {/* Archivos de envíos */}
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Archivos de envíos</span>
          <input ref={fileInputRef} type="file" accept=".txt" multiple onChange={handleFileChange} disabled={loading || uploadLoading} style={{ display: 'none' }} id="sp-upload-envios-input" />
          <label htmlFor="sp-upload-envios-input"
            style={{ display: 'block', width: '100%', padding: '7px 10px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, cursor: loading || uploadLoading ? 'not-allowed' : 'pointer', textAlign: 'center', boxSizing: 'border-box', opacity: loading || uploadLoading ? 0.5 : 1 }}>
            Seleccionar archivos (.txt)
          </label>
          {uploadFileError && <div style={{ marginTop: 5, color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 10 }}>{uploadFileError}</div>}
          {uploadFile.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {uploadFile.map((item, idx) => {
                const c = item.status === 'done' ? 'var(--green)' : item.status === 'error' ? 'var(--red)' : item.status === 'in_progress' ? 'var(--blue)' : 'var(--muted)'
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, marginBottom: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.file.name}</span>
                    {item.status === 'pending' && <button onClick={() => setUploadFile(p => p.filter((_, i) => i !== idx))} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 14, cursor: 'pointer', padding: 0 }}>×</button>}
                  </div>
                )
              })}
              <button onClick={handleUpload} disabled={uploadLoading || loading}
                style={{ width: '100%', padding: '6px 10px', background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.3)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, cursor: uploadLoading || loading ? 'not-allowed' : 'pointer', opacity: uploadLoading || loading ? 0.5 : 1 }}>
                {uploadLoading ? 'Subiendo...' : 'Subir'}
              </button>
            </div>
          )}
          {uploadResult && <div style={{ marginTop: 5, color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: 10 }}>{uploadResult.count} envíos cargados ({uploadResult.files} archivo{uploadResult.files !== 1 ? 's' : ''})</div>}
          {uploadError && <div style={{ marginTop: 5, color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 10 }}>{uploadError}</div>}
          <div style={{ marginTop: 5, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 9, opacity: 0.6 }}>Formato: _envios_XXXX_.txt</div>
        </div>

        {/* Parámetros de conexión */}
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Parámetros de conexión</span>
          {[
            { label: 'Escala mínima (min)',         val: escalaMinima,   set: setEscalaMinima,   min: 1, max: 60 },
            { label: 'Tiempo recogida destino (min)', val: tiempoRecogida, set: setTiempoRecogida, min: 1, max: 60 },
          ].map(({ label, val, set, min, max }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>{label}</span>
              <input {...inputNum(val, set, min, max)} />
            </div>
          ))}
        </div>

        {/* Condición de colapso */}
        {periodo === 'colapso' && (
          <div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Condición de colapso</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>Umbral SLA vencido (%)</span>
              <input {...inputNum(umbralColapso, setUmbralColapso, 10, 90)} style={{ ...inputNum(umbralColapso, setUmbralColapso, 10, 90).style }} />
            </div>
          </div>
        )}

        {/* Semáforo */}
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Rangos de semáforo</span>
          {[
            { key: 'verde', color: 'var(--green)', label: 'Verde',  desc: 'Normal' },
            { key: 'ambar', color: 'var(--amber)', label: 'Ámbar',  desc: 'Elevada' },
          ].map(item => (
            <div key={item.key} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color }} />
              <div>
                <div style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11 }}>{item.label}</div>
                <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 10 }}>{item.desc}</div>
              </div>
              <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>{'<'}</span>
              <input
                type="number" value={semaforo[item.key]} disabled={loading}
                onChange={e => { const v = Number(e.target.value); setSemaforo(p => ({ ...p, [item.key]: Number.isFinite(v) ? v : p[item.key] })) }}
                style={{ width: 52, textAlign: 'right', background: 'rgba(255,255,255,0.04)', border: `1px solid ${semaforoError && item.key === 'ambar' ? 'var(--red)' : 'var(--border)'}`, color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '4px 6px', appearance: 'textfield', MozAppearance: 'textfield', WebkitAppearance: 'none' }}
              />
            </div>
          ))}
          {semaforoError && <div style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 10, marginTop: 2 }}>{semaforoError}</div>}
        </div>

        {/* Cancelaciones */}
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Cancelaciones aleatorias</span>
          <button type="button" disabled={loading} onClick={() => setCancelacionesAleatorias(v => !v)}
            style={{ width: '100%', padding: '7px 10px', border: `1px solid ${cancelacionesAleatorias ? 'var(--blue)' : 'var(--border)'}`, background: cancelacionesAleatorias ? 'rgba(88,166,255,0.06)' : 'transparent', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)' }}>{cancelacionesAleatorias ? 'Habilitadas' : 'Deshabilitadas'}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>{cancelacionesAleatorias ? 'ON' : 'OFF'}</span>
          </button>
          {cancelacionesAleatorias && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>% por día</label>
              <input type="number" min={1} max={50} value={porcentajeCancelacion} disabled={loading}
                onChange={e => setPorcentajeCancelacion(e.target.value)}
                style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '5px 8px' }} />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ borderLeft: '2px solid var(--red)', background: 'rgba(248,81,73,0.06)', padding: '8px 10px', color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11 }}>{error}</div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
          <button onClick={onClose} disabled={loading}
            style={{ flex: 1, padding: '8px 0', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
            Cancelar
          </button>
          <button onClick={handleSimular} disabled={Boolean(semaforoError) || loading}
            style={{ flex: 2, padding: '8px 0', background: 'rgba(88,166,255,0.12)', border: '1px solid rgba(88,166,255,0.4)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, cursor: Boolean(semaforoError) || loading ? 'not-allowed' : 'pointer', opacity: Boolean(semaforoError) || loading ? 0.35 : 1 }}>
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

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────
export default function SidePanel({
  activeSection,
  onSectionChange,
  // Vuelos
  flights,
  selectedFlight,
  setSelectedFlight,
  setMapSelectedVuelo,
  // Envíos
  simState,
  // Almacén
  airports,
  threshold,
  setThreshold,
  // Configuración
  onSimulationStarted,
  // Filtros
  originIds,
  setOriginIds,
  destIds,
  setDestIds,
  theme,
}) {
  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--panel)', borderRight: '1px solid var(--border)' }}>
      {/* Icon strip */}
      <div style={{ width: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', gap: 4, flexShrink: 0, borderRight: activeSection ? '1px solid var(--border)' : 'none' }}>
        {SECTIONS.map(({ id, Icon, label }) => (
          <button
            key={id}
            onClick={() => onSectionChange(activeSection === id ? null : id)}
            title={label}
            style={{
              width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: activeSection === id ? 'rgba(88,166,255,0.14)' : 'transparent',
              border: 'none', borderRadius: 8, cursor: 'pointer',
              color: activeSection === id ? 'var(--blue)' : 'var(--muted)',
              transition: 'color 0.15s, background 0.15s',
            }}
          >
            <Icon />
          </button>
        ))}
      </div>

      {/* Content panel */}
      {activeSection && (
        <div style={{ width: 320, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--blue)', fontWeight: 700 }}>
              {SECTIONS.find(s => s.id === activeSection)?.label}
            </span>
            <button onClick={() => onSectionChange(null)}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>
              ✕
            </button>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {activeSection === 'vuelos'  && <VuelosSection  flights={flights} selectedFlight={selectedFlight} setSelectedFlight={setSelectedFlight} setMapSelectedVuelo={setMapSelectedVuelo} theme={theme} />}
            {activeSection === 'envios'  && <EnviosSection  simState={simState} />}
            {activeSection === 'almacen' && <AlmacenSection airports={airports} threshold={threshold} theme={theme} />}
            {activeSection === 'config'  && <ConfigSection  onSimulationStarted={onSimulationStarted} onClose={() => onSectionChange(null)} theme={theme} />}
            {activeSection === 'filtros' && <FiltrosSection airports={airports} originIds={originIds} setOriginIds={setOriginIds} destIds={destIds} setDestIds={setDestIds} threshold={threshold} setThreshold={setThreshold} />}
          </div>
        </div>
      )}
    </div>
  )
}
