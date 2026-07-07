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
    display: 'flex', flexDirection: 'column', overflowY: 'auto', zIndex: 2001,
    boxShadow: '4px 4px 24px rgba(0, 0, 0, 0.5)',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)',
    flexShrink: 0,
  },
  code: {
    fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700,
    color: 'var(--text-bright)', letterSpacing: 1,
  },
  route: {
    fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)',
    flex: 1,
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
    fontFamily: 'var(--sans)', fontSize: 10, textTransform: 'uppercase',
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
  timeline: { display: 'flex', flexDirection: 'column', gap: 0 },
  tlRow: { display: 'flex', alignItems: 'stretch', gap: 12 },
  tlDotCol: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 14, flexShrink: 0 },
  tlDot: (color, pulse) => ({
    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
    background: color, boxShadow: `0 0 6px ${color}`,
    animation: pulse ? 'pulse-dot 2.2s ease-in-out infinite' : 'none',
  }),
  tlLine: {
    flex: 1, width: 1, background: 'var(--border)', margin: '2px 0',
  },
  tlContent: {
    paddingBottom: 16, flex: 1,
  },
  tlLabel: { fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-bright)', fontWeight: 600 },
  tlMeta: { fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', marginTop: 2 },
}

function loadColor(pct) {
  if (pct >= 85) return 'var(--red)'
  if (pct >= 60) return 'var(--amber)'
  return 'var(--green)'
}

function estadoColor(estado) {
  if (!estado) return 'var(--muted)'
  const e = estado.toLowerCase()
  if (e === 'cancelado' || e === 'cancelled') return 'var(--red)'
  if (e === 'activo' || e === 'active') return 'var(--green)'
  return 'var(--amber)'
}

function parseTimeStr(t) {
  if (!t || !t.includes(':')) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minutesToHHMM(totalMin) {
  const m = ((totalMin % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function toLocalTime(utcHHMM, huso) {
  if (!utcHHMM || huso == null) return null
  const utcMin = parseTimeStr(utcHHMM)
  if (utcMin == null) return null
  // Stored times are UTC internally. Local airport time = UTC + huso offset.
  const localMin = utcMin + huso * 60
  return minutesToHHMM(localMin)
}

export default function DrawerVuelo({ vuelo, onClose, onCancelFlight, fetchEnvios = api.getEnviosByFlight, simClockMinutes = null }) {
  const [activeTab, setActiveTab] = useState('INFO')
  const [enviosAsignados, setEnviosAsignados] = useState([])
  const [search, setSearch] = useState('')
  const [showConfirmCancel, setShowConfirmCancel] = useState(false)

  useEffect(() => {
    if (!vuelo) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vuelo, onClose])

  useEffect(() => {
    if (!vuelo) { setEnviosAsignados([]); return }
    const code = vuelo.id || vuelo.codigoVuelo
    if (!code) return
    fetchEnvios(code)
      .then((data) => setEnviosAsignados(Array.isArray(data) ? data : []))
      .catch(() => setEnviosAsignados([]))
  }, [vuelo, fetchEnvios])

  if (!vuelo) return null

  const code    = vuelo.id || vuelo.codigoVuelo || '—'
  const origin  = vuelo.origin  || vuelo.origen  || '?'
  const dest    = vuelo.destination || vuelo.destino || '?'
  const tipo    = vuelo.type || vuelo.tipo || '—'
  const estado  = vuelo.status || vuelo.estado || '—'
  const salida  = vuelo.horaSalida || '—'
  const llegada = vuelo.horaLlegada || '—'
  const husOrigen = vuelo.husOrigen ?? null

  // Overnight flight: arrival clock < departure clock
  const depMin = parseTimeStr(salida)
  const arrMin = parseTimeStr(llegada)
  const isOvernight = depMin != null && arrMin != null && arrMin < depMin
  const llegadaLabel = isOvernight ? `${llegada} (+1d)` : llegada

  // Local timezone conversion (only when huso known)
  const salidaLocal  = toLocalTime(salida, husOrigen)
  const husDestino = vuelo.husDestino ?? null
  const llegadaLocal = toLocalTime(llegada, husDestino)

  // Load data — null means live mode (no simulation running)
  const hasLoadData = vuelo.currentLoad !== null || vuelo.cargaActual != null
  const load    = hasLoadData ? (vuelo.currentLoad ?? vuelo.cargaActual ?? 0) : 0
  const cap     = vuelo.capacity ?? vuelo.capacidadTotal ?? 300
  const pct     = cap > 0 ? (load / cap) * 100 : 0
  const color   = loadColor(pct)
  const eColor  = estadoColor(estado)
  const isActivo = estado === 'active' || estado === 'activo'
  const isCancelado = estado === 'cancelled' || estado === 'cancelado'
  const isCompleted = simClockMinutes !== null && depMin !== null && arrMin !== null
    && (arrMin >= depMin ? simClockMinutes >= arrMin : simClockMinutes >= arrMin && simClockMinutes < depMin)
  const canCancel = !isActivo && !isCancelado && !isCompleted && !!onCancelFlight

  return (
    <div style={s.overlay}>
      <button aria-label="Cerrar" style={s.backdrop} onClick={onClose} />
      <aside style={s.panel}>

        {/* Header */}
        <div style={s.header}>
          <span style={s.code}>{code}</span>
          <div style={{ flex: 1 }} />
          <span style={s.pill(eColor)}>
            {estado === 'active' ? 'ACTIVO'
              : estado === 'planned' ? 'PLANIFICADO'
              : estado === 'cancelled' ? 'CANCELADO'
              : estado === 'completed' ? 'COMPLETADO'
              : estado.toUpperCase()}
          </span>
          <button style={s.closeBtn} onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {/* Carga */}
        <div style={s.section}>
          <span style={s.sectionTitle}>Carga del vuelo</span>
          {hasLoadData ? (
            <>
              <div style={s.barTrack}>
                <div style={s.barFill(pct, color)} />
              </div>
              <div style={s.barLabel}>
                <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>
                  {load} / {cap} maletas
                </span>
                <span style={{ color, fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700 }}>{pct.toFixed(2)}%</span>
              </div>
            </>
          ) : (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
              Sin datos de asignación (modo en vivo)
            </div>
          )}
        </div>

        {/* Info */}
        <div style={s.section}>
          <span style={s.sectionTitle}>Información</span>
          <div style={s.row}>
            <span style={s.rowLabel}>Tipo</span>
            <span style={s.rowVal}>{tipo === 'continental' ? 'Continental' : tipo === 'intercontinental' ? 'Intercontinental' : tipo}</span>
          </div>
          <div style={s.row}>
            <span style={s.rowLabel}>Hora salida</span>
            <span style={s.rowVal}>
              {salidaLocal ?? salida}
              {salidaLocal && <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 6 }}>(UTC {salida})</span>}
            </span>
          </div>
          <div style={s.row}>
            <span style={s.rowLabel}>Hora llegada</span>
            <span style={s.rowVal}>
              {llegadaLocal ? (isOvernight ? `${llegadaLocal} (+1d)` : llegadaLocal) : llegadaLabel}
              {llegadaLocal && <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 6 }}>(UTC {llegada})</span>}
            </span>
          </div>
          <div style={s.row}>
            <span style={s.rowLabel}>Capacidad</span>
            <span style={s.rowVal}>{cap} maletas</span>
          </div>
        </div>

        {/* Envíos asignados */}
        <div style={{ ...s.section, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <span style={s.sectionTitle}>Envíos asignados ({enviosAsignados.length})</span>
          {enviosAsignados.length === 0 ? (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>Sin envíos asignados</div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {enviosAsignados.map((e) => (
                <div key={e.idEnvio} style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--blue)' }}>{e.idEnvio}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>{e.cantidadMaletas} maletas</span>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    {e.aeropuertoOrigen} → {e.aeropuertoDestino}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Trayecto */}
        <div style={{ ...s.section, borderBottom: 'none' }}>
          <span style={s.sectionTitle}>Trayecto</span>
          <div style={s.timeline}>
            {/* Origen */}
            <div style={s.tlRow}>
              <div style={s.tlDotCol}>
                <div style={s.tlDot('var(--blue-bright)', false)} />
                <div style={s.tlLine} />
              </div>
              <div style={s.tlContent}>
                <div style={s.tlLabel}>{origin}</div>
                <div style={s.tlMeta}>Salida {salidaLocal ?? salida}{salidaLocal ? ` (UTC ${salida})` : ''}</div>
              </div>
            </div>
            {/* En vuelo */}
            <div style={s.tlRow}>
              <div style={s.tlDotCol}>
                <div style={s.tlDot(color, isActivo)} />
                <div style={s.tlLine} />
              </div>
              <div style={s.tlContent}>
                <div style={{ ...s.tlLabel, color: isActivo ? color : 'var(--muted)' }}>
                  {isActivo ? 'En vuelo' : 'En espera'}
                </div>
                <div style={s.tlMeta}>{hasLoadData ? `${load} / ${cap} maletas · ${pct.toFixed(2)}% carga` : '—'}</div>
              </div>
            </div>
            {/* Destino */}
            <div style={s.tlRow}>
              <div style={s.tlDotCol}>
                <div style={s.tlDot('var(--green)', false)} />
              </div>
              <div style={s.tlContent}>
                <div style={s.tlLabel}>{dest}</div>
                <div style={s.tlMeta}>Llegada {llegadaLocal ? (isOvernight ? `${llegadaLocal} (+1d)` : llegadaLocal) : llegadaLabel}{llegadaLocal ? ` (UTC ${llegada})` : ''}</div>
              </div>
            </div>
          </div>
        </div>

        {canCancel && (
          <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <button
              onClick={() => setShowConfirmCancel(true)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'rgba(240,75,75,0.08)',
                border: '1px solid rgba(240,75,75,0.3)',
                color: 'var(--red)',
                fontFamily: 'var(--mono)',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: 1,
                cursor: 'pointer',
              }}
            >
              Cancelar vuelo
            </button>
          </div>
        )}
        {showConfirmCancel && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', zIndex: 10, borderRadius: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(6px)', padding: 24,
          }}>
            <div style={{
              background: 'rgba(22, 27, 34, 0.95)', border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 12, padding: 20, width: '100%',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', gap: 16
            }}>
              <div>
                <div style={{ fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 600, color: 'var(--text-bright)', marginBottom: 8 }}>
                  Cancelar Vuelo
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                  ¿Estás seguro que deseas cancelar el vuelo <span style={{ color: 'var(--red)', fontWeight: 600 }}>{code}</span> ({origin} → {dest})?
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  onClick={() => setShowConfirmCancel(false)}
                  style={{
                    flex: 1, padding: '8px 12px', background: 'transparent',
                    border: '1px solid var(--border)', color: 'var(--muted)',
                    fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 600,
                    borderRadius: 4, cursor: 'pointer', textTransform: 'uppercase',
                    letterSpacing: 1
                  }}
                >
                  Volver
                </button>
                <button
                  onClick={() => {
                    setShowConfirmCancel(false)
                    onCancelFlight(code)
                  }}
                  style={{
                    flex: 1, padding: '8px 12px', background: 'rgba(240,75,75,0.1)',
                    border: '1px solid rgba(240,75,75,0.4)', color: 'var(--red)',
                    fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 600,
                    borderRadius: 4, cursor: 'pointer', textTransform: 'uppercase',
                    letterSpacing: 1
                  }}
                >
                  Sí, Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

      </aside>
    </div>
  )
}
