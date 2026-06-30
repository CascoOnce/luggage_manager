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

export default function OpsScreen({ opsState, opsEnvios = [], theme, onBack, onRefreshOps }) {
  const [selectedFlight, setSelectedFlight] = useState(null)
  const [selectedVueloData, setSelectedVueloData] = useState(null)
  function fmtClock12h() {
    const n = new Date()
    const rawH = n.getHours()
    const hh = String(rawH % 12 || 12).padStart(2, '0')
    const mm = String(n.getMinutes()).padStart(2, '0')
    const ss = String(n.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss} ${rawH >= 12 ? 'p.m.' : 'a.m.'}`
  }
  const [wallClock, setWallClock] = useState(fmtClock12h)
  const [liveNowMinutes, setLiveNowMinutes] = useState(nowMinutes)
  const [originIds, setOriginIds] = useState(null)
  const [destIds, setDestIds] = useState(null)
  const [selectedAirport, setSelectedAirport] = useState(null)
  const [threshold, setThreshold] = useState(80)
  const [activeSideSection, setActiveSideSection] = useState(null)
  const [ingressAirports, setIngressAirports] = useState([])

  useEffect(() => {
    const id = setInterval(() => setWallClock(fmtClock12h()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setLiveNowMinutes(nowMinutes()), 1000)
    return () => clearInterval(id)
  }, [])

  // Fetch airports for OpsEnviosIngress (needs huso field)
  useEffect(() => {
    api.getAirports().then(data => {
      setIngressAirports(data.map(a => ({ id: a.codigoIATA, name: a.nombre, huso: a.huso ?? 0 })))
    }).catch(() => {})
  }, [])

  const airports = useMemo(() => {
    if (!opsState?.aeropuertos) return []
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
    }))
  }, [opsState?.aeropuertos])

  const flights = useMemo(() => {
    if (!opsState?.vuelos) return []
    return opsState.vuelos
      .map((v) => {
        const depLocal = parseTimeToMinutes(v.horaSalida)
        const arrLocal = parseTimeToMinutes(v.horaLlegada)
        // Flight times are origin/destination local; convert both ends to UTC.
        const depMin = depLocal != null ? mod1440(depLocal - (v.husOrigen ?? 0) * 60) : null
        const arrMin = arrLocal != null ? mod1440(arrLocal - (v.husDestino ?? 0) * 60) : null
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
        }
      })
      .filter((v) => isActiveAtMinute(liveNowMinutes, v.depMin, v.arrMin))
  }, [opsState?.vuelos, liveNowMinutes])

  const originSet = useMemo(() => originIds ? new Set(originIds) : null, [originIds])
  const destSet = useMemo(() => destIds ? new Set(destIds) : null, [destIds])

  const visibleAirports = useMemo(() => {
    if (!originSet && !destSet) return airports
    const visible = new Set()
    for (const ap of airports) {
      if (!originSet || originSet.has(ap.id)) visible.add(ap.id)
      if (!destSet || destSet.has(ap.id)) visible.add(ap.id)
    }
    return airports.filter((a) => visible.has(a.id))
  }, [airports, originSet, destSet])

  const visibleFlights = useMemo(() =>
    flights.filter((f) =>
      (!originSet || originSet.has(f.origin)) &&
      (!destSet || destSet.has(f.destination))
    ),
  [flights, originSet, destSet])

  const selectedFlightData = useMemo(
    () => visibleFlights.find((f) => f.id === selectedFlight) ?? null,
    [visibleFlights, selectedFlight]
  )

  function handleCloseVuelo() {
    setSelectedFlight(null)
    setSelectedVueloData(null)
  }

  useEffect(() => {
    setSelectedVueloData(selectedFlightData)
  }, [selectedFlightData])

  const opsSideState = useMemo(() => ({
    envios: (opsEnvios || []).map((e) => ({
      idEnvio: e.idPedido,
      aeropuertoOrigen: e.iataOrigen,
      aeropuertoDestino: e.iataDestino,
      estado: e.estado,
      cantidadMaletas: e.cantidadMaletas,
      sla: e.sla,
    })),
  }), [opsEnvios])

  if (!opsState) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '12px', color: 'var(--text-secondary, #888)', fontSize: '14px' }}>
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
          <button onClick={onBack} style={{ background: 'none', border: '1px solid var(--border, #444)', borderRadius: '4px', color: 'var(--text, #eee)', cursor: 'pointer', padding: '3px 10px', fontSize: '13px', marginRight: '6px' }}>
            ← Volver
          </button>
        )}
        <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e', animation: 'livePulse 2s ease-in-out infinite', flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: '13px', color: '#22c55e', letterSpacing: '0.08em' }}>OPERACIONES</span>
        <span style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--text-secondary, #888)', fontVariantNumeric: 'tabular-nums' }}>{wallClock}</span>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, position: 'relative' }}>
        <div style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: activeSideSection ? 372 : 52,
          transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}>
          <MapView
            airports={visibleAirports}
            flights={visibleFlights}
            selectedFlight={selectedFlight}
            setSelectedFlight={setSelectedFlight}
            selectedFlightData={selectedFlightData}
            onAirportClick={setSelectedAirport}
            onMapClick={handleCloseVuelo}
            theme={theme}
          />
        </div>

          <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, zIndex: 500, display: 'flex' }}>
            <SidePanel
              mode="ops"
              activeSection={activeSideSection}
              onSectionChange={setActiveSideSection}
              flights={visibleFlights}
              selectedFlight={selectedFlight}
              setSelectedFlight={setSelectedFlight}
              setMapSelectedVuelo={setSelectedVueloData}
              simState={opsSideState}
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
            />
          </div>

          <DrawerVuelo
            vuelo={selectedVueloData}
            onClose={handleCloseVuelo}
            onCancelFlight={null}
          />
          <DrawerAeropuerto
            airport={selectedAirport}
            vuelos={visibleFlights}
            onClose={() => setSelectedAirport(null)}
            fetchInventory={api.getOpsAirportInventory}
          />
      </div>
    </div>
  )
}
