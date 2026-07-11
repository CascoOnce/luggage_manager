import React, { useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MapContainer, TileLayer, Tooltip, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { MdWarehouse, MdFlight, MdFilterList } from 'react-icons/md'
import DraggableWidget from './DraggableWidget'
const AIRPORT_BOUNDS = [[-50, -85], [60, 82]]
const SNAP_THRESHOLD_PX = 200

// Keeps the airport bounding box always filling the container.
// On each resize: invalidate size, recalculate the minimum zoom so the
// bounds fit exactly, then clamp current zoom if needed.
function FitAirportBounds({ paddingLeft = 0 }) {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()

    const fit = (force = false, animate = false) => {
      map.invalidateSize()
      if (container.clientWidth === 0 || container.clientHeight === 0) return
      const leftPadding = Math.max(0, Math.min(paddingLeft, container.clientWidth * 0.45))
      const minZ = map.getBoundsZoom(AIRPORT_BOUNDS, false, L.point(leftPadding, 0))
      if (!isFinite(minZ) || minZ <= 0) return
      map.setMinZoom(Math.min(minZ, map.getMaxZoom()))
      if (force || map.getZoom() < minZ) {
        map.fitBounds(AIRPORT_BOUNDS, {
          animate,
          duration: animate ? 0.35 : 0,
          paddingTopLeft: [leftPadding, 0],
          paddingBottomRight: [0, 0],
        })
      }
    }

    const t = setTimeout(() => fit(true, paddingLeft > 0), 0)
    const observer = new ResizeObserver(() => fit(false, false))
    observer.observe(container)
    return () => { clearTimeout(t); observer.disconnect() }
  }, [map, paddingLeft])
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

function MapClickDeselect({ onDeselect }) {
  useMapEvents({ click: () => onDeselect() })
  return null
}

function FlyToTarget({ target }) {
  const map = useMap()
  const prevRef = useRef(null)
  useEffect(() => {
    if (!target) return
    if (prevRef.current === target) return
    prevRef.current = target
    const duration = target.duration ?? 0.7
    // A `bounds` target ([[latMin,lngMin],[latMax,lngMax]]) fits the whole route/area so the
    // highlighted polyline is always fully visible — Leaflet computes the exact zoom.
    if (target.bounds) {
      try {
        map.flyToBounds(target.bounds, { animate: true, duration, padding: [60, 60], maxZoom: target.maxZoom ?? 6 })
        return
      } catch { /* fall through to point fly */ }
    }
    if (target.lat == null || target.lng == null) return
    const zoom = target.zoom ?? Math.max(map.getZoom(), 5)
    map.flyTo([target.lat, target.lng], zoom, { animate: true, duration })
  }, [map, target])
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
  return (ap.currentOccupation / ap.warehouseCapacity) * 100
}

function trafficLightColor(pct, threshold, theme) {
  if (pct === 0) return theme === 'light' ? '#1a6fd4' : '#4d9fff'
  if (pct >= threshold) return '#f04b4b'
  if (pct >= threshold - 20) return '#f5a623'
  return '#22d07a'
}

// Flight load semaphore uses fixed 60/85 thresholds, independent of the
// airport-warehouse threshold slider — matches SidePanel's flight list/filter.
function flightTrafficLightColor(pct, theme) {
  if (pct === 0) return theme === 'light' ? '#1a6fd4' : '#4d9fff'
  if (pct >= 85) return '#f04b4b'
  if (pct >= 60) return '#f5a623'
  return '#22d07a'
}

// The warehouse glyph is constant — render its SVG markup once at module load instead of
// on every makeAirportIcon() call (which runs per airport, on every map re-render).
const WAREHOUSE_SVG = renderToStaticMarkup(React.createElement(MdWarehouse, { size: 16, color: '#fff' }))

function makeAirportIcon(pct, threshold, theme) {
  const pinColor = trafficLightColor(pct, threshold, theme)
  const warehouseSvg = WAREHOUSE_SVG
  const borderColor = theme === 'dark' ? '#060606' : '#ffffff'
  // Single-line HTML avoids whitespace issues with Leaflet's DivIcon rendering
  const html = `<div class="airport-pin" style="width:28px;height:28px;background:${pinColor};border-radius:50%;display:flex;align-items:center;justify-content:center;border:2.5px solid ${borderColor};box-shadow:0 0 7px ${pinColor}99;transform-origin:50% 50%;box-sizing:border-box;">${warehouseSvg}</div>`
  return L.divIcon({
    className: '',
    html,
    iconSize:   [28, 28],  // Exact visual size of the circle
    iconAnchor: [14, 14],  // Center of the 28×28 circle → sits precisely on the coordinate
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

const PLANE_SIZE = 30  // change this one value to resize the plane icon

function makeDivIcon(selected, angle, theme, flightPct) {
  const color = flightTrafficLightColor(flightPct ?? 0, theme)
  const shadow = selected ? `drop-shadow(0 0 6px ${color})` : 'none'
  const s = PLANE_SIZE
  // Body centerline of this SVG path is at x=11.5/24 of viewBox (not perfectly centered).
  // cx/cy must match transform-origin and iconAnchor so rotation keeps the fuselage on the route line.
  const cx = Math.round(s * 11.5 / 24)
  const cy = Math.round(s / 2)
  return L.divIcon({
    className: '',
    html: `<div class="flight-plane${selected ? ' flight-plane-selected' : ''}" style="width:${s}px;height:${s}px;transform:rotate(${angle}deg);transform-origin:${cx}px ${cy}px;filter:${shadow};transition:filter 0.2s"><svg viewBox="0 0 24 24" width="${s}" height="${s}" xmlns="http://www.w3.org/2000/svg"><path fill="${color}" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg></div>`,
    iconSize: [s, s],
    iconAnchor: [cx, cy],
  })
}

// Calculates screen-space angle and position in Mercator so the plane sits exactly on the route line
function screenAngle(map, originAp, destAp) {
  if (!originAp || !destAp) return 0
  const pA = map.latLngToContainerPoint([originAp.lat, originAp.lng])
  const pB = map.latLngToContainerPoint([destAp.lat, destAp.lng])
  const dx = pB.x - pA.x
  const dy = pB.y - pA.y
  return (Math.atan2(dx, -dy) * 180) / Math.PI
}

// Interpolate position along the visual line in screen pixels, then convert back to lat/lng.
// This places the plane exactly on the Mercator-projected line instead of off it.
function mercatorLerp(map, originAp, destAp, fraction) {
  if (!originAp || !destAp) return null
  const pA = map.latLngToContainerPoint([originAp.lat, originAp.lng])
  const pB = map.latLngToContainerPoint([destAp.lat, destAp.lng])
  const px = pA.x + (pB.x - pA.x) * fraction
  const py = pA.y + (pB.y - pA.y) * fraction
  const latlng = map.containerPointToLatLng(L.point(px, py))
  return [latlng.lat, latlng.lng]
}

function FlightLayer({ activeFlights, apIdx, selectedFlight, selectedFlightData, setSelectedFlight, theme, showAllRoutes, threshold }) {
  const map = useMap()
  const [tick, forceUpdate] = useState(0)
  const iconCache = useRef(new Map())

  // Invalidate icon cache when theme changes so colors rebuild correctly.
  const prevThemeRef = useRef(theme)
  if (prevThemeRef.current !== theme) {
    iconCache.current.clear()
    prevThemeRef.current = theme
  }

  useEffect(() => {
    // Only re-render at the END of a gesture. During a live pan Leaflet already
    // translates the marker pane, and the relative angle between two airports is
    // pan-invariant — so re-rendering on every continuous `move`/`zoom` frame was a
    // wasted storm of full re-renders (very costly with many planes). Zoom changes the
    // Mercator projection non-linearly, so `zoomend` still forces a reposition.
    const update = () => forceUpdate((n) => n + 1)
    map.on('zoomend moveend', update)
    return () => map.off('zoomend moveend', update)
  }, [map])

  // Draw route line for selected flight even if it's no longer in activeFlights.
  // Split into traveled (gray) and remaining (blue dashed) segments using fraction.
  const selectedRouteEl = useMemo(() => {
    if (!selectedFlightData) return null
    const a = apIdx[selectedFlightData.origin], b = apIdx[selectedFlightData.destination]
    if (!a || !b) return null
    const fraction = selectedFlightData.fraction ?? 0
    const color = theme === 'light' ? '#0969da' : '#4d9fff'
    if (fraction <= 0) {
      return (
        <Polyline
          key={`route-${selectedFlightData.id}-rem`}
          positions={[[a.lat, a.lng], [b.lat, b.lng]]}
          pathOptions={{ color, weight: 1.5, opacity: 0.7, dashArray: '6 5' }}
        />
      )
    }
    const travColor = theme === 'light' ? '#64748b' : '#ffffff'
    if (fraction >= 1) {
      return (
        <Polyline
          key={`route-${selectedFlightData.id}-trav`}
          positions={[[a.lat, a.lng], [b.lat, b.lng]]}
          pathOptions={{ color: travColor, weight: 2, opacity: 0.1 }}
        />
      )
    }
    // Use mercatorLerp (pixel-space interpolation) so the split matches the plane icon position
    const mid = mercatorLerp(map, a, b, fraction)
    if (!mid) return null
    return (
      <>
        <Polyline
          key={`route-${selectedFlightData.id}-trav`}
          positions={[[a.lat, a.lng], mid]}
          pathOptions={{ color: travColor, weight: 2, opacity: 0.1 }}
        />
        <Polyline
          key={`route-${selectedFlightData.id}-rem`}
          positions={[mid, [b.lat, b.lng]]}
          pathOptions={{ color, weight: 1.5, opacity: 0.7, dashArray: '6 5' }}
        />
      </>
    )
  }, [selectedFlightData, apIdx, theme, tick, map])

  const bgOpacity = selectedFlight ? 0.15 : 0.3
  const travColor = theme === 'light' ? '#64748b' : '#ffffff'

  return (
    <>
      {showAllRoutes && activeFlights.map((flight) => {
        if (flight.id === selectedFlight) return null
        const a = apIdx[flight.origin], b = apIdx[flight.destination]
        if (!a || !b) return null
        const fraction = flight.fraction ?? 0
        if (fraction <= 0) {
          return (
            <Polyline
              key={`bg-route-${flight.id}-rem`}
              positions={[[a.lat, a.lng], [b.lat, b.lng]]}
              pathOptions={{ color: '#60a5fa', weight: 1.5, dashArray: '4 6', opacity: bgOpacity }}
            />
          )
        }
        if (fraction >= 1) {
          return null
        }
        const mid = mercatorLerp(map, a, b, fraction)
        if (!mid) return null
        return (
          <React.Fragment key={`bg-route-${flight.id}`}>
            <Polyline
              positions={[mid, [b.lat, b.lng]]}
              pathOptions={{ color: '#60a5fa', weight: 1.5, dashArray: '4 6', opacity: bgOpacity }}
            />
          </React.Fragment>
        )
      })}
      {selectedRouteEl}
      {activeFlights.map((flight) => {
        const a = apIdx[flight.origin], b = apIdx[flight.destination]
        const pos = mercatorLerp(map, a, b, flight.fraction)
        if (!pos) return null
        const isSelected = selectedFlight === flight.id
        const angle = screenAngle(map, a, b)
        const flightPct = flight.capacity > 0 ? (flight.currentLoad / flight.capacity) * 100 : 0
        const flightBucket = flightPct === 0 ? 0 : flightPct >= 85 ? 85 : flightPct >= 60 ? 60 : 1
        const cacheKey = `${isSelected ? 1 : 0}-${Math.round(angle)}-${theme}-${flightBucket}`
        if (!iconCache.current.has(cacheKey)) {
          iconCache.current.set(cacheKey, makeDivIcon(isSelected, angle, theme, flightPct))
        }
        const icon = iconCache.current.get(cacheKey)
        return (
          <Marker
            key={`fm2-${flight.id}-${isSelected ? 'sel' : 'norm'}-${Math.round(angle)}`}
            position={pos}
            icon={icon}
            eventHandlers={{ click: () => setSelectedFlight(isSelected ? null : flight.id) }}
          />
        )
      })}
    </>
  )
}

function AirportMarkers({ airports, theme, threshold, hoveredAirport, setHoveredAirport, onAirportClick }) {
  const map = useMap()
  
  return airports.map((ap) => {
    const pct = occupancyPct(ap)
    let direction = 'top'
    let offset = [0, -10] // Default (top)

    // Calculate position dynamically if the map is ready
    if (map) {
      const pt = map.latLngToContainerPoint([ap.lat, ap.lng])
      const mapHeight = map.getSize().y
      // If it's in the top 40% of the screen, show it at the bottom to avoid cutting it off
      if (pt.y < mapHeight * 0.4) {
        direction = 'bottom'
        offset = [15, 15] // Bottom right offset to avoid covering the marker completely
      } else {
        direction = 'top'
        offset = [0, -25] // Top offset
      }
    }

    return (
      <Marker
        key={ap.id}
        position={[ap.lat, ap.lng]}
        icon={makeAirportIcon(pct, threshold, theme)}
        eventHandlers={{
          click: () => onAirportClick && onAirportClick(ap),
          mouseover: () => setHoveredAirport(ap.id),
          mouseout: () => setHoveredAirport(null)
        }}
      >
        {hoveredAirport === ap.id && (
          <Tooltip permanent className="tasf-tooltip" direction={direction} offset={offset}>
            <strong>{ap.id}</strong> — {ap.name}<br />
            Almacén: <strong>{pct.toFixed(2)}%</strong> ({ap.currentOccupation} / {ap.warehouseCapacity})<br />
            {ap.maletasEnAlmacenLocal > 0 && <><span>En espera: <strong>{ap.maletasEnAlmacenLocal}</strong> maletas</span><br /></>}
            {ap.maletasEnTransitoEntrantes > 0 && <><span>Llegando: <strong>{ap.maletasEnTransitoEntrantes}</strong> maletas</span><br /></>}
            {(ap.vuelosSalientes > 0 || ap.vuelosLlegando > 0) && <span>Vuelos: <strong>{ap.vuelosSalientes}</strong> salen · <strong>{ap.vuelosLlegando}</strong> llegan</span>}
          </Tooltip>
        )}
      </Marker>
    )
  })
}

export default function MapView({
  airports, flights,
  selectedFlight, setSelectedFlight,
  selectedFlightData,
  onAirportClick,
  onMapClick,
  theme = 'dark',
  highlightedRoute = null,
  viewportPaddingLeft = 0,
  threshold = 85,
  flyToTarget = null,
}) {
  const [showRoutes, setShowRoutes] = useState(true)
  const [aptFilters, setAptFilters] = useState({ blue: true, green: true, amber: true, red: true })
  const [fltFilters, setFltFilters] = useState({ blue: true, green: true, amber: true, red: true })
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(false)
  const [hoveredAirport, setHoveredAirport] = useState(null)
  
  const containerRef = useRef(null)
  const widgetRef = useRef(null)

  useEffect(() => {
    const handleRestore = () => {
      if (widgetRef.current) {
        widgetRef.current.setVisibility(true)
        widgetRef.current.resetPosition()
      }
    }
    window.addEventListener('restoreWidgets', handleRestore)
    return () => window.removeEventListener('restoreWidgets', handleRestore)
  }, [])

  const airportList = airports || []
  const flightList = flights || []

  const apIdx = useMemo(() => airportIndex(airportList), [airportList])

  const getTrafficLight = (pct) => {
    if (pct === 0) return 'blue'
    if (pct >= threshold) return 'red'
    if (pct >= threshold - 20) return 'amber'
    return 'green'
  }

  const filteredAirports = useMemo(() => {
    return airportList.filter(ap => {
      const pct = occupancyPct(ap)
      const tl = getTrafficLight(pct)
      return aptFilters[tl]
    })
  }, [airportList, aptFilters, threshold])

  // Only show active (non-cancelled) flights on map
  const activeFlights = flightList.filter((f) => {
    if (f.status !== 'active') return false

    const flightPct = f.capacity > 0 ? (f.currentLoad / f.capacity) * 100 : 0
    const tl = getTrafficLight(flightPct)
    if (!fltFilters[tl]) return false

    // Endpoint airports hidden by aptFilters must hide the flight too —
    // otherwise it renders as flying to/from a nonexistent airport.
    const originAp = apIdx[f.origin]
    const destAp = apIdx[f.destination]
    if (originAp && !aptFilters[getTrafficLight(occupancyPct(originAp))]) return false
    if (destAp && !aptFilters[getTrafficLight(occupancyPct(destAp))]) return false

    return true
  })

  const PillBtn = ({ active, color, onClick }) => (
    <button
      onClick={onClick}
      style={{
        background: active ? `${color}25` : 'rgba(255,255,255,0.02)',
        border: `1px solid ${active ? `${color}88` : 'rgba(255,255,255,0.1)'}`,
        borderRadius: 4, width: 24, height: 24, padding: 0, cursor: 'pointer',
        transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{ 
        width: 10, height: 10, borderRadius: '50%', 
        backgroundColor: active ? color : 'rgba(255,255,255,0.2)', 
        boxShadow: active ? `0 0 6px ${color}88` : 'none',
        transition: 'all 0.2s ease'
      }} />
    </button>
  )

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div style={{ position: 'absolute', bottom: 16, left: 20, zIndex: 500, pointerEvents: 'none' }}>
        <DraggableWidget
          ref={widgetRef}
          containerRef={containerRef}
          style={{
            pointerEvents: 'auto',
            background: 'rgba(22, 27, 34, 0.85)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 8,
            padding: '8px', display: 'flex', flexDirection: 'column', gap: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)', width: 'max-content'
          }}
        >
          <div 
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px', userSelect: 'none' }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); setIsFiltersExpanded(!isFiltersExpanded) }}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2px', background: 'transparent', border: 'none', borderRadius: 4 }}
              title={isFiltersExpanded ? "Ocultar filtros" : "Mostrar filtros"}
            >
              <MdFilterList size={18} color="rgba(255,255,255,0.7)" />
            </button>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: 1, flex: 1, cursor: 'move' }} title="Arrastrar">
              FILTROS DE MAPA
            </span>
          </div>

          {isFiltersExpanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowRoutes(v => !v) }}
                  style={{
                    flex: 1,
                    background: showRoutes ? 'rgba(61,139,255,0.15)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${showRoutes ? '#3d8bff55' : 'rgba(255,255,255,0.1)'}`,
                    color: showRoutes ? '#60a5fa' : 'rgba(255,255,255,0.3)',
                    fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 10px',
                    borderRadius: 4, cursor: 'pointer', letterSpacing: 0.8,
                    textTransform: 'uppercase', transition: 'all 0.2s ease',
                  }}
                >
                  {showRoutes ? '— RUTAS' : '+ RUTAS'}
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 24, display: 'flex', justifyContent: 'center' }}>
                  <MdWarehouse size={16} color="rgba(255,255,255,0.5)" />
                </div>
                <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                  <PillBtn active={aptFilters.blue} color="#4d9fff" onClick={(e) => { e.stopPropagation(); setAptFilters(f => ({ ...f, blue: !f.blue })) }} />
                  <PillBtn active={aptFilters.green} color="#22d07a" onClick={(e) => { e.stopPropagation(); setAptFilters(f => ({ ...f, green: !f.green })) }} />
                  <PillBtn active={aptFilters.amber} color="#f5a623" onClick={(e) => { e.stopPropagation(); setAptFilters(f => ({ ...f, amber: !f.amber })) }} />
                  <PillBtn active={aptFilters.red} color="#f04b4b" onClick={(e) => { e.stopPropagation(); setAptFilters(f => ({ ...f, red: !f.red })) }} />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 24, display: 'flex', justifyContent: 'center' }}>
                  <MdFlight size={16} color="rgba(255,255,255,0.5)" />
                </div>
                <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                  <PillBtn active={fltFilters.blue} color="#4d9fff" onClick={(e) => { e.stopPropagation(); setFltFilters(f => ({ ...f, blue: !f.blue })) }} />
                  <PillBtn active={fltFilters.green} color="#22d07a" onClick={(e) => { e.stopPropagation(); setFltFilters(f => ({ ...f, green: !f.green })) }} />
                  <PillBtn active={fltFilters.amber} color="#f5a623" onClick={(e) => { e.stopPropagation(); setFltFilters(f => ({ ...f, amber: !f.amber })) }} />
                  <PillBtn active={fltFilters.red} color="#f04b4b" onClick={(e) => { e.stopPropagation(); setFltFilters(f => ({ ...f, red: !f.red })) }} />
                </div>
              </div>
            </div>
          )}
        </DraggableWidget>
      </div>
    <MapContainer
      center={[20, 0]} zoom={3} minZoom={1} maxZoom={7}
      zoomSnap={0} zoomDelta={0.5} wheelPxPerZoomLevel={150} wheelDebounceTime={40} scrollWheelZoom={true}
      maxBounds={[[-50, -90], [65, 90]]}
      maxBoundsViscosity={1.0}
      style={{ width: '100%', height: '100%', background: '#060606' }}
      zoomControl={false} attributionControl={false}
    >
      <FitAirportBounds paddingLeft={viewportPaddingLeft} />
      <MapResizer />
      <IconScaler />
      {/* <ZoomSnapper airportList={airportList} /> */}
      {onMapClick && <MapClickDeselect onDeselect={onMapClick} />}
      <FlyToTarget target={flyToTarget} />
      <TileLayer
        url={theme === 'light'
          ? 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png'
          : 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'}
        subdomains="abcd" maxZoom={19} noWrap={true}
      />

      <FlightLayer
        activeFlights={activeFlights}
        apIdx={apIdx}
        selectedFlight={selectedFlight}
        selectedFlightData={selectedFlightData}
        setSelectedFlight={setSelectedFlight}
        theme={theme}
        threshold={threshold}
        showAllRoutes={showRoutes}
      />

      {/* ── HIGHLIGHTED ENVIO ROUTE ───────────────────────────────────────── */}
      {highlightedRoute?.legs.map((leg, i) => (
        <Polyline
          key={`hr-${highlightedRoute.envioId}-${i}`}
          positions={[[leg.originLat, leg.originLng], [leg.destLat, leg.destLng]]}
          pathOptions={{ color: '#a3e635', weight: 3, opacity: 0.9 }}
        />
      ))}

      {/* ── AIRPORT NODES ─────────────────────────────────────────────────── */}
      <AirportMarkers
        airports={filteredAirports}
        theme={theme}
        threshold={threshold}
        hoveredAirport={hoveredAirport}
        setHoveredAirport={setHoveredAirport}
        onAirportClick={onAirportClick}
      />
    </MapContainer>
    </div>
  )
}
