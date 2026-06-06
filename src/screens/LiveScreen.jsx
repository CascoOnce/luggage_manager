import React, { useEffect, useMemo, useState } from 'react'
import MapView from '../components/MapView'
import RightPanel from '../components/RightPanel'
import AirportFilterPanel from '../components/AirportFilterPanel'
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
  const m = now >= 1440 ? 1439 : now
  return arr > dep ? (m >= dep && m < arr) : (m >= dep || m < arr)
}

function nowMinutes() {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

export default function LiveScreen({ liveState, theme, onBack }) {
  const [selectedFlight, setSelectedFlight] = useState(null)
  const [selectedVueloData, setSelectedVueloData] = useState(null)
  const [wallClock, setWallClock] = useState(() => new Date().toLocaleTimeString('es-PE'))
  const [liveNowMinutes, setLiveNowMinutes] = useState(nowMinutes)
  const [originIds, setOriginIds] = useState(null)
  const [destIds, setDestIds] = useState(null)
  const [selectedAirport, setSelectedAirport] = useState(null)
  const [threshold, setThreshold] = useState(80)
  const [filterOpen, setFilterOpen] = useState(true)

  useEffect(() => {
    const id = setInterval(() => setWallClock(new Date().toLocaleTimeString('es-PE')), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setLiveNowMinutes(nowMinutes()), 5000)
    return () => clearInterval(id)
  }, [])

  const airports = useMemo(() => {
    if (!liveState?.aeropuertos) return []
    return liveState.aeropuertos.map((a) => ({
      id: a.codigoIATA,
      name: a.nombre,
      continent: a.continente,
      lat: a.lat,
      lng: a.lng,
      // backend may return both `maletasPendientes` (absolute) and `ocupacionPct` (percentage)
      // compute a sane `currentOccupation` (absolute) and ensure capacity is provided
      warehouseCapacity: a.capacidadAlmacen ?? 600,
      currentOccupation: (a.maletasPendientes != null)
        ? a.maletasPendientes
        : (a.ocupacionPct != null ? Math.round((a.ocupacionPct / 100) * (a.capacidadAlmacen ?? 600)) : 0),
      maletasPendientes: a.maletasPendientes,
      semaforo: a.semaforo,
      ciudad: a.ciudad,
    }))
  }, [liveState?.aeropuertos])

  const flights = useMemo(() => {
    if (!liveState?.vuelos) return []
    return liveState.vuelos
      .map((v) => {
        const depMin = parseTimeToMinutes(v.horaSalida)
        const arrMin = parseTimeToMinutes(v.horaLlegada)
        const cap = v.capacidadTotal ?? v.capacity ?? 300
        const fraction = (typeof v.fraction === 'number') ? v.fraction : flightFractionAtMinute(liveNowMinutes, depMin, arrMin)
        const currentLoad = v.cargaActual ?? v.currentLoad ?? (Math.round(fraction * cap))
        return {
          id: v.codigoVuelo,
          origin: v.origen,
          destination: v.destino,
          type: v.tipo,
          status: 'active',
          currentLoad: null,
          capacity: v.capacidadTotal,
          hour: parseInt(v.horaSalida.split(':')[0], 10),
          horaSalida: v.horaSalida,
          horaLlegada: v.horaLlegada,
          husOrigen: v.husOrigen ?? null,
          depMin,
          arrMin,
          fraction: flightFractionAtMinute(liveNowMinutes, depMin, arrMin),
        }
      })
      .filter((v) => isActiveAtMinute(liveNowMinutes, v.depMin, v.arrMin))
  }, [liveState?.vuelos, liveNowMinutes])

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

  function handleVueloClick(f) {
    setSelectedFlight(f.id)
    setSelectedVueloData(f)
  }

  function handleCloseVuelo() {
    setSelectedFlight(null)
    setSelectedVueloData(null)
  }

  async function handleCancelLiveFlight(codigoVuelo) {
    try {
      await api.cancelLiveFlight(codigoVuelo)
      handleCloseVuelo()
    } catch (err) {
      alert('Error al cancelar vuelo: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  // Sync the detailed vuelo state with the selection computed from visibleFlights
  useEffect(() => {
    setSelectedVueloData(selectedFlightData)
  }, [selectedFlightData])

  if (!liveState) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '12px', color: 'var(--text-secondary, #888)', fontSize: '14px' }}>
        <div style={{ width: '32px', height: '32px', border: '3px solid var(--border, #444)', borderTopColor: '#22c55e', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        Cargando datos en vivo...
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
        <span style={{ fontWeight: 700, fontSize: '13px', color: '#22c55e', letterSpacing: '0.08em' }}>EN VIVO</span>
        <span style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--text-secondary, #888)', fontVariantNumeric: 'tabular-nums' }}>{wallClock}</span>
      </div>

      {/* 3-column grid: filter | map | right panel */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: `${filterOpen ? '232px' : '0px'} 1fr 300px`,
        overflow: 'hidden',
        minHeight: 0,
        transition: 'grid-template-columns 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        {/* Left filter panel */}
        <div style={{ overflow: 'hidden', height: '100%', borderRight: filterOpen ? '1px solid var(--border)' : 'none', background: 'var(--panel)' }}>
          <AirportFilterPanel
            airports={airports}
            originIds={originIds}
            setOriginIds={setOriginIds}
            destIds={destIds}
            setDestIds={setDestIds}
            threshold={threshold}
            setThreshold={setThreshold}
          />
        </div>

        {/* Map */}
        <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
          <button
            onClick={() => setFilterOpen(!filterOpen)}
            style={{
              position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
              zIndex: 1000, width: 24, height: 48, background: 'rgba(13,17,23,0.85)',
              border: '1px solid var(--border)', borderLeft: 'none', borderRadius: '0 8px 8px 0',
              color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
            }}
          >
            {filterOpen ? '‹' : '›'}
          </button>

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

          <DrawerVuelo
            vuelo={selectedVueloData}
            onClose={handleCloseVuelo}
            onCancelFlight={handleCancelLiveFlight}
          />
          <DrawerAeropuerto
            airport={selectedAirport}
            vuelos={visibleFlights}
            onClose={() => setSelectedAirport(null)}
          />
        </div>

        {/* Right panel */}
        <div style={{ borderLeft: '1px solid var(--border, #333)', background: 'var(--panel, #1a1a1a)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <RightPanel
            flights={visibleFlights}
            airports={visibleAirports}
            threshold={threshold}
            selectedFlight={selectedFlight}
            setSelectedFlight={setSelectedFlight}
            onVueloClick={handleVueloClick}
            showAllAirports
          />
        </div>
      </div>
    </div>
  )
}
