
import React, { useMemo, useState } from 'react'

const s = {
  panel: {
    background: 'var(--panel)', borderLeft: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%',
  },
  section: { display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  sectionPad: { padding: '14px 14px', flexShrink: 0 },
  title: {
    fontFamily: 'var(--sans)', fontSize: 10, textTransform: 'uppercase',
    letterSpacing: 2, color: 'var(--muted)', marginBottom: 10,
    display: 'block', fontWeight: 700,
  },
  scrollable: { overflowY: 'auto', flex: 1 },
  flightItem: (selected) => ({
    padding: '9px 14px', borderBottom: '1px solid rgba(99,152,255,0.07)',
    display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer',
    background: selected ? 'rgba(61,139,255,0.09)' : 'transparent',
    borderLeft: `2px solid ${selected ? '#3d8bff' : 'transparent'}`,
    transition: 'background 0.15s ease',
    userSelect: 'none',
  }),
  dot: (color) => ({
    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
    background: color, boxShadow: `0 0 6px ${color}`,
    animation: 'pulse-dot 2.2s ease-in-out infinite',
  }),
  flightRoute: {
    fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-bright)',
    lineHeight: 1.3, fontWeight: 500,
  },
  flightMeta: {
    fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginTop: 2,
  },
  badge: (color) => ({
    fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 7px',
    borderRadius: 4, background: `${color}18`, color,
    border: `1px solid ${color}40`, marginLeft: 'auto', flexShrink: 0,
    textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600,
  }),
  airportItem: { marginBottom: 10 },
  airportHeader: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 5,
  },
  airportName: { fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)' },
  capBar: { height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' },
  capFill: (pct, color) => ({
    height: '100%', width: `${Math.min(100, pct)}%`,
    background: color, borderRadius: 3,
    transition: 'width 0.4s ease',
  }),
}

function warehouseColor(ap, threshold) {
  const occ = ap.currentOccupation ?? ap.ocupacionActual ?? 0
  const cap = ap.warehouseCapacity ?? ap.capacidadAlmacen ?? 600
  const pct = cap > 0 ? (occ / cap) * 100 : 0
  if (pct >= threshold)      return '#f04b4b'
  if (pct >= threshold - 20) return '#f5a623'
  return '#22d07a'
}

export default function RightPanel({ flights, airports, threshold, selectedFlight, setSelectedFlight, onVueloClick, showAllAirports, theme = 'dark' }) {
  const [flightQuery, setFlightQuery] = useState('')
  const [sortField, setSortField] = useState('occupancy')
  const [sortDir, setSortDir] = useState('desc')
  const [filterOrigin, setFilterOrigin] = useState('')
  const [filterDest, setFilterDest] = useState('')
  const flightList = flights || []
  const airportList = airports || []
  const [airportPattern, setAirportPattern] = useState('')
  const [airportContinent, setAirportContinent] = useState('')
  const [airportSortField, setAirportSortField] = useState('occupation')
  const [airportSortDir, setAirportSortDir] = useState('desc')
  const allActive = useMemo(() => flightList.filter((f) => f.status === 'active'), [flightList])
  const originOptions = useMemo(() =>
    [...new Set(allActive.map(f => f.origin).filter(Boolean))].sort().filter(ap => !filterDest || ap !== filterDest)
  , [allActive, filterDest])
  const destOptions = useMemo(() =>
    [...new Set(allActive.map(f => f.destination).filter(Boolean))].sort().filter(ap => !filterOrigin || ap !== filterOrigin)
  , [allActive, filterOrigin])
  const activeFlights = useMemo(() => {
    const q = flightQuery.trim()

    function patternToRegExp(pat) {
      const esc = pat.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
      const reText = esc.replace(/\*/g, '.*')
      try {
        return new RegExp(`^${reText}$`, 'i')
      } catch (e) {
        return null
      }
    }

    const isWildcard = q.includes('*')
    const patternRe = isWildcard ? patternToRegExp(q) : null
    const qLower = isWildcard ? '' : q.toLowerCase()

    function getTimeVal(val) {
      if (val == null) return null
      const t = typeof val === 'number' ? val : Date.parse(val)
      return Number.isFinite(t) ? t : null
    }

    function occupancyPct(f) {
      const load = f.currentLoad ?? 0
      const cap = f.capacity ?? 1
      return cap > 0 ? (load / cap) * 100 : 0
    }

    const filtered = allActive.filter((f) => {
      if (filterOrigin && f.origin !== filterOrigin) return false
      if (filterDest   && f.destination !== filterDest) return false
      if (patternRe) return patternRe.test(f.id ?? '')
      if (!qLower) return true
      return (
        f.id?.toLowerCase().includes(qLower) ||
        f.origin?.toLowerCase().includes(qLower) ||
        f.destination?.toLowerCase().includes(qLower) ||
        `${f.origin}-${f.destination}`.toLowerCase().includes(qLower)
      )
    })

    // sorting
    const sorted = [...filtered].sort((a, b) => {
      let av, bv
      switch (sortField) {
        case 'departureTime':
          av = a.depMin ?? null; bv = b.depMin ?? null; break
        case 'arrivalTime':
          av = a.arrMin ?? null; bv = b.arrMin ?? null; break
        case 'origin':
          av = (a.origin || '').toLowerCase(); bv = (b.origin || '').toLowerCase(); break
        case 'destination':
          av = (a.destination || '').toLowerCase(); bv = (b.destination || '').toLowerCase(); break
        case 'occupancy':
        default:
          av = occupancyPct(a); bv = occupancyPct(b); break
      }
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'desc' ? bv - av : av - bv
      }
      // fallback string compare
      if (av < bv) return sortDir === 'desc' ? 1 : -1
      if (av > bv) return sortDir === 'desc' ? -1 : 1
      return 0
    })

    return sorted
  }, [allActive, flightQuery, filterOrigin, filterDest, sortField, sortDir])
  const { occupiedAirports, hiddenCount } = useMemo(() => {
    const patternRaw = (airportPattern || '').trim()
    function patternToRegExp(pat) {
      const esc = pat.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
      const reText = esc.replace(/\*/g, '.*')
      try { return new RegExp(`^${reText}$`, 'i') } catch (e) { return null }
    }
    const patternRe = patternRaw ? patternToRegExp(patternRaw.includes('*') ? patternRaw : `*${patternRaw}*`) : null

    const filtered = airportList.filter(ap => {
      if (airportContinent && (ap.continente || ap.continent || '').toLowerCase() !== airportContinent.toLowerCase()) return false
      if (patternRe) {
        const code = (ap.codigoIATA || ap.id || '').toString()
        if (!patternRe.test(code)) return false
      }
      return true
    })

    const sorted = [...filtered].sort((a, b) => {
      const aOcc = a.currentOccupation ?? a.ocupacionActual ?? 0
      const aCap = a.warehouseCapacity ?? a.capacidadAlmacen ?? 600
      const bOcc = b.currentOccupation ?? b.ocupacionActual ?? 0
      const bCap = b.warehouseCapacity ?? b.capacidadAlmacen ?? 600
      if (airportSortField === 'nextDeparture' || airportSortField === 'nextArrival') {
        const aVal = Date.parse(a[airportSortField])
        const bVal = Date.parse(b[airportSortField])
        const aNull = Number.isNaN(aVal)
        const bNull = Number.isNaN(bVal)
        if (aNull && bNull) return 0
        if (aNull) return 1
        if (bNull) return -1
        return airportSortDir === 'desc' ? bVal - aVal : aVal - bVal
      }
      const diff = (bOcc / bCap) - (aOcc / aCap)
      return airportSortDir === 'desc' ? diff : -diff
    })

    const occupied = showAllAirports
      ? sorted
      : sorted.filter((ap) => (ap.currentOccupation ?? ap.ocupacionActual ?? 0) > 0)
    return { occupiedAirports: occupied, hiddenCount: showAllAirports ? 0 : sorted.length - occupied.length }
  }, [airportList, airportSortDir, airportPattern, airportContinent, airportSortField])

  return (
    <div style={s.panel}>

      {/* ── ACTIVE FLIGHTS ────────────────────────────────────────────── */}
      <div style={{ ...s.sectionPad, flex: '0 0 50%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <span style={s.title}>Vuelos activos</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 6, flex: '1 1 100%', minWidth: 0 }}>
            <input
              value={flightQuery}
              onChange={(e) => setFlightQuery(e.target.value)}
              placeholder="Buscar vuelo, origen, destino… (usa * como wildcard)"
              style={{
                flex: 1, minWidth: 0,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                fontFamily: 'var(--mono)', fontSize: 11,
                padding: '5px 8px', borderRadius: 2, outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, flex: '1 1 100%', marginTop: 6, minWidth: 0, flexDirection: 'column' }}>
            <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
              {[
              { label: 'Origen', value: filterOrigin, set: setFilterOrigin, options: originOptions },
              { label: 'Destino', value: filterDest,   set: setFilterDest,   options: destOptions   },
            ].map(({ label, value, set, options }) => {
            const isDark = theme === 'dark'
            const optBg   = isDark ? '#16171e' : '#ffffff'
            const optText = isDark ? '#e2e8f0' : '#1a202c'
            const optMuted = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.4)'
            return (
              <select
                key={label}
                value={value}
                onChange={(e) => set(e.target.value)}
                style={{
                  flex: '1 1 120px', minWidth: 0,
                  background: isDark ? '#1e2130' : '#f1f5f9',
                  border: `1px solid ${value ? '#3d8bff88' : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)')}`,
                  color: value ? '#60a5fa' : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'),
                  fontFamily: 'var(--mono)', fontSize: 10,
                  padding: '4px 6px', borderRadius: 2, outline: 'none', cursor: 'pointer',
                }}
              >
                <option value="" style={{ background: optBg, color: optMuted }}>{label}</option>
                {options.map(ap => (
                  <option key={ap} value={ap} style={{ background: optBg, color: optText }}>{ap}</option>
                ))}
              </select>
            )
          })}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
                <select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value)}
                  title="Ordenar por"
                  style={{ width: 160, background: theme === 'dark' ? '#1e2130' : '#f1f5f9', border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`, color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 6px', borderRadius: 2, outline: 'none', cursor: 'pointer' }}
                >
                  <option value="occupancy">Ocupación</option>
                  <option value="departureTime">Hora salida</option>
                  <option value="arrivalTime">Hora llegada</option>
                  <option value="origin">Origen</option>
                  <option value="destination">Destino</option>
                </select>
                <button
                  onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                  title={sortDir === 'desc' ? 'Descendente' : 'Ascendente'}
                  style={{ background: 'none', border: '1px solid var(--border)', padding: '4px 8px', cursor: 'pointer', borderRadius: 2, color: 'var(--muted)', fontFamily: 'var(--mono)' }}
                >
                  {sortDir === 'desc' ? '↓' : '↑'}
                </button>
              </div>
            </div>
        </div>
        <div style={s.scrollable}>
          {activeFlights.map((f) => {
            const isSelected = selectedFlight === f.id
            const loadPct    = f.capacity > 0 ? (f.currentLoad / f.capacity) * 100 : 0
            const color      = loadPct === 0 ? '#4d9fff' : loadPct >= 85 ? '#f04b4b' : loadPct >= 60 ? '#f5a623' : '#22d07a'
            return (
              <div key={f.id} style={s.flightItem(isSelected)}
                onClick={() => { setSelectedFlight(isSelected ? null : f.id); if (onVueloClick) onVueloClick(f) }}>
                <div style={s.dot(color)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={s.flightRoute}>{f.origin} → {f.destination}</div>
                  <div style={s.flightMeta}>{f.currentLoad}/{f.capacity} · {f.type === 'continental' ? 'CONT' : 'INT'}</div>
                  <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
                    <div style={{ height: '100%', width: `${Math.min(100, loadPct)}%`, background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
                <div style={s.badge(color)}>{loadPct.toFixed(2)}%</div>
              </div>
            )
          })}
          {activeFlights.length === 0 && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', padding: '12px 0' }}>
              Sin vuelos activos
            </div>
          )}
        </div>
      </div>

      {/* ── ALMACÉN POR AEROPUERTO ────────────────────────────────────── */}
      <div style={{ ...s.sectionPad, flex: '0 0 50%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderTop: '1px solid var(--border)' }}>
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ ...s.title, marginBottom: 0 }}>Almacén por aeropuerto</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <div>
              <input
                value={airportPattern}
                onChange={(e) => setAirportPattern(e.target.value)}
                placeholder="IATA patrón (usa * como wildcard)"
                style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 8px', borderRadius: 2, outline: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={airportContinent}
                onChange={(e) => setAirportContinent(e.target.value)}
                style={{ flex: 1, background: theme === 'dark' ? '#1e2130' : '#f1f5f9', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 8px', borderRadius: 2 }}
              >
                <option value="">Continente</option>
                {[...new Set(airportList.map(a => (a.continente || a.continent || '').toString()).filter(Boolean))].sort().map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
                <select
                  value={airportSortField}
                  onChange={(e) => setAirportSortField(e.target.value)}
                  title="Ordenar aeropuertos por"
                  style={{ flex: 1, background: theme === 'dark' ? '#1e2130' : '#f1f5f9', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 8px', borderRadius: 2 }}
                >
                  <option value="occupation">Ocupación</option>
                  <option value="nextDeparture">Próxima salida</option>
                  <option value="nextArrival">Próxima llegada</option>
                </select>
                <button
                  onClick={() => setAirportSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                  style={{ background: 'none', border: '1px solid var(--border)', padding: '4px 8px', cursor: 'pointer', borderRadius: 2, color: 'var(--muted)', fontFamily: 'var(--mono)' }}
                  title={airportSortDir === 'desc' ? 'Mayor primero' : 'Menor primero'}
                >
                  {airportSortDir === 'desc' ? '↓' : '↑'}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 8 }}>
        {occupiedAirports.map((ap) => {
          const color = warehouseColor(ap, threshold)
          const occ   = ap.currentOccupation ?? ap.ocupacionActual ?? 0
          const cap   = ap.warehouseCapacity ?? ap.capacidadAlmacen ?? 600
          const pct   = cap > 0 ? (occ / cap) * 100 : 0
          return (
            <div key={ap.id} style={s.airportItem}>
              <div style={s.airportHeader}>
                <span style={s.airportName}>{ap.id} — {ap.name}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color }}>{pct.toFixed(2)}%</span>
              </div>
              <div style={s.capBar}>
                <div style={s.capFill(pct, color)} />
              </div>
            </div>
          )
        })}
        {hiddenCount > 0 && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', padding: '8px 0 4px', textAlign: 'center', opacity: 0.6 }}>
            {hiddenCount} aeropuerto{hiddenCount !== 1 ? 's' : ''} sin actividad
          </div>
        )}
        </div>
      </div>

    </div>
  )
}
