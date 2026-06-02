import React, { useEffect, useMemo, useState } from 'react'
import MapView from '../components/MapView'
import RightPanel from '../components/RightPanel'

const PULSE_STYLE = `
@keyframes livePulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.6); }
  50% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
}
`

export default function LiveScreen({ liveState, theme, onBack }) {
  const [selectedFlight, setSelectedFlight] = useState(null)
  const [wallClock, setWallClock] = useState(() => new Date().toLocaleTimeString('es-PE'))

  useEffect(() => {
    const id = setInterval(() => setWallClock(new Date().toLocaleTimeString('es-PE')), 1000)
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
      currentOccupation: a.ocupacionPct,
      warehouseCapacity: a.capacidadAlmacen,
      maletasPendientes: a.maletasPendientes,
      semaforo: a.semaforo,
      ciudad: a.ciudad,
    }))
  }, [liveState?.aeropuertos])

  const flights = useMemo(() => {
    if (!liveState?.vuelos) return []
    return liveState.vuelos.map((v) => ({
      id: v.codigoVuelo,
      origin: v.origen,
      destination: v.destino,
      type: v.tipo,
      status: 'active',
      currentLoad: 0,
      capacity: v.capacidadTotal,
      hour: parseInt(v.horaSalida.split(':')[0], 10),
      fraction: v.fraction,
      horaSalida: v.horaSalida,
      horaLlegada: v.horaLlegada,
    }))
  }, [liveState?.vuelos])

  const selectedFlightData = useMemo(
    () => flights.find((f) => f.id === selectedFlight) ?? null,
    [flights, selectedFlight]
  )

  if (!liveState) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          flexDirection: 'column',
          gap: '12px',
          color: 'var(--text-secondary, #888)',
          fontSize: '14px',
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            border: '3px solid var(--border, #444)',
            borderTopColor: '#22c55e',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        Cargando datos en vivo...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <style>{PULSE_STYLE}</style>

      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border, #333)',
          background: 'var(--panel, #1a1a1a)',
          flexShrink: 0,
        }}
      >
        {onBack && (
          <button
            onClick={onBack}
            style={{
              background: 'none',
              border: '1px solid var(--border, #444)',
              borderRadius: '4px',
              color: 'var(--text, #eee)',
              cursor: 'pointer',
              padding: '3px 10px',
              fontSize: '13px',
              marginRight: '6px',
            }}
          >
            ← Volver
          </button>
        )}
        <span
          style={{
            display: 'inline-block',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: '#22c55e',
            animation: 'livePulse 2s ease-in-out infinite',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontWeight: 700,
            fontSize: '13px',
            color: '#22c55e',
            letterSpacing: '0.08em',
          }}
        >
          EN VIVO
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '13px',
            color: 'var(--text-secondary, #888)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {wallClock}
        </span>
      </div>

      {/* Main content: map + right panel */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 300px',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        <MapView
          airports={airports}
          flights={flights}
          selectedFlight={selectedFlight}
          setSelectedFlight={setSelectedFlight}
          selectedFlightData={selectedFlightData}
          onAirportClick={() => {}}
          onMapClick={() => setSelectedFlight(null)}
          theme={theme}
        />
        <div
          style={{
            borderLeft: '1px solid var(--border, #333)',
            background: 'var(--panel, #1a1a1a)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <RightPanel
            flights={flights}
            airports={airports}
            threshold={80}
            selectedFlight={selectedFlight}
            setSelectedFlight={setSelectedFlight}
            onVueloClick={setSelectedFlight}
          />
        </div>
      </div>
    </div>
  )
}
