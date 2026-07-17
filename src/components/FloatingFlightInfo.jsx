import React, { useEffect, useState } from 'react'
import { api } from '../services/api.js'

function loadColor(pct) {
  if (pct >= 85) return 'var(--red)'
  if (pct >= 60) return 'var(--amber)'
  return 'var(--green)'
}

function parseTimeStr(t) {
  if (!t || !t.includes(':')) return null
  return Number(t.split(':')[0]) * 60 + Number(t.split(':')[1])
}

function minutesToHHMM(totalMin) {
  const m = ((totalMin % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function toLocalTime(utcHHMM, huso) {
  if (!utcHHMM || huso == null) return null
  const utcMin = parseTimeStr(utcHHMM)
  if (utcMin == null) return null
  const localMin = utcMin + huso * 60
  return minutesToHHMM(localMin)
}

function fmtDate(d) {
  if (!d) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd}/${mm}/${yy}`
}

const chip = {
  background: 'rgba(255,255,255,0.045)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 8,
}

const label = {
  fontSize: 9, textTransform: 'uppercase', letterSpacing: 1.2,
  color: 'var(--muted)', fontWeight: 700,
}

export default function FloatingFlightInfo({ vuelo, onClose, fetchEnvios = api.getEnviosByFlight, simDate = null }) {
  const [envios, setEnvios] = useState([])
  const [maletasPopup, setMaletasPopup] = useState(null)

  const flightCode = vuelo ? (vuelo.id || vuelo.codigoVuelo) : null

  useEffect(() => {
    if (!flightCode) { setEnvios([]); return }
    setMaletasPopup(null)
    fetchEnvios(flightCode)
      .then((data) => setEnvios(Array.isArray(data) ? data : []))
      .catch(() => setEnvios([]))
  }, [flightCode, fetchEnvios])

  if (!vuelo) return null

  const origin  = vuelo.origin || vuelo.origen || '?'
  const dest    = vuelo.destination || vuelo.destino || '?'
  const salida  = vuelo.horaSalida || '—'
  const llegada = vuelo.horaLlegada || '—'
  const load    = vuelo.currentLoad ?? vuelo.cargaActual ?? 0
  const cap     = vuelo.capacity ?? vuelo.capacidadTotal ?? 300
  const pct     = cap > 0 ? (load / cap) * 100 : 0
  const color   = loadColor(pct)

  const depMin = parseTimeStr(salida)
  const arrMin = parseTimeStr(llegada)
  const isOvernight = depMin != null && arrMin != null && arrMin < depMin
  const depDate = simDate ?? new Date()
  const arrDate = isOvernight ? new Date(depDate.getTime() + 24 * 60 * 60 * 1000) : depDate

  const husOrigen = vuelo.husOrigen ?? null
  const salidaLocal = toLocalTime(salida, husOrigen)
  const husDestino = vuelo.husDestino ?? null
  const llegadaLocal = toLocalTime(llegada, husDestino)

  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(30,36,44,0.92) 0%, rgba(20,24,30,0.92) 100%)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 10,
      padding: 10,
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55)',
      fontFamily: 'var(--sans)',
      backdropFilter: 'blur(10px)',
      width: 268,
      pointerEvents: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 7,
      position: 'relative',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: 'var(--text-bright)', letterSpacing: -0.3, flex: 1 }}>
          {origin} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>→</span> {dest}
        </span>
        <button
          onClick={onClose}
          aria-label="Cerrar"
          style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 5, color: 'var(--muted)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1, padding: '4px 6px' }}
        >
          ✕
        </button>
      </div>

      {/* Salida / Llegada */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ ...chip, flex: 1, padding: '6px 9px' }}>
          <div style={{ ...label, marginBottom: 4 }}>✈ Salida</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 600, color: 'var(--amber)' }}>{salida}</span>
            <span style={{ fontSize: 9, color: 'var(--muted)', padding: '0 3px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3 }}>UTC</span>
          </div>
          {salidaLocal && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 3 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: 'var(--text-bright)' }}>{salidaLocal}</span>
              <span style={{ fontSize: 8, color: 'var(--blue)', padding: '0 3px', border: '1px solid rgba(99,152,255,0.2)', borderRadius: 3, background: 'rgba(99,152,255,0.1)' }}>LCL</span>
            </div>
          )}
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{fmtDate(depDate)}</div>
        </div>
        <div style={{ ...chip, flex: 1, padding: '6px 9px' }}>
          <div style={{ ...label, marginBottom: 4 }}>⛁ Llegada</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 600, color: 'var(--amber)' }}>{llegada}</span>
            <span style={{ fontSize: 9, color: 'var(--muted)', padding: '0 3px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3 }}>UTC</span>
          </div>
          {llegadaLocal && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 3 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: 'var(--text-bright)' }}>{llegadaLocal}</span>
              <span style={{ fontSize: 8, color: 'var(--blue)', padding: '0 3px', border: '1px solid rgba(99,152,255,0.2)', borderRadius: 3, background: 'rgba(99,152,255,0.1)' }}>LCL</span>
            </div>
          )}
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{fmtDate(arrDate)}</div>
        </div>
      </div>

      {/* Ocupación */}
      <div style={{ ...chip, padding: '7px 9px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={label}>Ocupación</span>
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color,
            background: `${color}22`, border: `1px solid ${color}55`,
            borderRadius: 4, padding: '1px 6px',
          }}>
            {pct.toFixed(1)}%
          </span>
        </div>
        <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', borderRadius: 3, marginBottom: 4 }}>
          <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: color, transition: 'width 0.4s ease', borderRadius: 3 }} />
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>{load} / {cap} maletas</div>
      </div>

      {/* Envíos */}
      <div style={{ ...chip, padding: '7px 9px' }}>
        <div style={{ ...label, marginBottom: 6 }}>
          Envíos asignados ({envios.length})
        </div>
        {envios.length === 0 ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>Sin envíos asignados</div>
        ) : (
          <div style={{ maxHeight: 3 * 25, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {envios.map((e) => (
              <div 
                key={e.idEnvio} 
                onClick={() => setMaletasPopup({ idEnvio: e.idEnvio, cantidadMaletas: e.cantidadMaletas || 0 })}
                style={{
                  display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11,
                  background: maletasPopup?.idEnvio === e.idEnvio ? 'rgba(99,152,255,0.1)' : 'rgba(255,255,255,0.03)', borderRadius: 5, padding: '4px 7px',
                  cursor: 'pointer'
              }}>
                <span style={{ color: 'var(--blue)' }}>{e.idEnvio}</span>
                <span style={{ color: 'var(--muted)' }}>{e.cantidadMaletas} · {e.aeropuertoDestino}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {maletasPopup && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2010 }} onClick={() => setMaletasPopup(null)}>
          <div style={{
            position: 'absolute', left: '50%', top: 'calc(100% + 10px)', transform: 'translateX(-50%)', width: 190, maxHeight: 220,
            background: 'rgba(22, 27, 34, 0.98)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }} onClick={(ev) => ev.stopPropagation()}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)',
              fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--text-bright)',
            }}>
              <span style={{ color: 'var(--blue)' }}>{maletasPopup.idEnvio}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                🧳 {String(maletasPopup.cantidadMaletas).padStart(2, '0')}
              </span>
              <button style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 16, lineHeight: 1, padding: '2px 4px' }} onClick={() => setMaletasPopup(null)}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '4px 6px' }}>
              {Array.from({ length: maletasPopup.cantidadMaletas }, (_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', padding: '5px 6px', borderRadius: 6 }}>
                  <span style={{ color: 'var(--blue)', fontSize: 18, lineHeight: 1 }}>•</span>
                  <span>{maletasPopup.idEnvio}-{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
