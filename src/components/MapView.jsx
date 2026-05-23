import React, { useEffect, useMemo } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MapContainer, TileLayer, Tooltip, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { CiAirportSign1 } from 'react-icons/ci'
import { FaMapMarker } from 'react-icons/fa'

const AIRPORT_BOUNDS = [[-40, -85], [60, 82]]
const SNAP_THRESHOLD_PX = 200

// Keeps the airport bounding box always filling the container.
// On each resize: invalidate size, recalculate the minimum zoom so the
// bounds fit exactly, then clamp current zoom if needed.
function FitAirportBounds() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()

    const fit = () => {
      map.invalidateSize()
      if (container.clientWidth === 0 || container.clientHeight === 0) return
      const minZ = map.getBoundsZoom(AIRPORT_BOUNDS, false)
      if (!isFinite(minZ) || minZ <= 0) return
      map.setMinZoom(Math.min(minZ, map.getMaxZoom()))
      if (map.getZoom() < minZ) {
        map.fitBounds(AIRPORT_BOUNDS, { animate: false })
      }
    }

    const t = setTimeout(fit, 0)
    const observer = new ResizeObserver(fit)
    observer.observe(container)
    return () => { clearTimeout(t); observer.disconnect() }
  }, [map])
  return null
}

function MapResizer() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    const observer = new ResizeObserver(() => { map.invalidateSize() })
    observer.observe(container)
    map.invalidateSize()
    return () => observer.disconnect()
  }, [map])
  return null
}

// Scales .airport-pin elements via CSS transform as zoom changes (no DivIcon recreation)
function IconScaler() {
  const map = useMap()
  useEffect(() => {
    const update = () => {
      const minZ = map.getMinZoom()
      const maxZ = map.getMaxZoom()
      const z    = map.getZoom()
      const t    = maxZ > minZ ? (z - minZ) / (maxZ - minZ) : 0
      const scale = 1 + t * 0.3
      map.getContainer().querySelectorAll('.airport-pin').forEach((el) => {
        el.style.transform = `scale(${scale.toFixed(3)})`
      })
    }
    map.on('zoom', update)
    map.on('zoomend', update)
    update()
    return () => { map.off('zoom', update); map.off('zoomend', update) }
  }, [map])
  return null
}

// On wheel zoom-in, nudges the map center toward the nearest airport if within threshold.
// Does NOT intercept the scroll — Leaflet handles zoom naturally, we only reposition.
function ZoomSnapper({ airportList }) {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    const onWheel = (e) => {
      if (e.deltaY >= 0) return  // zoom out — no snap
      const rect = container.getBoundingClientRect()
      const cursorPx = L.point(e.clientX - rect.left, e.clientY - rect.top)
      let nearest = null
      let nearestDist = Infinity
      airportList.forEach((ap) => {
        const apPx = map.latLngToContainerPoint([ap.lat, ap.lng])
        const dx = apPx.x - cursorPx.x
        const dy = apPx.y - cursorPx.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < nearestDist) { nearestDist = dist; nearest = ap }
      })
      if (nearest && nearestDist <= SNAP_THRESHOLD_PX) {
        // Shift center smoothly toward the nearest airport without blocking the scroll
        requestAnimationFrame(() => {
          map.panTo([nearest.lat, nearest.lng], { animate: true, duration: 0.3 })
        })
      }
    }
    container.addEventListener('wheel', onWheel, { passive: true })
    return () => container.removeEventListener('wheel', onWheel)
  }, [map, airportList])
  return null
}

const airportIndex = (airports) =>
  Object.fromEntries(airports.map((a) => [a.id, a]))

function occupancyPct(ap) {
  return Math.round((ap.currentOccupation / ap.warehouseCapacity) * 100)
}

// FaMapMarker viewBox: 384×512 (ratio 3:4). react-icons sets width/height as HTML attrs
// overriding any CSS — must strip them before applying correct dimensions (24×32).
// Pin tip: center-x=12, bottom-y=32. iconAnchor=[12,32].
function makeAirportIcon(theme) {
  const pinColor = theme === 'light' ? '#1a6fd4' : '#4d9fff'
  const markerSvg = renderToStaticMarkup(React.createElement(FaMapMarker, { size: 20, color: pinColor }))
  const signSvg   = renderToStaticMarkup(React.createElement(CiAirportSign1, { size: 16, color: '#fff' }))
  const pinHtml = markerSvg
    .replace(/\sheight="[^"]*"/, '')
    .replace(/\swidth="[^"]*"/, '')
    .replace('<svg ', '<svg style="width:20px;height:27px;display:block;" ')
  return L.divIcon({
    className: '',
    html: `<div class="airport-pin" style="position:relative;width:20px;height:27px;transform-origin:50% 100%;">${pinHtml}<div style="position:absolute;top:3px;left:50%;transform:translateX(-50%);">${signSvg}</div></div>`,
    iconSize: [20, 27],
    iconAnchor: [10, 25],
  })
}

// Linearly interpolate position along origin→destination
function lerpPos(originAp, destAp, fraction) {
  if (!originAp || !destAp) return null
  return [
    originAp.lat + (destAp.lat - originAp.lat) * fraction,
    originAp.lng + (destAp.lng - originAp.lng) * fraction,
  ]
}

function flightBearing(originAp, destAp) {
  if (!originAp || !destAp) return 0
  const lat1 = (originAp.lat * Math.PI) / 180
  const lat2 = (destAp.lat * Math.PI) / 180
  const dLng = ((destAp.lng - originAp.lng) * Math.PI) / 180

  const y = Math.sin(dLng) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)

  const bearingFromNorth = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  // SVG points north (up), rotation = bearing from north directly.
  return bearingFromNorth
}

function makeDivIcon(selected, angle, theme) {
  const color = selected
    ? (theme === 'light' ? '#0553b1' : '#74b3ff')
    : (theme === 'light' ? '#0969da' : '#4d9fff')
  const shadow = selected ? `drop-shadow(0 0 4px ${color})` : 'none'
  return L.divIcon({
    className: '',
    html: `<div class="flight-plane${selected ? ' flight-plane-selected' : ''}" style="transform:rotate(${angle}deg);filter:${shadow};transition:filter 0.2s"><svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg"><path fill="${color}" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

export default function MapView({
  airports, flights,
  selectedFlight, setSelectedFlight,
  onAirportClick,
  theme = 'dark',
}) {
  const airportList = airports || []
  const flightList = flights || []

  const apIdx = useMemo(() => airportIndex(airportList), [airportList])

  // Only show active (non-cancelled) flights on map
  const activeFlights = flightList.filter((f) => f.status === 'active')

  return (
    <MapContainer
      center={[20, 0]} zoom={3} minZoom={1} maxZoom={7}
      zoomSnap={0.1} zoomDelta={0.5}
      maxBounds={[[-50, -90], [65, 90]]}
      maxBoundsViscosity={1.0}
      style={{ width: '100%', height: '100%', background: '#060606' }}
      zoomControl={false} attributionControl={false}
    >
      <FitAirportBounds />
      <MapResizer />
      <IconScaler />
      <ZoomSnapper airportList={airportList} />
      <TileLayer
        url={theme === 'light'
          ? 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png'
          : 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'}
        subdomains="abcd" maxZoom={19} noWrap={true}
      />

      {/* ── ANIMATED FLIGHT MARKERS ──────────────────────────────────────── */}
      {activeFlights.map((flight) => {
        const a = apIdx[flight.origin], b = apIdx[flight.destination]
        const pos = lerpPos(a, b, flight.fraction)
        if (!pos) return null
        const isSelected = selectedFlight === flight.id
        const icon = makeDivIcon(isSelected, flightBearing(a, b), theme)
        return (
          <Marker
            key={`fm-${flight.id}-${isSelected ? 'sel' : 'norm'}`}
            position={pos}
            icon={icon}
            eventHandlers={{ click: () => setSelectedFlight(isSelected ? null : flight.id) }}
          />
        )
      })}

      {/* ── AIRPORT NODES ─────────────────────────────────────────────────── */}
      {airportList.map((ap) => {
        const pct = occupancyPct(ap)
        return (
          <Marker
            key={ap.id}
            position={[ap.lat, ap.lng]}
            icon={makeAirportIcon(theme)}
            eventHandlers={{ click: () => onAirportClick && onAirportClick(ap) }}
          >
            <Tooltip className="tasf-tooltip" direction="top" offset={[0, -32]}>
              <strong>{ap.id}</strong> — {ap.name}<br />
              Warehouse: <strong>{pct}%</strong> ({ap.currentOccupation} / {ap.warehouseCapacity})
            </Tooltip>
          </Marker>
        )
      })}
    </MapContainer>
  )
}
