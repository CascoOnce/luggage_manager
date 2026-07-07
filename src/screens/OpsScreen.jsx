import React, { useEffect, useMemo, useState } from 'react'
import MapView from '../components/MapView'
import SidePanel from '../components/SidePanel'
import DrawerVuelo from '../drawers/DrawerVuelo'
import DrawerAeropuerto from '../drawers/DrawerAeropuerto'
import { api } from '../services/api.js'

const PULSE_STYLE = `
@keyframes livePulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.6); }
  50% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
}
`

function parseTimeToMinutes(t) {
  if (!t || !t.includes(':')) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function flightFractionAtMinute(now, dep, arr) {
  const total = (arr - dep + 1440) % 1440
  if (total <= 0) return 0
  return Math.max(0, Math.min(1, ((now - dep + 1440) % 1440) / total))
}

function isActiveAtMinute(now, dep, arr) {
  if (dep == null || arr == null) return false
  const m = ((now % 1440) + 1440) % 1440
  // Currently airborne. Overnight flights (dep > arr) wrap past midnight.
  const overnight = dep > arr
  return overnight ? (dep <= m || m <= arr) : (dep <= m && m <= arr)
}

function nowMinutes() {
  // UTC minutes-of-day: backend frames "now" and flight times in UTC.
  const d = new Date()
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60
}

function mod1440(m) {
  return ((m % 1440) + 1440) % 1440
}

export default function OpsScreen({ opsState, opsEnvios = [], theme, onBack, onRefreshOps, onCancelFlight }) {
  const [selectedFlight, setSelectedFlight] = useState(null)
  const [selectedVueloData, setSelectedVueloData] = useState(null)
  
  const [opsBase, setOpsBase] = useState(() => {
    return sessionStorage.getItem('opsBase') || null
  })

  // ── Operations Base state ──────────────────────────────────────────
  const [ingressAirports, setIngressAirports] = useState([])

  function handleSelectBase(baseId) {
    sessionStorage.setItem('opsBase', baseId)
    setOpsBase(baseId)
  }

  function fmtClock12h(huso = null) {
    const d = new Date()
    let local = d
    if (huso !== null) {
      local = new Date(d.getTime() + huso * 3600 * 1000)
    }
    
    const yyyy = huso !== null ? local.getUTCFullYear() : local.getFullYear()
    const month = String((huso !== null ? local.getUTCMonth() : local.getMonth()) + 1).padStart(2, '0')
    const day = String(huso !== null ? local.getUTCDate() : local.getDate()).padStart(2, '0')
    
    const rawH = huso !== null ? local.getUTCHours() : local.getHours()
    const hh = String(rawH % 12 || 12).padStart(2, '0')
    const mm = String(huso !== null ? local.getUTCMinutes() : local.getMinutes()).padStart(2, '0')
    const ss = String(huso !== null ? local.getUTCSeconds() : local.getSeconds()).padStart(2, '0')
    
    return `${yyyy}-${month}-${day} ${hh}:${mm}:${ss} ${rawH >= 12 ? 'p.m.' : 'a.m.'}`
  }

  const [wallClock, setWallClock] = useState(() => fmtClock12h(null))
  const [liveNowMinutes, setLiveNowMinutes] = useState(nowMinutes)
  const [originIds, setOriginIds] = useState(null)
  const [destIds, setDestIds] = useState(null)
  const [selectedAirport, setSelectedAirport] = useState(null)
  const [mapFlyTo, setMapFlyTo] = useState(null)
  const [threshold, setThreshold] = useState(80)
  const [activeSideSection, setActiveSideSection] = useState(null)
  const [highlightedRoute, setHighlightedRoute] = useState(null)
  
  const handleShowEnvioRoute = async (envioId) => {
    try {
      const envio = await api.getOpsEnvioById(envioId)
      // Each escala represents a LEG, keyed by its destination airport (see
      // RouteCandidate.toPlan on the backend) — escalas[i].codigoAeropuerto is
      // where leg i ARRIVES, not a waypoint. The leg's origin is the envío's
      // origin for i=0, or the previous escala's airport otherwise.
      const escalas = [...(envio?.planDetalle?.escalas || [])].sort((a, b) => a.orden - b.orden)
      if (escalas.length === 0) return
      const apMap = Object.fromEntries(airports.map((a) => [a.id, a]))
      const legs = []
      let originIata = envio.aeropuertoOrigen
      for (let i = 0; i < escalas.length; i++) {
        const destIata = escalas[i].codigoAeropuerto
        const o = apMap[originIata]
        const d = apMap[destIata]
        if (o && d) legs.push({ originIata, destIata, originLat: o.lat, originLng: o.lng, destLat: d.lat, destLng: d.lng })
        originIata = destIata
      }
      if (legs.length > 0) {
        setHighlightedRoute({ envioId, legs })
      }
    } catch (e) {
      console.error('handleShowEnvioRoute', e)
    }
  }
  
  // Modal filters
  const [modalSearch, setModalSearch] = useState('')
  const [modalContinent, setModalContinent] = useState('')

  // Keep a ref to the current huso so the interval always uses the latest
  const currentHusoRef = React.useRef(null)
  useEffect(() => {
    if (opsBase && ingressAirports.length > 0) {
      const ap = ingressAirports.find(a => a.id === opsBase)
      currentHusoRef.current = ap ? (ap.huso ?? 0) : null
    } else {
      currentHusoRef.current = null
    }
    // Update immediately when it changes
    setWallClock(fmtClock12h(currentHusoRef.current))
  }, [opsBase, ingressAirports])

  useEffect(() => {
    const id = setInterval(() => setWallClock(fmtClock12h(currentHusoRef.current)), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setLiveNowMinutes(nowMinutes()), 1000)
    return () => clearInterval(id)
  }, [])

  // Fetch airports for OpsEnviosIngress (needs huso field)
  useEffect(() => {
    api.getAirports().then(data => {
      setIngressAirports(data.map(a => ({ id: a.codigoIATA, name: a.nombre, huso: a.huso ?? 0, continent: a.continente })))
    }).catch(() => {})
  }, [])

  const flights = useMemo(() => {
    if (!opsState?.vuelos) return []
    return opsState.vuelos
      .filter((v) => v.estado !== 'cancelado')
      .map((v) => {
        const depLocal = parseTimeToMinutes(v.horaSalida)
        const arrLocal = parseTimeToMinutes(v.horaLlegada)
        const depMin = depLocal // Ya viene en UTC
        const arrMin = arrLocal // Ya viene en UTC
        return {
          id: v.codigoVuelo,
          origin: v.origen,
          destination: v.destino,
          type: v.tipo,
          status: 'active',
          currentLoad: v.cargaActual ?? 0,
          capacity: v.capacidadTotal,
          hour: parseInt(v.horaSalida.split(':')[0], 10),
          horaSalida: v.horaSalida,
          horaLlegada: v.horaLlegada,
          husOrigen: v.husOrigen ?? null,
          husDestino: v.husDestino ?? null,
          depMin,
          arrMin,
          fraction: flightFractionAtMinute(liveNowMinutes, depMin, arrMin),
          enUso: v.enUso ?? false,
          inFlight: v.inFlight ?? false,
        }
      })
      .filter((v) => v.inFlight)
  }, [opsState?.vuelos, liveNowMinutes])

  const plannedFlights = useMemo(() => {
    if (!opsState?.vuelos) return []
    return opsState.vuelos
      .filter((v) => v.estado !== 'cancelado')
      .map((v) => {
        const depLocal = parseTimeToMinutes(v.horaSalida)
        const arrLocal = parseTimeToMinutes(v.horaLlegada)
        const depMin = depLocal // Ya viene en UTC
        const arrMin = arrLocal // Ya viene en UTC
        return {
          id: v.codigoVuelo,
          origin: v.origen,
          destination: v.destino,
          type: v.tipo,
          status: 'planned',
          currentLoad: v.cargaActual ?? 0,
          capacity: v.capacidadTotal,
          hour: parseInt(v.horaSalida.split(':')[0], 10),
          horaSalida: v.horaSalida,
          horaLlegada: v.horaLlegada,
          husOrigen: v.husOrigen ?? null,
          husDestino: v.husDestino ?? null,
          depMin,
          arrMin,
          fraction: 0,
          enUso: v.enUso ?? false,
          inFlight: v.inFlight ?? false,
        }
      })
      .filter((v) => !v.inFlight)
  }, [opsState?.vuelos, liveNowMinutes])

  const originSet = useMemo(() => originIds ? new Set(originIds) : null, [originIds])
  const destSet = useMemo(() => destIds ? new Set(destIds) : null, [destIds])

  const visibleFlights = useMemo(() =>
    flights.filter((f) =>
      (!originSet || originSet.has(f.origin)) &&
      (!destSet || destSet.has(f.destination))
    ),
  [flights, originSet, destSet])

  const visiblePlannedFlights = useMemo(() =>
    plannedFlights.filter((f) =>
      (!originSet || originSet.has(f.origin)) &&
      (!destSet || destSet.has(f.destination))
    ),
  [plannedFlights, originSet, destSet])

  const airports = useMemo(() => {
    if (!opsState?.aeropuertos) return []
    
    const nextDep = {}
    const nextArr = {}
    const depFlightsConsidered = {}
    const arrFlightsConsidered = {}
    
    const simStartedAt = parseInt(localStorage.getItem('simDayStartedAt') || '0', 10)
    const simStartMinute = parseInt(localStorage.getItem('simHoraInicio') || '0', 10)
    const isDayOne = simStartedAt > 0 && (Date.now() - simStartedAt) < 24 * 60 * 60 * 1000

    const allOpsFlights = [...visibleFlights, ...visiblePlannedFlights]
    allOpsFlights.forEach(v => {
      const utcDepMin = v.depMin
      const utcArrMin = v.arrMin

      let waitDep = null
      let waitArr = null

      if (utcDepMin != null) {
        let excludeDep = false
        if (isDayOne && utcDepMin < simStartMinute) {
          excludeDep = true
        }
        if (!excludeDep) {
          waitDep = Math.floor((utcDepMin - liveNowMinutes + 1440) % 1440)
          if (!depFlightsConsidered[v.origin]) depFlightsConsidered[v.origin] = []
          depFlightsConsidered[v.origin].push({ id: v.id, time: v.horaSalida, wait: waitDep })
          if (nextDep[v.origin] === undefined || waitDep < nextDep[v.origin]) {
             nextDep[v.origin] = waitDep
          }
        }
      }
      
      if (utcArrMin != null) {
        let excludeArr = false
        if (utcDepMin != null) {
          if (isDayOne && utcDepMin < utcArrMin && utcArrMin < simStartMinute) {
            excludeArr = true
          }
        }
        
        if (!excludeArr) {
          // Solo si ya partió (está en el aire)
          if (isActiveAtMinute(liveNowMinutes, utcDepMin, utcArrMin)) {
            waitArr = Math.floor((utcArrMin - liveNowMinutes + 1440) % 1440)
            if (!arrFlightsConsidered[v.destination]) arrFlightsConsidered[v.destination] = []
            arrFlightsConsidered[v.destination].push({ id: v.id, time: v.horaLlegada, wait: waitArr })
            if (nextArr[v.destination] === undefined || waitArr < nextArr[v.destination]) {
               nextArr[v.destination] = waitArr
            }
          }
        }
      }
    })

    return opsState.aeropuertos.map((a) => ({
      id: a.codigoIATA,
      name: a.nombre,
      continent: a.continente,
      lat: a.lat,
      lng: a.lng,
      warehouseCapacity: a.capacidadAlmacen ?? 600,
      currentOccupation: a.ocupacionPct != null
        ? Math.round((a.ocupacionPct / 100) * (a.capacidadAlmacen ?? 600))
        : 0,
      maletasPendientes: a.maletasPendientes,
      semaforo: a.semaforo,
      ciudad: a.ciudad,
      nextDepartureWait: nextDep[a.codigoIATA] ?? Infinity,
      nextArrivalWait: nextArr[a.codigoIATA] ?? Infinity,
      debugDep: depFlightsConsidered[a.codigoIATA] || [],
      debugArr: arrFlightsConsidered[a.codigoIATA] || [],
    }))
  }, [opsState?.aeropuertos, visibleFlights, visiblePlannedFlights, liveNowMinutes])



  const cancelledFlights = useMemo(() => {
    if (!opsState?.cancelaciones) return []
    const vuelosMap = new Map((opsState?.vuelos || []).map(v => [v.codigoVuelo, v]))
    return opsState.cancelaciones.map(c => {
      const v = vuelosMap.get(c.codigoVuelo)
      return {
        id: c.codigoVuelo,
        uid: c.id,
        origin: v?.origen || '?',
        destination: v?.destino || '?',
        type: v?.tipo,
        status: 'cancelled',
        capacity: v?.capacidadTotal ?? 0,
        currentLoad: c.maletasAfectadas ?? 0,
        fecha: c.fecha,
        hora: c.hora,
        horaSalida: v?.horaSalida,
        horaLlegada: v?.horaLlegada,
        motivo: c.motivo,
        isCancelled: true
      }
    }).reverse() // Show newest first
  }, [opsState?.cancelaciones, opsState?.vuelos])

  const visibleAirports = useMemo(() => {
    if (!originSet && !destSet) return airports
    const visible = new Set()
    for (const ap of airports) {
      if (!originSet || originSet.has(ap.id)) visible.add(ap.id)
      if (!destSet || destSet.has(ap.id)) visible.add(ap.id)
    }
    return airports.filter((a) => visible.has(a.id))
  }, [airports, originSet, destSet])


  const visibleCancelledFlights = useMemo(() =>
    cancelledFlights.filter((f) =>
      (!originSet || originSet.has(f.origin)) &&
      (!destSet || destSet.has(f.destination))
    ),
  [cancelledFlights, originSet, destSet])

  const selectedFlightData = useMemo(() => {
    const foundActive = visibleFlights.find((f) => f.id === selectedFlight)
    if (foundActive) return foundActive
    const foundPlanned = visiblePlannedFlights.find((f) => f.id === selectedFlight)
    if (foundPlanned) return foundPlanned
    return visibleCancelledFlights.find((f) => f.id === selectedFlight) ?? null
  }, [visibleFlights, visiblePlannedFlights, visibleCancelledFlights, selectedFlight])

  function handleCloseVuelo() {
    setSelectedFlight(null)
    setSelectedVueloData(null)
    setHighlightedRoute(null)
  }

  useEffect(() => {
    setSelectedVueloData(selectedFlightData)
  }, [selectedFlightData])

  const opsSideState = useMemo(() => ({
    envios: (opsEnvios || []).map((e) => ({
      idEnvio: e.idEnvio ?? e.idPedido,
      aeropuertoOrigen: e.aeropuertoOrigen ?? e.iataOrigen,
      aeropuertoDestino: e.aeropuertoDestino ?? e.iataDestino,
      codigoAerolinea: e.codigoAerolinea ?? '--',
      estado: e.estado,
      cantidadMaletas: e.cantidadMaletas,
      sla: e.sla,
      planResumen: e.planResumen ?? null,
      planDetalle: e.planDetalle ?? null,
    })),
  }), [opsEnvios])

  if (!opsState) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '12px', color: 'var(--text-secondary, #888)', fontSize: '16px' }}>
        <div style={{ width: '32px', height: '32px', border: '3px solid var(--border, #444)', borderTopColor: '#22c55e', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        Cargando operaciones...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <style>{PULSE_STYLE}</style>

      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 16px', borderBottom: '1px solid var(--border, #333)', background: 'var(--panel, #1a1a1a)', flexShrink: 0 }}>
        {onBack && (
          <button onClick={onBack} style={{ background: 'none', border: '1px solid var(--border, #444)', borderRadius: '4px', color: 'var(--text, #eee)', cursor: 'pointer', padding: '3px 10px', fontSize: '15px', marginRight: '6px' }}>
            ← Volver
          </button>
        )}
        <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e', animation: 'livePulse 2s ease-in-out infinite', flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: '15px', color: '#22c55e', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>OPERACIONES {opsBase ? `— ${opsBase}` : ''}</span>
          {opsBase && (
            <button 
              onClick={() => { sessionStorage.removeItem('opsBase'); setOpsBase(null); }}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--muted)', borderRadius: 4, padding: '2px 8px', fontSize: '12px', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: 0.5 }}
              title="Cambiar Base de Operaciones"
            >
              Cambiar Base
            </button>
          )}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '15px', color: 'var(--text-secondary, #888)', fontVariantNumeric: 'tabular-nums' }}>{wallClock}</span>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, position: 'relative' }}>
        
        <div style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: activeSideSection ? 412 : 52,
          transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}>
          {/* Map Layer */}
          <MapView
            airports={visibleAirports}
            flights={visibleFlights}
            selectedFlight={selectedFlight}
            setSelectedFlight={setSelectedFlight}
            selectedFlightData={selectedFlightData}
            onAirportClick={(ap) => { setSelectedAirport(ap); setMapFlyTo(ap) }}
            onMapClick={() => {
              setSelectedAirport(null)
              setSelectedFlight(null)
              setHighlightedRoute(null)
            }}
            theme="dark"
            highlightedRoute={highlightedRoute}
            flyToTarget={mapFlyTo}
          />
        </div>

          <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, zIndex: 500, display: 'flex' }}>
            <SidePanel
              mode="ops"
              activeSection={activeSideSection}
              onSectionChange={setActiveSideSection}
              flights={visibleFlights}
              plannedFlights={visiblePlannedFlights}
              cancelledFlights={visibleCancelledFlights}
              selectedFlight={selectedFlight}
              setSelectedFlight={setSelectedFlight}
              setMapSelectedVuelo={setSelectedVueloData}
              simState={opsSideState}
              nowMin={liveNowMinutes}
              airports={airports}
              threshold={threshold}
              setThreshold={setThreshold}
              originIds={originIds}
              setOriginIds={setOriginIds}
              destIds={destIds}
              setDestIds={setDestIds}
              theme={theme}
              opsIngressAirports={ingressAirports}
              onOpsEnviosChanged={onRefreshOps || (() => {})}
              opsBase={opsBase}
              onShowEnvioRoute={handleShowEnvioRoute}
              onFocusMapLocation={setMapFlyTo}
              setMapSelectedAirport={(ap) => { setSelectedAirport(ap); setMapFlyTo(ap) }}
            />
          </div>

          <DrawerVuelo
            vuelo={selectedVueloData}
            onClose={handleCloseVuelo}
            onCancelFlight={onCancelFlight}
            fetchEnvios={api.getOpsEnviosByFlight}
          />
          <DrawerAeropuerto
            airport={selectedAirport}
            vuelos={visibleFlights}
            onClose={() => setSelectedAirport(null)}
            fetchInventory={api.getOpsAirportInventory}
          />
      </div>

      {/* Base Selection Modal */}
      {!opsBase && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(13,17,23,0.95)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#161b22', border: '1px solid var(--border)', borderRadius: 8, padding: 24, width: 400, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 18, color: 'var(--text-bright)', letterSpacing: 1 }}>BASE DE OPERACIONES</h2>
              {onBack && (
                <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text)', cursor: 'pointer', padding: '4px 10px', fontSize: '13px', fontFamily: 'var(--mono)', textTransform: 'uppercase', flexShrink: 0 }}>
                  ← Volver
                </button>
              )}
            </div>
            
            <p style={{ margin: '0 0 16px 0', fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--muted)', lineHeight: 1.4 }}>
              Seleccione el aeropuerto desde el cual estará despachando envíos en esta sesión.
            </p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input 
                type="text" 
                placeholder="Buscar IATA o Nombre..." 
                value={modalSearch}
                onChange={e => setModalSearch(e.target.value)}
                style={{ flex: 1, background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 14, padding: '8px', borderRadius: 4, outline: 'none' }}
              />
              <select 
                value={modalContinent} 
                onChange={e => setModalContinent(e.target.value)}
                style={{ width: 120, background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 14, padding: '8px', borderRadius: 4, outline: 'none', appearance: 'none', WebkitAppearance: 'none' }}
              >
                <option value="" style={{ background: '#161b22', color: 'var(--text)' }}>Continente</option>
                {[...new Set(ingressAirports.map(a => a.continent).filter(Boolean))].sort().map(c => (
                  <option key={c} value={c} style={{ background: '#161b22', color: 'var(--text)' }}>{c}</option>
                ))}
              </select>
            </div>

            <div className="thick-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflowY: 'auto', paddingRight: 8, margin: '0 -4px' }}>
              <style>{`
                .thick-scrollbar::-webkit-scrollbar { width: 8px; }
                .thick-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); border-radius: 4px; }
                .thick-scrollbar::-webkit-scrollbar-thumb { background: rgba(99, 152, 255, 0.4); border-radius: 4px; }
                .thick-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(61, 139, 255, 0.6); }
              `}</style>
              {ingressAirports
                .filter(ap => {
                  if (modalContinent && ap.continent !== modalContinent) return false
                  if (modalSearch) {
                    const q = modalSearch.toLowerCase()
                    return ap.id.toLowerCase().includes(q) || ap.name.toLowerCase().includes(q)
                  }
                  return true
                })
                .map(ap => (
                <button
                  key={ap.id}
                  onClick={() => handleSelectBase(ap.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left', flexShrink: 0
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.1)'; e.currentTarget.style.borderColor = 'rgba(34,197,94,0.3)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                >
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: '#22c55e', width: 40 }}>{ap.id}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ap.name}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{ap.continent} • UTC{ap.huso >= 0 ? '+' : ''}{ap.huso}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
