import React from 'react'

export default function FloatingKPIs({ kpis, hasSimulation }) {
  const data = [
    { label: 'En tránsito',    value: hasSimulation ? kpis.bagsInTransit.toLocaleString() : '—', color: hasSimulation ? 'var(--text-bright)' : 'var(--muted)' },
    { label: 'Vuelos activos', value: hasSimulation ? String(kpis.activeFlights) : '—', color: hasSimulation ? 'var(--blue-bright)' : 'var(--muted)' },
    { label: 'Cumpl. SLA',     value: hasSimulation ? `${Number(kpis.slaCompliance).toFixed(1)}%` : '—', color: hasSimulation ? (kpis.slaCompliance >= 90 ? 'var(--green)' : kpis.slaCompliance >= 75 ? 'var(--amber)' : 'var(--red)') : 'var(--muted)' },
    { label: 'SLA vencidos',   value: hasSimulation ? String(kpis.slaViolated) : '—', color: hasSimulation && kpis.slaViolated > 0 ? 'var(--red)' : 'var(--muted)' },
  ]

  return (
    <div style={{
      backgroundColor: 'rgba(22, 27, 34, 0.85)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: 6,
      padding: '12px 16px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
      fontFamily: 'var(--sans)',
      backdropFilter: 'blur(8px)',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '12px 24px',
      pointerEvents: 'none'
    }}>
      {data.map((k, idx) => (
        <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--muted)', fontWeight: 600 }}>
            {k.label}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 500, color: k.color, letterSpacing: -0.3 }}>
            {k.value}
          </div>
        </div>
      ))}
    </div>
  )
}
