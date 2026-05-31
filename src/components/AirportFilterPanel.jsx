import React, { useState, useMemo } from 'react'

const CONTINENT_LABELS = {
  SOUTH_AMERICA: 'América del Sur',
  EUROPE: 'Europa',
  ASIA: 'Asia / Oriente Medio',
}
const CONTINENT_ORDER = ['SOUTH_AMERICA', 'EUROPE', 'ASIA']

const s = {
  panel: {
    height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  sectionHeader: (disabled) => ({
    padding: '7px 12px 5px',
    flexShrink: 0,
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    display: 'flex', alignItems: 'center', gap: 8,
    opacity: disabled ? 0.4 : 1,
  }),
  sectionTitle: {
    fontFamily: 'var(--sans)', fontSize: 9, textTransform: 'uppercase',
    letterSpacing: 2, color: 'var(--blue)', fontWeight: 700,
  },
  allBtn: (disabled) => ({
    fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 7px',
    borderRadius: 3, border: '1px solid rgba(255,255,255,0.10)',
    background: 'rgba(255,255,255,0.04)', color: 'var(--muted)',
    cursor: disabled ? 'not-allowed' : 'pointer', letterSpacing: 0.3,
  }),
  counter: {
    fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', marginLeft: 'auto',
  },
  scroll: {
    flex: 1, overflowY: 'auto', padding: '2px 0', minHeight: 0,
  },
  continentRow: (disabled) => ({
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 10px 4px',
    cursor: disabled ? 'default' : 'pointer',
    userSelect: 'none',
    overflow: 'hidden',
    background: 'rgba(255,255,255,0.02)',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
  }),
  continentLabel: {
    fontFamily: 'var(--sans)', fontSize: 9, textTransform: 'uppercase',
    letterSpacing: 1.5, color: 'var(--muted)', fontWeight: 700, flex: 1,
  },
  chevron: (expanded) => ({
    fontSize: 13, color: 'var(--blue)', opacity: 1, flexShrink: 0,
    lineHeight: 1,
    transition: 'transform 0.15s ease',
    transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
    display: 'inline-block',
    fontFamily: 'monospace',
  }),
  apRow: (disabled) => ({
    display: 'flex', alignItems: 'center', gap: 7,
    padding: '3px 10px 3px 26px',
    opacity: disabled ? 0.3 : 1,
  }),
  apLabel: (checked) => ({
    fontFamily: 'var(--mono)', fontSize: 10,
    color: checked ? 'var(--text)' : 'var(--text-secondary)',
    flex: 1, lineHeight: 1.3,
  }),
  checkbox: {
    width: 12, height: 12, accentColor: 'var(--blue)', flexShrink: 0,
  },
  divider: {
    height: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0,
  },
  footer: {
    padding: '5px 12px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)',
    flexShrink: 0,
  },
}

function groupByContinent(airports) {
  const g = {}
  for (const ap of (airports || [])) {
    const key = ap.continent || 'OTHER'
    if (!g[key]) g[key] = []
    g[key].push(ap)
  }
  return g
}

function getContinentKeys(grouped) {
  const known = CONTINENT_ORDER.filter((k) => grouped[k])
  const others = Object.keys(grouped).filter((k) => !CONTINENT_ORDER.includes(k))
  return [...known, ...others]
}

function AirportList({ airports, selectedIds, onToggle, disabled, blockedIds }) {
  const grouped = useMemo(() => groupByContinent(airports), [airports])
  const keys = useMemo(() => getContinentKeys(grouped), [grouped])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const blockedSet = useMemo(() => new Set(blockedIds || []), [blockedIds])

  const [expanded, setExpanded] = useState({})

  function toggleExpand(key) {
    if (disabled) return
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function toggleContinent(key) {
    if (disabled) return
    const ids = (grouped[key] || []).map((a) => a.id)
    const toggleable = ids.filter((id) => !blockedSet.has(id))
    const allChecked = toggleable.every((id) => selectedSet.has(id))
    const newSet = new Set(selectedSet)
    if (allChecked) {
      const remaining = [...newSet].filter((id) => !toggleable.includes(id))
      if (remaining.length === 0) return
      toggleable.forEach((id) => newSet.delete(id))
    } else {
      toggleable.forEach((id) => newSet.add(id))
    }
    onToggle([...newSet])
  }

  function toggleOne(id) {
    if (disabled || blockedSet.has(id)) return
    const newSet = new Set(selectedSet)
    if (newSet.has(id)) {
      if (newSet.size === 1) return
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    onToggle([...newSet])
  }

  return (
    <div style={s.scroll}>
      {keys.map((key) => {
        const group = grouped[key] || []
        const isExpanded = !!expanded[key]
        const toggleable = group.map((a) => a.id).filter((id) => !blockedSet.has(id))
        const allChecked = group.every((ap) => selectedSet.has(ap.id))
        const someChecked = group.some((ap) => selectedSet.has(ap.id))

        return (
          <div key={key}>
            <div style={s.continentRow(disabled)} onClick={() => toggleExpand(key)}>
              <input
                type="checkbox"
                style={{ ...s.checkbox, cursor: (disabled || toggleable.length === 0) ? 'not-allowed' : 'pointer' }}
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked }}
                disabled={disabled || toggleable.length === 0}
                onChange={() => toggleContinent(key)}
                onClick={(e) => e.stopPropagation()}
              />
              <span style={s.continentLabel}>{CONTINENT_LABELS[key] || key}</span>
              <span style={s.chevron(isExpanded)}>&#x25B6;&#xFE0E;</span>
            </div>

            {isExpanded && group.map((ap) => {
              const checked = selectedSet.has(ap.id)
              const blocked = blockedSet.has(ap.id)
              const isLast = checked && selectedSet.size === 1
              const notClickable = disabled || blocked || isLast
              return (
                <div key={ap.id} style={s.apRow(disabled)}>
                  <input
                    type="checkbox"
                    style={{ ...s.checkbox, cursor: notClickable ? 'not-allowed' : 'pointer' }}
                    checked={checked}
                    disabled={notClickable}
                    onChange={() => toggleOne(ap.id)}
                  />
                  <span style={s.apLabel(checked)}>
                    {ap.id} — {ap.name || ap.ciudad}
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export default function AirportFilterPanel({
  airports, originIds, setOriginIds, destIds, setDestIds,
  threshold, setThreshold,
}) {
  const allIds = useMemo(() => (airports || []).map((a) => a.id), [airports])

  const hasOrigin = originIds == null || originIds.length > 0
  const destDisabled = !hasOrigin

  const originCount = originIds == null ? allIds.length : originIds.length

  const resolvedOriginIds = useMemo(() => originIds ?? allIds, [originIds, allIds])
  const resolvedDestIds = useMemo(() => destIds ?? allIds, [destIds, allIds])

  const originSet = useMemo(() => new Set(resolvedOriginIds), [resolvedOriginIds])
  const destSet = useMemo(() => new Set(resolvedDestIds), [resolvedDestIds])

  // When exactly 1 origin is selected, hide it from the dest list
  const destAirports = useMemo(() => {
    if (originSet.size !== 1) return airports || []
    const soleOrigin = [...originSet][0]
    return (airports || []).filter((a) => a.id !== soleOrigin)
  }, [airports, originSet])

  const destAllIds = useMemo(() => destAirports.map((a) => a.id), [destAirports])

  // If sole origin was in destIds, remove it
  const resolvedDestIdsFiltered = useMemo(() => {
    if (originSet.size !== 1) return resolvedDestIds
    const soleOrigin = [...originSet][0]
    return resolvedDestIds.filter((id) => id !== soleOrigin)
  }, [resolvedDestIds, originSet])

  const destCount = resolvedDestIdsFiltered.length === destAllIds.length
    ? destAllIds.length
    : resolvedDestIdsFiltered.length

  function handleOriginToggle(ids) {
    const newOriginSet = new Set(ids)
    if (newOriginSet.size === 1) {
      const soleOrigin = [...newOriginSet][0]
      // Remove sole origin from dest selection if present
      if (destSet.has(soleOrigin)) {
        const newDest = resolvedDestIds.filter((id) => id !== soleOrigin)
        setDestIds(newDest.length === 0 || newDest.length === allIds.length - 1 ? null : newDest)
      }
    }
    setOriginIds(ids.length === allIds.length ? null : ids)
  }

  function handleDestToggle(ids) {
    setDestIds(ids.length === destAllIds.length ? null : ids)
  }

  return (
    <div style={s.panel}>
      {/* ── ORIGEN ── */}
      <div style={s.sectionHeader(false)}>
        <span style={s.sectionTitle}>Origen</span>
        <button style={s.allBtn(false)} onClick={() => setOriginIds(null)}>Todos</button>
        <span style={s.counter}>{originCount}/{allIds.length}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <AirportList
          airports={airports}
          selectedIds={resolvedOriginIds}
          onToggle={handleOriginToggle}
          disabled={false}
          blockedIds={[]}
        />
      </div>

      <div style={s.divider} />

      {/* ── DESTINO ── */}
      <div style={s.sectionHeader(destDisabled)}>
        <span style={s.sectionTitle}>Destino</span>
        <button style={s.allBtn(destDisabled)} onClick={destDisabled ? undefined : () => setDestIds(null)}>Todos</button>
        <span style={s.counter}>{destCount}/{destAllIds.length}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <AirportList
          airports={destAirports}
          selectedIds={resolvedDestIdsFiltered}
          onToggle={handleDestToggle}
          disabled={destDisabled}
          blockedIds={[]}
        />
      </div>

      <div style={s.footer}>
        {originCount} origen{originCount !== 1 ? 'es' : ''} · {destCount} destino{destCount !== 1 ? 's' : ''}
      </div>

      {threshold != null && setThreshold && (
        <>
          <div style={s.divider} />
          <div style={{ padding: '10px 12px', flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--sans)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--blue)', fontWeight: 700, display: 'block', marginBottom: 8 }}>Alerta Warehouse</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text)', fontWeight: 500 }}>Umbral crítico</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--amber)', fontWeight: 500 }}>{threshold}%</span>
            </div>
            <input
              type="range" min={50} max={99} step={1}
              value={threshold}
              style={{ width: '100%', accentColor: 'var(--amber)', cursor: 'pointer', height: 4, margin: '2px 0' }}
              onChange={(e) => setThreshold(+e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--muted)' }}>50%</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--muted)' }}>99%</span>
            </div>
          </div>

          <div style={s.divider} />
          <div style={{ padding: '10px 12px', flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--sans)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--blue)', fontWeight: 700, display: 'block', marginBottom: 8 }}>Semáforo</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[
                { color: '#22d07a', label: 'OK / dentro de SLA' },
                { color: '#f5a623', label: 'Alerta / warehouse alto' },
                { color: '#f04b4b', label: 'Crítico / SLA vencido' },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: color, boxShadow: `0 0 5px ${color}90` }} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
