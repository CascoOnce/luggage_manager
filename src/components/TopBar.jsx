import React, { useState, useEffect } from 'react'

const s = {
  bar: {
    display: 'flex', alignItems: 'center', gap: 0,
    background: 'rgba(22,27,34,0.85)', borderBottom: '1px solid var(--border)',
    height: 56, position: 'relative', zIndex: 100, flexShrink: 0,
    backdropFilter: 'blur(8px)', overflow: 'hidden', minWidth: 0,
  },
  logoWrap: {
    padding: '0 20px', borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
    height: '100%', flexShrink: 0, gap: 2,
  },
  logo: {
    fontFamily: 'var(--sans)', fontSize: 16, fontWeight: 800,
    color: 'var(--blue-bright)', letterSpacing: 2,
  },
  logoSub: {
    fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)',
    letterSpacing: 1.8, fontWeight: 400,
  },
  kpiStrip: { display: 'flex', flex: 1, height: '100%' },
  tabStrip: {
    display: 'flex',
    height: '100%',
    alignItems: 'stretch',
    gap: 0,
    flex: '0 0 auto',
  },
  tab: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    padding: '0 12px',
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    color: 'var(--muted)',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    background: 'transparent',
    border: 'none',
    outline: 'none',
  },


  controls: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '0 10px', height: '100%', flexShrink: 0,
  },
  btnStart: (running) => ({
    background: running ? 'rgba(240,75,75,0.12)' : 'rgba(61,139,255,0.12)',
    color: running ? 'var(--red)' : 'var(--blue-bright)',
    border: `1px solid ${running ? 'rgba(240,75,75,0.4)' : 'rgba(61,139,255,0.4)'}`,
    fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 700, letterSpacing: 0.8,
    padding: '6px 14px', borderRadius: 5, cursor: 'pointer', textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  }),
  btnReset: {
    background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--muted)', fontFamily: 'var(--sans)', fontSize: 13,
    fontWeight: 600, padding: '6px 10px', borderRadius: 5, cursor: 'pointer',
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
}



export default function TopBar({
  simRateLabel,
  kpis,
  onCancel, onRestart,
  canRestart,
  useBackend, backendState,
  theme, onToggleTheme,
  onNavigate,
  onIniciar,
  screen,
  hasSimulation,
  isOpsActive,
  colapsoPunto,
  liveActive,
  onShowWidgets,
}) {
  const isBackendRunning = backendState?.enEjecucion === true
  const isBackendFinished = backendState?.finalizada === true



  const tabs = [
    { key: 'main', label: 'OPERACIONES' },
    { key: 'envios', label: 'ENVÍOS' },
    { key: 'dashboard', label: 'PANEL' },
    { key: 'resultados', label: 'RESULTADOS' },
    ...(colapsoPunto ? [{ key: 'colapso', label: '⚠ COLAPSO', alert: true }] : []),
  ]

  function isActiveTab(key) {
    if (key === 'main') return screen === 'main' || screen === 'ops'
    if (key === 'resultados') return screen === 'resultados'
    return screen === key
  }

  return (
    <div style={s.bar}>
      <div style={s.logoWrap}>
        <div style={s.logo}>TASF<span style={{ color: 'var(--muted)' }}>.</span>B2B</div>
        <div style={s.logoSub}>PANEL DE OPERACIONES (UTC)</div>
      </div>



      <div style={s.tabStrip}>
        {tabs.map((tab) => {
          const active = isActiveTab(tab.key)
          const disabled =
            !hasSimulation && !isOpsActive && (tab.key === 'envios' || tab.key === 'dashboard')
          const isAlert = tab.alert
          return (
            <button
              key={tab.key}
              disabled={disabled}
              style={{
                ...s.tab,
                color: active ? (isAlert ? 'var(--red)' : 'var(--text-bright)') : (isAlert ? 'rgba(240,75,75,0.7)' : 'var(--muted)'),
                borderBottom: active ? `2px solid ${isAlert ? 'var(--red)' : 'var(--blue)'}` : '2px solid transparent',
                opacity: disabled ? 0.3 : 1,
                cursor: disabled ? 'default' : 'pointer',
              }}
              onClick={() => !disabled && onNavigate(tab.key)}
              onMouseEnter={(event) => {
                if (disabled) return
                event.currentTarget.style.color = active ? 'var(--text-bright)' : 'var(--text)'
                event.currentTarget.style.background = 'rgba(255,255,255,0.03)'
              }}
              onMouseLeave={(event) => {
                if (disabled) return
                event.currentTarget.style.color = active ? 'var(--text-bright)' : 'var(--muted)'
                event.currentTarget.style.background = 'transparent'
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>



      <div style={s.controls}>
        {onShowWidgets && (
          <button style={s.btnReset} onClick={onShowWidgets} title="Mostrar / Restaurar KPIs y Reloj">
            RESTAURAR WIDGETS
          </button>
        )}
        <button style={s.btnReset} onClick={onToggleTheme}>{theme === 'dark' ? '☀' : '🌙'}</button>

        {/* Sin simulación: solo CONFIGURAR */}
        {!hasSimulation && (
          <button
            style={{ ...s.btnStart(false), opacity: liveActive ? 0.4 : 1, cursor: liveActive ? 'default' : 'pointer' }}
            onClick={liveActive ? undefined : onIniciar}
            disabled={liveActive}
          >
            CONFIGURAR
          </button>
        )}

        {/* Simulación en curso: Cancelar */}
        {isBackendRunning && (
          <button
            style={{ ...s.btnReset, color: 'var(--red)', borderColor: 'rgba(240,75,75,0.4)' }}
            onClick={onCancel}
          >
            CANCELAR
          </button>
        )}

        {/* Simulación finalizada: Empezar de nuevo + Configurar */}
        {isBackendFinished && !isBackendRunning && (
          <>
            {canRestart && (
              <button style={s.btnStart(false)} onClick={onRestart}>
                ↺ EMPEZAR DE NUEVO
              </button>
            )}
            <button style={s.btnReset} onClick={() => onNavigate('config')}>
              CONFIGURAR
            </button>
          </>
        )}
      </div>
    </div>
  )
}
