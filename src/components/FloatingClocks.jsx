import React, { useState, useEffect } from 'react'

function fmtClock(sec) {
  if (sec == null || isNaN(sec)) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const hh = String(h).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function useWallClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export default function FloatingClocks({ backendState, simClockMinutes, realElapsedSeconds }) {
  const now = useWallClock()

  // -- REAL CLOCK --
  const realDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`
  const rawH = now.getHours()
  const realHh = String(rawH % 12 || 12).padStart(2, '0')
  const realMm = String(now.getMinutes()).padStart(2, '0')
  const realSs = String(now.getSeconds()).padStart(2, '0')
  const ampm = rawH >= 12 ? 'p.m.' : 'a.m.'
  const realTime = `${realHh}:${realMm}:${realSs} ${ampm}`

  // -- SIM CLOCK --
  let simDate = '—'
  let simTime = '—'
  
  if (backendState?.fechaSimulada) {
    const source = new Date(backendState.fechaSimulada)
    if (!Number.isNaN(source.getTime())) {
      source.setHours(0, 0, 0, 0)
      const current = new Date(source.getTime() + (simClockMinutes || 0) * 60000)
      const dd = String(current.getDate()).padStart(2, '0')
      const mm = String(current.getMonth() + 1).padStart(2, '0')
      const yyyy = current.getFullYear()
      const shh = String(current.getHours()).padStart(2, '0')
      const smm = String(current.getMinutes()).padStart(2, '0')
      // Fake seconds to give a sense of continuous tick, matching realElapsedSeconds loosely
      const sss = String((realElapsedSeconds || 0) % 60).padStart(2, '0')

      simDate = `${dd}/${mm}/${yyyy}`
      simTime = `${shh}:${smm}:${sss}`
    }
  }

  // Elapsed SIM time
  const simElapsedSeconds = backendState?.diaActual 
    ? ((backendState.diaActual - 1) * 86400) + ((simClockMinutes || 0) * 60)
    : 0

  return (
    <div style={{
      backgroundColor: 'rgba(22, 27, 34, 0.85)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: 6,
      padding: '12px 16px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
      fontFamily: 'var(--sans)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      gap: 30,
      pointerEvents: 'none' // allow clicking through if needed, though usually nice to not block map
    }}>
      
      {/* SECCIÓN REAL */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--blue)', fontWeight: 700 }}>
          Tiempo Real
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-bright)' }}>
          {realDate}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-bright)' }}>
          {realTime}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
          {fmtClock(realElapsedSeconds)}
        </div>
      </div>

      {/* LÍNEA DIVISORIA */}
      <div style={{ width: 1, backgroundColor: 'rgba(255, 255, 255, 0.1)' }} />

      {/* SECCIÓN SIMULACIÓN */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--amber)', fontWeight: 700 }}>
          Simulación
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-bright)' }}>
          {simDate}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-bright)' }}>
          {simTime}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
          {fmtClock(simElapsedSeconds)}
        </div>
      </div>
      
    </div>
  )
}
