import React, { useState, useEffect } from 'react'

function fmtClock(sec, includeSeconds = true) {
  if (sec == null || isNaN(sec)) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const hh = String(h).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return includeSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`
}

function useWallClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export default function FloatingClocks({ backendState, simClockMinutes, simStartMinute = 0, simStartedAt }) {
  const now = useWallClock()

  // -- REAL CLOCK --
  const realDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`
  const realHh = String(now.getHours()).padStart(2, '0')
  const realMm = String(now.getMinutes()).padStart(2, '0')
  const realSs = String(now.getSeconds()).padStart(2, '0')
  const realTime = `${realHh}:${realMm}:${realSs}`

  // Compute real elapsed from simStartedAt — accurate every second, no ref issues.
  const realElapsedSeconds = simStartedAt != null
    ? Math.floor((now.getTime() - simStartedAt) / 1000)
    : 0

  // -- SIM CLOCK --
  // simClockMinutes starts at simStartMinute (horaInicio) on day 1, then resets to 0
  // at midnight for days 2+. We just add it directly to midnight of the sim date.
  let simDate = '—'
  let simTime = '—'
  const diaActual = backendState?.diaActual || backendState?.currentDay || 1
  const totalDias = backendState?.totalDias || backendState?.totalDays || 5

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
      simDate = `${dd}/${mm}/${yyyy}`
      simTime = `${shh}:${smm}`
    }
  }

  // Elapsed SIM time since simulation began.
  // Day 1: clock runs from simStartMinute → 1440. Elapsed = simClockMinutes - simStartMinute.
  // Day 2+: clock runs from 0 → 1440. Add (1440 - simStartMinute) for day1 + previous full days.
  const simElapsedSeconds = backendState?.fechaSimulada
    ? (() => {
        const cur = simClockMinutes || 0
        if (diaActual <= 1) {
          return Math.max(0, (cur - simStartMinute) * 60)
        }
        // day 1 contributed (1440 - simStartMinute) minutes, each subsequent day up to diaActual-2
        // contributed 1440 minutes, plus current day's simClockMinutes.
        const day1 = 1440 - simStartMinute
        const middleDays = (diaActual - 2) * 1440
        return Math.max(0, (day1 + middleDays + cur) * 60)
      })()
    : null

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
      pointerEvents: 'none'
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
          {fmtClock(realElapsedSeconds ?? 0)}
        </div>
      </div>

      {/* LÍNEA DIVISORIA */}
      <div style={{ width: 1, backgroundColor: 'rgba(255, 255, 255, 0.1)' }} />

      {/* SECCIÓN SIMULACIÓN */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--amber)', fontWeight: 700 }}>
            Simulación
          </div>
          {backendState && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--amber)', background: 'rgba(251,191,36,0.15)', padding: '1px 5px', borderRadius: 3 }}>
              Día {diaActual}/{totalDias}
            </div>
          )}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-bright)' }}>
          {simDate}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-bright)' }}>
          {simTime}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
          {fmtClock(simElapsedSeconds ?? 0, false)}
        </div>
      </div>

    </div>
  )
}
