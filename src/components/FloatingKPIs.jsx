import React from 'react'

function occColor(pct) {
  if (pct >= 85) return 'var(--red)'
  if (pct >= 60) return 'var(--amber)'
  return 'var(--green)'
}

export default function FloatingKPIs({ kpis, hasSimulation }) {
  const data = [
    { label: 'Ocup. Vuelos',   value: hasSimulation ? `${Number(kpis.globalFleetOccupancy).toFixed(1)}%` : '—', color: hasSimulation ? occColor(kpis.globalFleetOccupancy) : 'var(--muted)' },
    { label: 'Ocup. Almacenes',value: hasSimulation ? `${Number(kpis.globalWarehouseOccupancy).toFixed(1)}%` : '—', color: hasSimulation ? occColor(kpis.globalWarehouseOccupancy) : 'var(--muted)' },
    { label: 'Espacio Disp. (V)', value: hasSimulation ? kpis.freeFleetSpace.toLocaleString() : '—', color: hasSimulation ? 'var(--text-bright)' : 'var(--muted)' },
    { label: 'Espacio Disp. (A)', value: hasSimulation ? kpis.freeWarehouseSpace.toLocaleString() : '—', color: hasSimulation ? 'var(--text-bright)' : 'var(--muted)' },
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
