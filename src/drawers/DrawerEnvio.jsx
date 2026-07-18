import React, { useEffect, useState } from 'react'
import { api } from '../services/api.js'

const s = {
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2000,
    display: 'flex', pointerEvents: 'none',
  },
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    background: 'transparent', border: 'none', cursor: 'default',
    pointerEvents: 'none',
  },
  panel: {
    position: 'absolute', left: 60, top: 10, bottom: 10, width: 340,
    background: 'rgba(22, 27, 34, 0.75)', backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: 16,
    display: 'flex', flexDirection: 'column', overflowY: 'auto', zIndex: 2001,
    boxShadow: '4px 4px 24px rgba(0, 0, 0, 0.5)',
    pointerEvents: 'auto',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)',
    flexShrink: 0,
  },
  envioId: {
    fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700,
    color: 'var(--text-bright)', letterSpacing: 0.5, flex: 1,
  },
  pill: (color) => ({
    fontFamily: 'var(--mono)', fontSize: 8, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: 0.8,
    padding: '3px 8px', borderRadius: 4,
    background: `${color}1f`, color, border: `1px solid ${color}66`,
    flexShrink: 0,
  }),
  closeBtn: {
    background: 'transparent', border: 'none',
    color: 'var(--muted)', cursor: 'pointer',
    fontFamily: 'var(--mono)', fontSize: 14, lineHeight: 1,
    padding: '2px 4px', flexShrink: 0,
  },
  section: { padding: '14px 16px', borderBottom: '1px solid var(--border)' },
  sectionTitle: {
    fontFamily: 'var(--sans)', fontSize: 8, textTransform: 'uppercase',
    letterSpacing: 2, color: 'var(--muted)', fontWeight: 700,
    marginBottom: 10, display: 'block',
  },
  row: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'baseline', marginBottom: 7, gap: 8,
  },
  rowLabel: { fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)', flexShrink: 0 },
  rowVal: { fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-bright)', textAlign: 'right' },
  // Timeline
  tlRow: { display: 'flex', alignItems: 'stretch', gap: 12, position: 'relative' },
  tlDotCol: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 14, flexShrink: 0 },
  tlDot: (color) => ({
    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
    background: color, boxShadow: `0 0 6px ${color}`, zIndex: 1,
  }),
  tlLine: { flex: 1, width: 1, background: 'var(--border)', margin: '2px 0' },
  tlContent: { paddingBottom: 14, flex: 1, minWidth: 0 },
  tlCode: { fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-bright)', fontWeight: 600 },
  tlMeta: { fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', marginTop: 2 },
  // Status
  statusMsg: { fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', padding: '20px 16px' },
  // Tiempo restante big number
  tiempoBlock: {
    padding: '16px 16px', borderBottom: 'none', textAlign: 'center',
  },
}

function estadoColor(estado) {
  if (!estado) return 'var(--muted)'
  const e = estado.toUpperCase()
  if (e === 'ENTREGADO') return '#22d07a'
  if (e === 'RETRASADO') return '#f04b4b'
  if (e === 'PENDIENTE') return '#4d9fff'
  if (e === 'EN_TRANSITO') return '#f5a623'
  if (e === 'PLANIFICADO') return '#a78bfa'
  return 'var(--muted)'
}

function escalaDotColor(escala) {
  if (!escala) return 'var(--muted)'
  const h = (escala.horaLlegadaEst || '').toLowerCase()
  if (h === 'completado' || h === 'entregado') return 'var(--green)'
  if (h === 'retrasado') return 'var(--red)'
  return 'var(--amber)'
}

function toMinutes(str) {
  if (!str) return null
  if (str.includes('T')) {
    const d = new Date(str)
    return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes()
  }
  const parts = str.split(':').map(Number)
  return parts.length >= 2 ? parts[0] * 60 + parts[1] : null
}

function fmtIngreso(str) {
  if (!str) return '—'
  const d = new Date(str.endsWith('Z') || str.includes('+') ? str : `${str}Z`)
  if (Number.isNaN(d.getTime())) return '—'
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  return `${dd}/${mm} ${hh}:${mi} UTC`
}

function dwellMinutes(llegada, salida) {
  const l = toMinutes(llegada)
  const s = toMinutes(salida)
  if (l === null || s === null) return 0
  let diff = s - l
  if (diff < 0) diff += 1440
  return diff
}

function fmtDwell(min) {
  if (min <= 0) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}


export default function DrawerEnvio({ envioId, onClose, onShowInMap, fetchEnvio = api.getEnvioById, currentEstado }) {
  const [envio, setEnvio]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState(null)
  const [maletasOpen, setMaletasOpen] = useState(false)

  useEffect(() => {
    if (!envioId) {
      setEnvio(null)
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    setEnvio(null)

    fetchEnvio(envioId)
      .then((v) => { if (active) setEnvio(v) })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [envioId, fetchEnvio])

  useEffect(() => {
    if (!envioId) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [envioId, onClose])

  if (!envioId) return null

  const displayEstado = currentEstado || envio?.estado
  const eColor = estadoColor(displayEstado)
  const escalas = envio?.planDetalle?.escalas || []

  return (
    <div style={s.overlay}>
      <button aria-label="Cerrar" style={s.backdrop} onClick={onClose} />
      <aside style={s.panel}>

        {/* Header */}
        <div style={s.header}>
          <span style={s.envioId}>{envio?.idEnvio || envioId}</span>
          {envio?.codigoAerolinea && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)' }}>
              {envio.codigoAerolinea}
            </span>
          )}
          {displayEstado && <span style={s.pill(eColor)}>{displayEstado.replace('_', ' ')}</span>}
          {onShowInMap && escalas.length >= 2 && (
            <button
              style={{ ...s.closeBtn, color: 'var(--blue-bright)', fontSize: 11, padding: '3px 8px', border: '1px solid rgba(61,139,255,0.3)', borderRadius: 4 }}
              onClick={() => { onShowInMap(envioId); onClose() }}
              title="Ver ruta en mapa"
            >
              ↗ mapa
            </button>
          )}
          <button style={s.closeBtn} onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {/* Loading / Error */}
        {loading && <div style={s.statusMsg}>Cargando envío...</div>}
        {error && <div style={{ ...s.statusMsg, color: 'var(--red)' }}>{error}</div>}

        {envio && (
          <>
            {/* Info Envío */}
            <div style={s.section}>
              <span style={s.sectionTitle}>Información del envío</span>
              <div style={s.row}>
                <span style={s.rowLabel}>Origen</span>
                <span style={s.rowVal}>{envio.aeropuertoOrigen || '—'}</span>
              </div>
              <div style={s.row}>
                <span style={s.rowLabel}>Destino</span>
                <span style={s.rowVal}>{envio.aeropuertoDestino || '—'}</span>
              </div>
              <div style={s.row}>
                <span style={s.rowLabel}>Hora ingreso</span>
                <span style={s.rowVal}>{fmtIngreso(envio.fechaHoraIngreso)}</span>
              </div>
              <div style={s.row}>
                <span style={s.rowLabel}>Maletas</span>
                <span style={s.rowVal}>{envio.cantidadMaletas ?? '—'}</span>
              </div>
              <div style={s.row}>
                <span style={s.rowLabel}>SLA</span>
                <span style={s.rowVal}>{envio.sla != null ? `${envio.sla} día${envio.sla === 1 ? '' : 's'}` : '—'}</span>
              </div>
              <div style={s.row}>
                <span style={s.rowLabel}>Fecha límite</span>
                <span style={s.rowVal}>{envio.fechaLimiteSla ? String(envio.fechaLimiteSla).substring(0, 10) : '—'}</span>
              </div>
              <div style={s.row}>
                <span style={s.rowLabel}>Plan resumen</span>
                <span style={{ ...s.rowVal, fontSize: 9, wordBreak: 'break-all' }}>{envio.planResumen || '—'}</span>
              </div>
              <div style={s.row}>
                <span style={s.rowLabel}>Ubicación actual</span>
                <span style={s.rowVal}>{envio.ubicacionActual || '—'}</span>
              </div>
            </div>

            {/* Lista de maletas */}
            {envio.cantidadMaletas > 0 && (
              <div style={s.section}>
                <button
                  onClick={() => setMaletasOpen((v) => !v)}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: 0, width: '100%', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', marginBottom: maletasOpen ? 10 : 0,
                  }}
                >
                  <span style={{ ...s.sectionTitle, marginBottom: 0 }}>
                    Maletas ({envio.cantidadMaletas})
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                    {maletasOpen ? '▲' : '▼'}
                  </span>
                </button>
                {maletasOpen && (
                  <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                    {Array.from({ length: envio.cantidadMaletas }, (_, i) => (
                      <div
                        key={i}
                        style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--blue)' }}
                      >
                        {envio.idEnvio || envioId}-{i + 1}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Ruta Asignada — timeline */}
            {escalas.length > 0 && (
              <div style={{ ...s.section, flex: 1 }}>
                <span style={s.sectionTitle}>Ruta asignada (UTC)</span>
                <div>
                  {escalas.map((escala, idx) => {
                    const dotColor = escalaDotColor(escala)
                    const isLast = idx === escalas.length - 1
                    const dwell = !isLast
                      ? dwellMinutes(escala.horaLlegadaEst, escalas[idx + 1].horaSalidaEst)
                      : 0
                    return (
                      <React.Fragment key={`${escala.codigoVuelo}-${idx}`}>
                        <div style={s.tlRow}>
                          <div style={s.tlDotCol}>
                            <div style={s.tlDot(dotColor)} />
                            {!isLast && <div style={s.tlLine} />}
                          </div>
                          <div style={s.tlContent}>
                            <div style={s.tlCode}>
                              {escala.codigoVuelo || '—'} — {escala.codigoAeropuerto || '?'}
                            </div>
                            <div style={s.tlMeta}>
                              Salida UTC {escala.horaSalidaEst || '—'} · Llegada UTC {escala.horaLlegadaEst || '—'}
                            </div>
                          </div>
                        </div>
                        {!isLast && dwell > 0 && (
                          <div style={{ padding: '2px 0 4px 26px', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>
                            ⏱ {fmtDwell(dwell)} en {escala.codigoAeropuerto}
                          </div>
                        )}
                      </React.Fragment>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Tiempo Restante */}
            <div style={s.tiempoBlock}>
              <div style={{
                fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 700,
                color: eColor, letterSpacing: -0.5,
              }}>
                {envio.tiempoRestante != null ? `${envio.tiempoRestante}h` : '—'}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 4 }}>
                Tiempo restante
              </div>
            </div>

          </>
        )}

      </aside>
    </div>
  )
}
