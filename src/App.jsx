import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView from './components/MapView.jsx'
import RightPanel from './components/RightPanel.jsx'
import TopBar from './components/TopBar.jsx'
import { api } from './services/api.js'
import ConfigScreen from './screens/ConfigScreen.jsx'
import EnviosScreen from './screens/EnviosScreen.jsx'
import DashboardScreen from './screens/DashboardScreen.jsx'
import ResultadosScreen from './screens/ResultadosScreen.jsx'
import ColapsoScreen from './screens/ColapsoScreen.jsx'
import LiveScreen from './screens/LiveScreen.jsx'
import DrawerAeropuerto from './drawers/DrawerAeropuerto.jsx'
import DrawerVuelo from './drawers/DrawerVuelo.jsx'
import AirportFilterPanel from './components/AirportFilterPanel.jsx'
import { getLiveState } from './services/api.js'

export default function App() {
  const ALGORITHM = 'SIMULATED_ANNEALING'
  const SIM_MINUTES_PER_REAL_SECOND = 30 // ~48s per simulated day
  const [realElapsedSeconds, setRealElapsedSeconds] = useState(0)

  const [threshold, setThreshold] = useState(80)
  const [theme, setTheme] = useState('dark')
  const [screen, setScreen] = useState('main')
  const [configOpen, setConfigOpen] = useState(false)
  const [backendState, setBackendState] = useState(null)
  const [lastParams, setLastParams] = useState(null)
  const [isRestarting, setIsRestarting] = useState(false)
  const [staticAirports, setStaticAirports] = useState([])
  const [airportGraph, setAirportGraph] = useState(null)
  const [originIds, setOriginIds] = useState(null)
  const [destIds, setDestIds] = useState(null)

  const [selectedFlight, setSelectedFlight] = useState(null)
  const [mapSelectedAirport, setMapSelectedAirport] = useState(null)
  const [mapSelectedVuelo, setMapSelectedVuelo] = useState(null)
  const [simClockMinutes, setSimClockMinutes] = useState(0)

  const realStartRef = useRef(null)
  const accumulatedRealMsRef = useRef(0)
  const pollingRef = useRef(null)
  const autoStepRef = useRef(null)
  const pollingErrorsRef = useRef(0)
  const stepInProgressRef = useRef(false)
  const nextDayStateRef = useRef(null)
  const prefetchFiredRef = useRef(false)
  const colapsoPuntoAlertedRef = useRef(false)

  const [pollingError, setPollingError] = useState(null)

  const [liveState, setLiveState] = useState(null)
  const livePollingRef = useRef(null)
  const liveApplyRef = useRef(null)
  const liveWindowStartRef = useRef(null)
  const liveNextStateRef = useRef(null)

  const [autoStep, setAutoStep] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)

  useEffect(() => {
    function onKey(e) {
      if (e.shiftKey && e.key === 'D') setDebugOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function stopAutoStep() {
    clearInterval(autoStepRef.current)
  }

  function parseTimeToMinutes(value) {
    if (!value || typeof value !== 'string' || !value.includes(':')) return null
    const [hh, mm] = value.split(':').map((v) => Number(v))
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
    return hh * 60 + mm
  }

  function isActiveAtMinute(nowMin, depMin, arrMin) {
    if (depMin == null || arrMin == null) return false
    const m = nowMin >= 1440 ? 1439 : nowMin
    if (arrMin > depMin) {
      return m >= depMin && m < arrMin
    }
    return m >= depMin || m < arrMin
  }

  function flightFractionAtMinute(nowMin, depMin, arrMin) {
    const total = (arrMin - depMin + 1440) % 1440
    if (total <= 0) return 0
    const elapsed = (nowMin - depMin + 1440) % 1440
    return Math.max(0, Math.min(1, elapsed / total))
  }

  function onToggleSim() {
    setAutoStep((prev) => !prev)
  }

  function onReset() {
    setAutoStep(false)
    realStartRef.current = null
    accumulatedRealMsRef.current = 0
    setRealElapsedSeconds(0)
    setSelectedFlight(null)
    setConfigOpen(false)
    setScreen('main')
  }

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    stopPolling()
    pollingErrorsRef.current = 0
    setPollingError(null)
    pollingRef.current = setInterval(async () => {
      try {
        const state = await api.getState()
        pollingErrorsRef.current = 0
        setPollingError(null)
        // Only update state if backend has real data or is actively running/finished.
        // Prevents empty post-reset state from overwriting a valid finalizada snapshot.
        if (state && (state.enEjecucion || state.finalizada) && !stepInProgressRef.current) {
          setBackendState(state)
          if (state.finalizada) {
            stopPolling()
            setScreen('resultados')
          }
        }
      } catch (err) {
        pollingErrorsRef.current += 1
        if (pollingErrorsRef.current >= 3) {
          setPollingError('No se puede contactar el servidor')
        }
        console.error('Polling error:', err)
      }
    }, 2000)
  }, [stopPolling])

  function onIniciar() {
    if (!backendState) {
      setScreen('config')
      setConfigOpen(true)
      return
    }
    if (autoStep) {
      onToggleSim()
    }
  }

  function onToggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    api.getAirportGraph().then(setAirportGraph).catch(() => {})
  }, [])

  useEffect(() => {
    api.getAirports()
      .then((data) => setStaticAirports(
        data.map((airport) => ({
          ...airport,
          id: airport.codigoIATA,
          name: airport.nombre,
          continent: airport.continent || airport.continente,
          currentOccupation: airport.ocupacionActual ?? 0,
          warehouseCapacity: airport.capacidadAlmacen ?? 600,
        }))
      ))
      .catch(() => {})
  }, [])

  useEffect(() => {
    return () => {
      stopPolling()
      stopLive()
    }
  }, [stopPolling]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (backendState?.enEjecucion && !backendState?.finalizada) {
      setAutoStep(true)
    }
    if (backendState?.finalizada) {
      setAutoStep(false)
      stopAutoStep()
    }
  }, [backendState?.enEjecucion, backendState?.finalizada])

  useEffect(() => {
    if (backendState?.colapsoPunto && !colapsoPuntoAlertedRef.current) {
      colapsoPuntoAlertedRef.current = true
      setAutoStep(false)
      clearInterval(autoStepRef.current)
    }
  }, [backendState?.colapsoPunto])

  useEffect(() => {
    if (autoStep) {
      autoStepRef.current = setInterval(async () => {
        setSimClockMinutes((current) => {
          const next = current + SIM_MINUTES_PER_REAL_SECOND
          return Math.min(next, 1440)
        })
      }, 1000)
    } else {
      clearInterval(autoStepRef.current)
    }
    return () => clearInterval(autoStepRef.current)
  }, [autoStep])

  // Prefetch next day starting at sim 20:00 (minute 1200) so it's ready at midnight.
  // stepInProgressRef stays true until applyNewDay fires at 1440 to block polling
  // from picking up the new backend state before the frontend clock reaches midnight.
  useEffect(() => {
    if (!autoStep) return
    if (simClockMinutes < 1200 || simClockMinutes >= 1440) return
    if (prefetchFiredRef.current) return

    prefetchFiredRef.current = true
    stepInProgressRef.current = true
    nextDayStateRef.current = null
    ;(async () => {
      try {
        const newState = await api.stepSimulation()
        nextDayStateRef.current = newState ?? null
      } catch (err) {
        console.error('Prefetch error:', err)
        nextDayStateRef.current = null
        prefetchFiredRef.current = false
        stepInProgressRef.current = false
      }
      // intentionally NO finally — stepInProgressRef released only in applyNewDay
    })()
  }, [simClockMinutes, autoStep])

  // At midnight: apply prefetched state (instant) or wait if prefetch not ready yet
  useEffect(() => {
    if (!autoStep) return
    if (simClockMinutes < 1440) return

    const applyNewDay = (newState) => {
      stepInProgressRef.current = false
      setBackendState(newState)
      setSimClockMinutes(0)
      prefetchFiredRef.current = false
      nextDayStateRef.current = null
      if (newState.finalizada) {
        setAutoStep(false)
        clearInterval(autoStepRef.current)
        stopPolling()
        setScreen('resultados')
      }
    }

    if (nextDayStateRef.current) {
      // Prefetch already done — apply instantly, no freeze
      applyNewDay(nextDayStateRef.current)
      return
    }

    // Prefetch not ready (backend took > 8s) — wait for it
    stepInProgressRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        // If prefetch is in-flight, poll until it resolves
        const poll = () => new Promise((resolve) => {
          const check = () => {
            if (nextDayStateRef.current !== null || !prefetchFiredRef.current) {
              resolve(nextDayStateRef.current)
            } else {
              setTimeout(check, 100)
            }
          }
          check()
        })
        const newState = prefetchFiredRef.current
          ? await poll()
          : await api.stepSimulation()
        if (cancelled || !newState) return
        applyNewDay(newState)
      } catch (err) {
        console.error('Auto-step error:', err)
      } finally {
        stepInProgressRef.current = false
      }
    })()

    return () => { cancelled = true }
  }, [simClockMinutes, autoStep])

  useEffect(() => {
    if (autoStep && realStartRef.current === null) {
      realStartRef.current = Date.now()
    }
    if (!autoStep && realStartRef.current !== null) {
      accumulatedRealMsRef.current += Date.now() - realStartRef.current
      realStartRef.current = null
      setRealElapsedSeconds(Math.floor(accumulatedRealMsRef.current / 1000))
    }
  }, [autoStep])

  useEffect(() => {
    if (!autoStep) return undefined
    const id = setInterval(() => {
      const liveMs = accumulatedRealMsRef.current + (Date.now() - realStartRef.current)
      setRealElapsedSeconds(Math.floor(liveMs / 1000))
    }, 250)
    return () => clearInterval(id)
  }, [autoStep])


  const simState = backendState ?? {
    currentDay: 0, totalDays: 0,
    elapsedSeconds: 0, algorithm: ALGORITHM,
    kpis: {
      bagsInTransit: 0, bagsDelivered: 0,
      slaCompliance: 0, activeFlights: 0,
      slaViolated: 0,
    },
    airports: staticAirports,
    flights: [], routes: [],
    throughputHistory: [], logOperaciones: [],
  }

  const normalizedAirports = useMemo(() => {
    const airports = simState?.aeropuertos || simState?.airports || []
    const vuelosList = simState?.vuelos || []
    return airports.map((airport) => {
      const iata = airport.codigoIATA || airport.id
      return {
        ...airport,
        id: iata,
        name: airport.name || airport.nombre,
        continent: airport.continent || airport.continente,
        lat: airport.lat,
        lng: airport.lng,
        currentOccupation: airport.currentOccupation ?? airport.ocupacionActual ?? 0,
        warehouseCapacity: airport.warehouseCapacity ?? airport.capacidadAlmacen ?? 600,
        vuelosSalientes: vuelosList.filter((v) => (v.origen || v.origin) === iata && v.enUso).length,
        vuelosLlegando:  vuelosList.filter((v) => (v.destino || v.destination) === iata && v.enUso).length,
      }
    })
  }, [simState?.aeropuertos, simState?.airports, simState?.vuelos])

  const normalizedFlights = useMemo(() =>
    simState?.vuelos
      ? simState.vuelos.map((flight, idx) => ({
        id: flight.id || flight.codigoVuelo || `FL-${idx}`,
        origin: flight.origin || flight.origen,
        destination: flight.destination || flight.destino,
        type: flight.type || flight.tipo || 'intercontinental',
        status: (flight.status || flight.estado) === 'cancelado'
          ? 'cancelled'
          : (flight.status || flight.estado) === 'completado'
            ? 'completed'
            : 'active',
        currentLoad: flight.currentLoad ?? flight.cargaActual ?? 0,
        capacity: flight.capacity ?? flight.capacidadTotal ?? 300,
        hour: Number((flight.horaSalida || '00:00').split(':')[0]),
        fraction: flight.fraction ?? 0,
      }))
      : (simState?.flights || []),
  [simState?.vuelos, simState?.flights])

  const originSet = useMemo(() => originIds ? new Set(originIds) : null, [originIds])
  const destSet = useMemo(() => destIds ? new Set(destIds) : null, [destIds])

  const visibleAirports = useMemo(() => {
    if (!originSet && !destSet) return normalizedAirports
    const visible = new Set()
    for (const ap of normalizedAirports) {
      if (!originSet || originSet.has(ap.id)) visible.add(ap.id)
      if (!destSet || destSet.has(ap.id)) visible.add(ap.id)
    }
    return normalizedAirports.filter((a) => visible.has(a.id))
  }, [normalizedAirports, originSet, destSet])

  const normalizedRoutes = useMemo(() =>
    simState?.envios
      ? simState.envios.map((envio, idx) => ({
        id: envio.idEnvio || `RT-${idx}`,
        status: envio.estado === 'RETRASADO' ? 'red' : envio.estado === 'ENTREGADO' ? 'green' : 'amber',
        replanified: false,
        bags: envio.cantidadMaletas || 0,
        type: Number(envio.sla || 1) > 1 ? 'inter' : 'same',
        flightLegs: [{ origin: envio.aeropuertoOrigen, destination: envio.aeropuertoDestino }],
        etaRemaining: 0,
      }))
      : (simState?.routes || []),
  [simState?.envios, simState?.routes])


  // Heavy work: filter + parse times. Only reruns when backend data changes (~every 12s).
  const activeVuelosWithTimes = useMemo(() => {
    if (!backendState?.vuelos) return []
    return backendState.vuelos
      .filter((v) => v.estado === 'activo' && v.enUso)
      .map((v) => ({
        id: v.codigoVuelo,
        origin: v.origen,
        destination: v.destino,
        currentLoad: v.maletasAsignadas ?? v.cargaActual ?? 0,
        capacity: v.capacidadTotal ?? 300,
        type: v.tipo === 'continental' ? 'continental' : 'intercontinental',
        status: 'active',
        horaSalida: v.horaSalida,
        horaLlegada: v.horaLlegada,
        depMin: parseTimeToMinutes(v.horaSalida),
        arrMin: parseTimeToMinutes(v.horaLlegada),
      }))
  }, [backendState?.vuelos])

  // Light work: apply clock position. Reruns every second but only on pre-filtered list.
  const backendFlights = useMemo(() =>
    activeVuelosWithTimes
      .filter((v) =>
        isActiveAtMinute(simClockMinutes, v.depMin, v.arrMin) &&
        (!originSet || originSet.has(v.origin)) &&
        (!destSet || destSet.has(v.destination))
      )
      .map((v) => ({
        ...v,
        fraction: flightFractionAtMinute(simClockMinutes, v.depMin, v.arrMin),
      })),
  [activeVuelosWithTimes, simClockMinutes, originSet, destSet])

  const fechaSimuladaDisplay = useMemo(() => {
    if (!backendState?.fechaSimulada) return null
    const source = new Date(backendState.fechaSimulada)
    if (Number.isNaN(source.getTime())) return backendState.fechaSimulada

    source.setHours(0, 0, 0, 0)
    const current = new Date(source.getTime() + simClockMinutes * 60000)
    const mm = String(current.getMonth() + 1).padStart(2, '0')
    const dd = String(current.getDate()).padStart(2, '0')
    const hh = String(current.getHours()).padStart(2, '0')
    const mi = String(current.getMinutes()).padStart(2, '0')
    const ss = String(realElapsedSeconds % 60).padStart(2, '0')
    return `${mm}-${dd} ${hh}:${mi}:${ss}`
  }, [backendState?.fechaSimulada, simClockMinutes, realElapsedSeconds])

  useEffect(() => {
    if (!selectedFlight) {
      setMapSelectedVuelo(null)
      return
    }
    const vuelo = backendFlights.find((f) => f.id === selectedFlight)
    if (vuelo) setMapSelectedVuelo(vuelo)
    // If vuelo not found in current frame, keep the previous drawer content open.
  }, [selectedFlight, backendState, backendFlights])

  const activeKpis = useMemo(() =>
    backendState?.kpis
      ? {
          bagsInTransit: backendState.kpis.maletasEnTransito,
          bagsDelivered: backendState.kpis.maletasEntregadas,
          slaCompliance: backendState.kpis.cumplimientoSLA,
          activeFlights: backendState.kpis.vuelosActivos,
          slaViolated: backendState.kpis.slaVencidos,
        }
      : simState?.kpis ?? {
          bagsInTransit: 0, bagsDelivered: 0,
          slaCompliance: 0, activeFlights: 0,
          slaViolated: 0,
        },
  [backendState?.kpis, simState?.kpis])

  async function handleReset() {
    prefetchFiredRef.current = false
    nextDayStateRef.current = null
    colapsoPuntoAlertedRef.current = false
    try {
      await api.resetSimulation()
    } catch (err) {
      console.error('Reset backend error:', err)
    }
    stopPolling()
    pollingErrorsRef.current = 0
    setPollingError(null)
    onReset()
    setBackendState(null)
  }

  async function handleStop() {
    prefetchFiredRef.current = false
    nextDayStateRef.current = null
    try {
      const state = await api.stopSimulation()
      if (state) setBackendState(state)
    } catch (err) {
      console.error('Stop backend error:', err)
    }
    stopPolling()
    setAutoStep(false)
    clearInterval(autoStepRef.current)
    setScreen('resultados')
  }

  async function handleRestart() {
    if (!backendState) return
    prefetchFiredRef.current = false
    nextDayStateRef.current = null
    stopPolling()
    setAutoStep(false)
    clearInterval(autoStepRef.current)
    setSimClockMinutes(0)
    setIsRestarting(true)
    try {
      const state = await api.restartSimulation()
      if (state) {
        setBackendState(state)
        setScreen('main')
        startPolling()
      }
    } catch (err) {
      console.error('Restart backend error:', err)
    } finally {
      setIsRestarting(false)
    }
  }

  function toLocalISO(date) {
    const pad = (n) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  function stopLive() {
    clearTimeout(livePollingRef.current)
    clearTimeout(liveApplyRef.current)
    livePollingRef.current = null
    liveApplyRef.current = null
    liveNextStateRef.current = null
    liveWindowStartRef.current = null
    setLiveState(null)
  }

  function scheduleLiveTimers() {
    clearTimeout(livePollingRef.current)
    clearTimeout(liveApplyRef.current)

    // 55-min prefetch
    livePollingRef.current = setTimeout(() => {
      const nextFrom = new Date(liveWindowStartRef.current.getTime() + 60 * 60 * 1000)
      getLiveState(toLocalISO(nextFrom))
        .then((state) => { liveNextStateRef.current = state })
        .catch((err) => console.error('Live prefetch error:', err))
    }, 55 * 60 * 1000)

    // 60-min apply
    liveApplyRef.current = setTimeout(() => {
      const nextWindowStart = new Date(liveWindowStartRef.current.getTime() + 60 * 60 * 1000)
      liveWindowStartRef.current = nextWindowStart
      if (liveNextStateRef.current) {
        setLiveState(liveNextStateRef.current)
      } else {
        getLiveState(toLocalISO(nextWindowStart)).then(setLiveState).catch(console.error)
      }
      liveNextStateRef.current = null
      scheduleLiveTimers()
    }, 60 * 60 * 1000)
  }

  function startLive() {
    stopLive()
    const now = new Date()
    liveWindowStartRef.current = now
    getLiveState(toLocalISO(now)).then(setLiveState).catch((err) => console.error('Live fetch error:', err))
    scheduleLiveTimers()
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleNavigate = useCallback((next) => {
    setConfigOpen(false)
    if (next === 'live') {
      setScreen('live')
      startLive()
    } else {
      if (screen === 'live') stopLive()
      setScreen(next)
    }
  }, [screen])

  const handleCloseAirport = useCallback(() => setMapSelectedAirport(null), [])
  const handleCloseVuelo   = useCallback(() => { setMapSelectedVuelo(null); setSelectedFlight(null) }, [])
  const handleCancelFlight = useCallback(async (codigoVuelo) => {
    try {
      await api.cancelFlight(codigoVuelo)
      setMapSelectedVuelo(null)
      setSelectedFlight(null)
    } catch (err) {
      alert('Error al cancelar vuelo: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [])
  const handleBackToMain   = useCallback(() => setScreen('main'),            [])

  const handleCancelConfig = useCallback(() => {
    setScreen('main')
    setConfigOpen(false)
  }, [])

  const handleSimulationStarted = useCallback((state, params) => {
    setConfigOpen(false)
    setBackendState(state)
    setLastParams(params)
    setSimClockMinutes(0)
    setScreen('main')
    startPolling()
  }, [startPolling])

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <TopBar
        currentDay={backendState?.diaActual ?? 0}
        totalDays={backendState?.totalDias ?? 0}
        elapsedSeconds={backendState?.diaActual ? backendState.diaActual * 86400 : 0}
        fechaSimulada={fechaSimuladaDisplay}
        realElapsedSeconds={realElapsedSeconds}
        simRateLabel={null}
        kpis={activeKpis}
        isRunning={autoStep}
        backendState={backendState}
        onToggleSim={onToggleSim}
        onStop={handleStop}
        onRestart={handleRestart}
        onReset={handleReset}
        canRestart={Boolean(backendState)}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onNavigate={handleNavigate}
        onIniciar={onIniciar}
        screen={screen}
        hasSimulation={Boolean(backendState)}
        colapsoPunto={backendState?.colapsoPunto ?? null}
        liveActive={screen === 'live'}
      />
      {backendState?.colapsoPunto && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          height: 32, padding: '0 20px',
          background: 'rgba(240,75,75,0.12)',
          borderBottom: '1px solid rgba(240,75,75,0.35)',
          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--red)',
        }}>
          <span style={{ fontWeight: 700 }}>⚠ COLAPSO DETECTADO</span>
          <span style={{ color: 'rgba(240,75,75,0.4)' }}>|</span>
          <span>DÍA {backendState.colapsoPunto.dia}</span>
          <span style={{ color: 'rgba(240,75,75,0.4)' }}>|</span>
          <span>SLA vencido: {backendState.colapsoPunto.pctSlaVencido}%</span>
          <span style={{ color: 'rgba(240,75,75,0.4)' }}>|</span>
          <span>Aeropuerto crítico: <strong>{backendState.colapsoPunto.aeropuertoMasCritico}</strong></span>
          <button
            onClick={() => handleNavigate('colapso')}
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(240,75,75,0.4)', color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 8px', borderRadius: 3, cursor: 'pointer', letterSpacing: 1 }}
          >
            VER REPORTE →
          </button>
        </div>
      )}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0 }}>
        {/* ── OPERACIONES (main map view) ─────────────────────────────── */}
        {/* ── OPERACIONES (main map view) ─────────────────────────────── */}
        {(screen === 'main' && !configOpen) && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `${filterOpen ? '232px' : '0px'} 1fr ${rightOpen ? '300px' : '0px'}`,
            height: '100%',
            overflow: 'hidden',
            transition: 'grid-template-columns 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
          }}>
            {/* Filter Panel Container */}
            <div style={{ overflow: 'hidden', height: '100%', borderRight: filterOpen ? '1px solid var(--border)' : 'none', background: 'var(--panel)' }}>
              <AirportFilterPanel
                airports={normalizedAirports}
                originIds={originIds}
                setOriginIds={setOriginIds}
                destIds={destIds}
                setDestIds={setDestIds}
                threshold={threshold}
                setThreshold={setThreshold}
              />
            </div>

            {/* Center Map Container */}
            <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
              {/* Filter toggle */}
              <button
                onClick={() => setFilterOpen(!filterOpen)}
                style={{
                  position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                  zIndex: 1000, width: 24, height: 48, background: 'rgba(13, 17, 23, 0.85)',
                  border: '1px solid var(--border)', borderLeft: 'none', borderRadius: '0 8px 8px 0',
                  color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11,
                }}
              >
                {filterOpen ? '‹' : '›'}
              </button>

              <MapView
                airports={visibleAirports}
                flights={backendFlights}
                selectedFlight={selectedFlight}
                setSelectedFlight={setSelectedFlight}
                selectedFlightData={mapSelectedVuelo}
                onAirportClick={setMapSelectedAirport}
                onMapClick={handleCloseVuelo}
                theme={theme}
              />

              {!mapSelectedVuelo && !mapSelectedAirport && (
                <button
                  onClick={() => setRightOpen(!rightOpen)}
                  style={{
                    position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
                    zIndex: 1000, width: 24, height: 48, background: 'rgba(13, 17, 23, 0.85)',
                    border: '1px solid var(--border)', borderRight: 'none', borderRadius: '8px 0 0 8px',
                    color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}
                >
                  {rightOpen ? '›' : '‹'}
                </button>
              )}

              {/* Detail Drawers */}
              <DrawerAeropuerto
                airport={mapSelectedAirport}
                vuelos={backendState?.vuelos || []}
                onClose={handleCloseAirport}
              />
              <DrawerVuelo
                vuelo={mapSelectedVuelo}
                onClose={handleCloseVuelo}
                onCancelFlight={handleCancelFlight}
              />
            </div>

            {/* Right Panel Container */}
            <div style={{ overflow: 'hidden', height: '100%', borderLeft: rightOpen ? '1px solid var(--border)' : 'none', background: 'var(--panel)' }}>
              <RightPanel
                flights={backendFlights}
                airports={visibleAirports}
                threshold={threshold}
                selectedFlight={selectedFlight}
                setSelectedFlight={setSelectedFlight}
                onVueloClick={setMapSelectedVuelo}
              />
            </div>
          </div>
        )}

        {/* ── LIVE VIEW — full height, own layout ── */}
        {screen === 'live' && (
          <div style={{ height: '100%', overflow: 'hidden' }}>
            <LiveScreen
              liveState={liveState}
              theme={theme}
              onBack={() => handleNavigate('main')}
            />
          </div>
        )}

        {/* ── OVERLAY SCREENS (replace the map entirely, no z-index fighting) ── */}
        {(screen !== 'main' || configOpen) && screen !== 'live' && (
          <div style={{ height: '100%', overflow: 'auto', background: 'var(--bg)' }}>
            {screen === 'envios' && (
              <EnviosScreen
                simState={simState}
                theme={theme}
                onBack={handleBackToMain}
              />
            )}
            {screen === 'dashboard' && (
              <DashboardScreen
                simState={simState}
                theme={theme}
                onBack={handleBackToMain}
              />
            )}
            {screen === 'resultados' && (
              <ResultadosScreen
                simState={simState}
                theme={theme}
                onBack={handleBackToMain}
              />
            )}
            {screen === 'config' && (
              <ConfigScreen
                onCancel={handleCancelConfig}
                onSimulationStarted={handleSimulationStarted}
              />
            )}
            {screen === 'colapso' && (
              <ColapsoScreen
                simState={simState}
                theme={theme}
                onBack={handleBackToMain}
              />
            )}
          </div>
        )}
      </div>
    </div>
    {debugOpen && (() => {
      const allVuelos = backendState?.vuelos || []
      const activos = allVuelos.filter((v) => v.estado === 'activo')
      const enUso   = activos.filter((v) => v.enUso)
      const depMin0 = enUso.map((v) => parseTimeToMinutes(v.horaSalida))
      const arrMin0 = enUso.map((v) => parseTimeToMinutes(v.horaLlegada))
      const enAire  = enUso.filter((_, i) => isActiveAtMinute(simClockMinutes, depMin0[i], arrMin0[i]))
      const enviosConPlan = (backendState?.envios || []).filter((e) => e.planResumen && !e.planResumen.includes('no route'))
      const samplePlan   = (backendState?.envios || []).find((e) => e.planResumen)
      const rows = [
        ['backendState',        backendState ? '✓' : 'null'],
        ['vuelos total',        allVuelos.length],
        ['  activos',          activos.length],
        ['  enUso (flag)',      enUso.length],
        ['  maletasAsign > 0', activos.filter((v) => (v.maletasAsignadas ?? 0) > 0).length],
        ['  en aire ahora',    enAire.length],
        ['envios total',        (backendState?.envios || []).length],
        ['  con plan',          enviosConPlan.length],
        ['simClockMinutes',     simClockMinutes],
        ['backendFlights',      backendFlights.length],
        ['autoStep',           String(autoStep)],
        ['samplePlanResumen',   samplePlan?.planResumen ?? 'none'],
      ]
      return (
        <div style={{ position: 'fixed', bottom: 12, left: 12, zIndex: 9999, background: 'rgba(0,0,0,0.88)', border: '1px solid rgba(88,166,255,0.35)', borderRadius: 8, padding: '12px 16px', fontFamily: 'monospace', fontSize: 11, color: '#aac', minWidth: 260, backdropFilter: 'blur(6px)' }}>
          <div style={{ color: '#58a6ff', fontWeight: 700, marginBottom: 8, letterSpacing: 1 }}>DEBUG  <span style={{ color: '#555', fontWeight: 400 }}>Shift+D to close</span></div>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, lineHeight: 1.7 }}>
              <span style={{ color: '#888' }}>{k}</span>
              <span style={{ color: typeof v === 'number' && v > 0 ? '#22d07a' : typeof v === 'number' ? '#f04b4b' : '#e6edf3', fontWeight: 600 }}>{String(v)}</span>
            </div>
          ))}
        </div>
      )
    })()}
    {pollingError && (
      <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 1500, background: 'rgba(240,75,75,0.12)', border: '1px solid rgba(240,75,75,0.4)', borderRadius: 8, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, backdropFilter: 'blur(6px)' }}>
        <span style={{ color: '#f04b4b', fontSize: 14 }}>⚠</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#f04b4b' }}>{pollingError}</span>
        <button onClick={() => setPollingError(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 4 }}>✕</button>
      </div>
    )}
    {isRestarting && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(13,17,23,0.88)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', border: '3px solid rgba(88,166,255,0.15)', borderTopColor: 'var(--blue)', animation: 'spin 0.75s linear infinite' }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)', letterSpacing: 1, marginBottom: 6 }}>Reiniciando simulación…</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>Reutilizando rutas planificadas</div>
        </div>
      </div>
    )}
  </>
  )
}
