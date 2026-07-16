import React, { useEffect, useState } from 'react'
import { api } from '../services/api.js'

const s = {
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2000,
    display: 'flex', pointerEvents: 'auto',
  },
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    background: 'transparent', border: 'none', cursor: 'pointer',
  },
  panel: {
    position: 'absolute', left: 60, top: 10, bottom: 10, width: 340,
    background: 'rgba(22, 27, 34, 0.75)', backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: 16,
    display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden', zIndex: 2001,
    boxShadow: '4px 4px 24px rgba(0, 0, 0, 0.5)',
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
    position: 'absolute', left: 60 + (340 - 220) / 2, top: 60, width: 220, maxHeight: 220,
    background: 'rgba(22, 27, 34, 0.98)', backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
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
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--amber)', flexShrink: 0 }}>
            {e.hora}
          </span>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>
          {e.cantidadMaletas} 🧳
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
      style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: onClick ? 'pointer' : 'default' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--blue)' }}>{e.idEnvio}</span>
        {e.hora && <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--amber)' }}>{e.hora}</span>}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
        {e.rutaCompleta && e.rutaCompleta.length > 2
          ? e.rutaCompleta.join(' → ')
          : <>{e.aeropuertoOrigen} → {e.aeropuertoDestino}</>
        }
        {e.codigoVuelo && <span style={{ color: 'var(--text)' }}> · {e.codigoVuelo}</span>}
        <span style={{ marginLeft: 6 }}>{e.cantidadMaletas} 🧳</span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
        {e.sla != null && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 3, padding: '0 4px' }}>
            SLA {e.sla}d
          </span>
        )}
      </div>
    </div>
  )
}

// Sim clock runs in UTC; each airport displays its own local wall time (UTC + huso).
function localTimeLabel(huso, nowMinuteUtc) {
  if (huso == null || nowMinuteUtc == null) return null
  const localMin = ((Math.floor(nowMinuteUtc) + huso * 60) % 1440 + 1440) % 1440
  const hh = String(Math.floor(localMin / 60)).padStart(2, '0')
  const mm = String(localMin % 60).padStart(2, '0')
  const sign = huso >= 0 ? '+' : '-'
  return `${hh}:${mm} local · UTC${sign}${Math.abs(huso)}`
}

export default function DrawerAeropuerto({ airport, vuelos, onClose, hideInventoryTabs = false, nowMinuteUtc = null, fetchInventory = api.getAirportInventory, umbralVerde = 60, umbralRojo = 85 }) {
  const [tab, setTab] = useState('info')
  const [inventory, setInventory] = useState(null)
  const [loadingInv, setLoadingInv] = useState(false)
  const [maletasPopup, setMaletasPopup] = useState(null) // { idEnvio, cantidadMaletas } | null
  
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
  const salidas = (vuelos || []).filter((v) => (v.origin || v.origen) === iata).slice(0, 6)
  const llegadas = (vuelos || []).filter((v) => (v.destination || v.destino) === iata).slice(0, 6)

  return (
    <div style={s.overlay}>
      <button aria-label="Cerrar" style={s.backdrop} onClick={onClose} />
      <aside style={s.panel}>

        {/* Header */}
        <div style={s.header}>
          <span style={s.iata}>{airport.id}</span>
          {localTimeLabel(airport.huso, nowMinuteUtc) && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginLeft: 8 }}>
              {localTimeLabel(airport.huso, nowMinuteUtc)}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <span style={s.pill(color)}>{semaforoLabel(pct, umbralVerde, umbralRojo)}</span>
          <button style={s.closeBtn} onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <button style={TAB_STYLE(tab === 'info')} onClick={() => setTab('info')}>Info</button>
          {!hideInventoryTabs && <button style={TAB_STYLE(tab === 'inventario')} onClick={() => setTab('inventario')}>Inventario</button>}
          {!hideInventoryTabs && <button style={TAB_STYLE(tab === 'planificado')} onClick={() => setTab('planificado')}>Planificado</button>}
        </div>

        {tab === 'inventario' && (() => {
          const { salida, llegada, escala } = agruparPorRol(inventory?.enAlmacen, iata)
          const rowClick = (e) => () => setMaletasPopup((p) => (p?.idEnvio === e.idEnvio ? null : { idEnvio: e.idEnvio, cantidadMaletas: e.cantidadMaletas || 0 }))
          const seccion = (title, color, lista, expanded, setExpanded, borderTop) => (
            <div style={{ display: 'flex', flexDirection: 'column', flex: expanded ? 1 : 'none', minHeight: 0 }}>
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

        {maletasPopup && (
          <div style={s.maletasPopupOverlay} onClick={() => setMaletasPopup(null)}>
            <div style={s.maletasPopup} onClick={(ev) => ev.stopPropagation()}>
              <div style={s.maletasPopupHeader}>
                <span style={{ color: 'var(--blue)' }}>{maletasPopup.idEnvio}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  🧳 {maletasPopup.cantidadMaletas}
                </span>
                <button style={s.closeBtn} onClick={() => setMaletasPopup(null)} aria-label="Cerrar">✕</button>
              </div>
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

        {tab === 'planificado' && (() => {
          const rowClick = (e) => () => setMaletasPopup((p) => (p?.idEnvio === e.idEnvio ? null : { idEnvio: e.idEnvio, cantidadMaletas: e.cantidadMaletas || 0 }))
          return (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            {loadingInv && <div style={{ padding: '14px 16px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>Cargando...</div>}
            {!loadingInv && !inventory && (
              <div style={{ padding: '14px 16px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', opacity: 0.6 }}>
                Sin datos — simulación no activa
              </div>
            )}
            {!loadingInv && inventory && (
              <>
                {/* ENTRADAS */}
                <div style={{ display: 'flex', flexDirection: 'column', flex: expandedIn ? 1 : 'none', minHeight: 0 }}>
                  <div 
                    onClick={() => setExpandedIn(!expandedIn)}
                    style={{ 
                      padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                      cursor: 'pointer', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' 
                    }}
                  >
                    <span style={{ ...s.sectionTitle, color: 'var(--text-bright)', marginBottom: 0 }}>
                      Por entrar hoy: {inventory.planificadosEntrando?.length ?? 0} envíos ({sumarMaletas(inventory.planificadosEntrando)} maletas)
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>{expandedIn ? '▲' : '▼'}</span>
                  </div>
                  {expandedIn && (
                    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                      {(inventory.planificadosEntrando?.length ?? 0) === 0
                        ? <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>Sin llegadas planificadas</div>
                        : inventory.planificadosEntrando.map((e, i) => <EnvioRow key={`in-${i}`} e={e} onClick={rowClick(e)} />)
                      }
                    </div>
                  )}
                </div>

                {/* SALIDAS */}
                <div style={{ display: 'flex', flexDirection: 'column', flex: expandedOut ? 1 : 'none', minHeight: 0 }}>
                  <div 
                    onClick={() => setExpandedOut(!expandedOut)}
                    style={{ 
                      padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                      cursor: 'pointer', background: 'rgba(255,255,255,0.03)', borderTop: '1px solid var(--border)', borderBottom: '1px solid rgba(255,255,255,0.05)' 
                    }}
                  >
                    <span style={{ ...s.sectionTitle, color: 'var(--text-bright)', marginBottom: 0 }}>
                      Por salir hoy: {inventory.planificadosSaliendo?.length ?? 0} envíos ({sumarMaletas(inventory.planificadosSaliendo)} maletas)
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>{expandedOut ? '▲' : '▼'}</span>
                  </div>
                  {expandedOut && (
                    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                      {(inventory.planificadosSaliendo?.length ?? 0) === 0
                        ? <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>Sin salidas planificadas</div>
                        : inventory.planificadosSaliendo.map((e, i) => <EnvioRow key={`out-${i}`} e={e} onClick={rowClick(e)} />)
                      }
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
              const displayCode = code.replace(`${iata}-`, '')
              return (
                <div key={`s-${code}`} style={s.flightItem}>
                  <div style={s.dot(c)} />
                  <span style={s.flightCode}>{displayCode}</span>
                  <span style={{ ...s.flightMeta, color: c }}>→ {((load / vcap) * 100).toFixed(2)}%</span>
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
              const displayCode = code.replace(`-${iata}`, '')
              return (
                <div key={`l-${code}`} style={s.flightItem}>
                  <div style={s.dot(c)} />
                  <span style={s.flightCode}>{displayCode}</span>
                  <span style={{ ...s.flightMeta, color: c }}>→ {((load / vcap) * 100).toFixed(2)}%</span>
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

      </aside>
    </div>
  )
}
