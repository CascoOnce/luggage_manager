import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView from './components/MapView.jsx'
import SidePanel from './components/SidePanel.jsx'
import TopBar from './components/TopBar.jsx'
import FloatingKPIs from './components/FloatingKPIs.jsx'
import FloatingClocks from './components/FloatingClocks.jsx'
import { api } from './services/api.js'
import ConfigScreen from './screens/ConfigScreen.jsx'
import EnviosScreen from './screens/EnviosScreen.jsx'
import DashboardScreen from './screens/DashboardScreen.jsx'
import ResultadosScreen from './screens/ResultadosScreen.jsx'
import ColapsoScreen from './screens/ColapsoScreen.jsx'
import LiveScreen from './screens/LiveScreen.jsx'
import OpsScreen from './screens/OpsScreen.jsx'
import DrawerAeropuerto from './drawers/DrawerAeropuerto.jsx'
import DrawerVuelo from './drawers/DrawerVuelo.jsx'
import { getLiveState, getOpsState, getOpsOccupancy, planificarOps, getOpsEnvios, getOpsReporte } from './services/api.js'

export default function App() {
  const ALGORITHM = 'SIMULATED_ANNEALING'
  const SIM_MINUTES_PER_REAL_SECOND = 1  // 1 min/tick @ 250ms = ~6min per simulated day → 30min for 5 days
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
  const [highlightedRoute, setHighlightedRoute] = useState(null)
  const [simClockMinutes, setSimClockMinutes] = useState(0)

  const realStartRef = useRef(null)
  const accumulatedRealMsRef = useRef(0)
  const pollingRef = useRef(null)
  const autoStepRef = useRef(null)
  const pollingErrorsRef = useRef(0)
  const pollInFlightRef = useRef(false)
  const stepInProgressRef = useRef(false)
  const nextDayStateRef = useRef(null)
  const prefetchFiredRef = useRef(false)
  const colapsoPuntoAlertedRef = useRef(false)
  const simStartMinuteRef = useRef(0)

  const [pollingError, setPollingError] = useState(null)

  const [liveState, setLiveState] = useState(null)
  const livePollingRef = useRef(null)
  const liveApplyRef = useRef(null)
  const liveWindowStartRef = useRef(null)
  const liveNextStateRef = useRef(null)

  const [opsState, setOpsState] = useState(null)
  const [opsEnvios, setOpsEnvios] = useState([])
  const [opsReporte, setOpsReporte] = useState(null)
  const opsPollingRef = useRef(null)
  const opsOccRef = useRef(null)

  const [autoStep, setAutoStep] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [activeSideSection, setActiveSideSection] = useState(null)

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

  function isActiveAtMinute(nowMin, depMin, arrMin, day) {
    if (depMin == null || arrMin == null) return false
    const m = nowMin >= 1440 ? 1439 : nowMin
    if (arrMin > depMin) {
      return m >= depMin && m < arrMin
    }
    // For overnight flights (arrMin < depMin), m < arrMin means the flight
    // departed yesterday and is arriving today. On Day 1, there was no yesterday!
    if (day <= 1 && m < arrMin) {
      return m >= depMin
    }
    return m >= depMin || m < arrMin
  }

  function flightFractionAtMinute(nowMin, depMin, arrMin) {
    const total = (arrMin - depMin + 1440) % 1440
    if (total <= 0) return 0
    const elapsed = (nowMin - depMin + 1440) % 1440
    return Math.max(0, Math.min(1, elapsed / total))
  }


  function onReset() {
    setAutoStep(false)
    realStartRef.current = null
    accumulatedRealMsRef.current = 0
    setRealElapsedSeconds(0)
    setSelectedFlight(null)
    setMapSelectedAirport(null)
    setMapSelectedVuelo(null)
    setHighlightedRoute(null)
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
      // Skip if a previous poll is still in flight — prevents request pileup/cancel
      // when the state download is slower than the 2s interval (slow VM uplink).
      if (pollInFlightRef.current) return
      pollInFlightRef.current = true
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
            setTimeout(() => setScreen('resultados'), 8000)
          }
        }
      } catch (err) {
        pollingErrorsRef.current += 1
        if (pollingErrorsRef.current >= 3) {
          setPollingError('No se puede contactar el servidor')
        }
        console.error('Polling error:', err)
      } finally {
        pollInFlightRef.current = false
      }
    }, 2000)
  }, [stopPolling])

  function onIniciar() {
    if (!backendState) {
      setActiveSideSection('config')
      return
    }
    if (autoStep) {
      setAutoStep(false)
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

  // On mount: check if a simulation is already running (another tab/user started it)
  useEffect(() => {
    api.getState().then((state) => {
      if (state && (state.enEjecucion || state.finalizada)) {
        setBackendState(state)
        startPolling()
        if (state.finalizada) setScreen('resultados')
      }
    }).catch(() => {})
  }, [startPolling])

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
      stopOps()
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
    if (!autoStep) {
      clearInterval(autoStepRef.current)
      return
    }

    function startTick() {
      autoStepRef.current = setInterval(() => {
        setSimClockMinutes((current) => Math.min(current + SIM_MINUTES_PER_REAL_SECOND, 1440))
      }, 250)
    }

    startTick()

    // When tab goes to background, browsers throttle setInterval to ~1 Hz (4x slower).
    // Solution: pause the interval on hide, then on return advance the clock by the
    // full expected sim time that should have elapsed while hidden.
    let hiddenAt = null
    function onVisibilityChange() {
      if (document.hidden) {
        clearInterval(autoStepRef.current)
        hiddenAt = Date.now()
      } else if (hiddenAt !== null) {
        const hiddenSec = (Date.now() - hiddenAt) / 1000
        hiddenAt = null
        const missedMin = hiddenSec * SIM_MINUTES_PER_REAL_SECOND * 4
        setSimClockMinutes((current) => Math.min(current + missedMin, 1440))
        startTick()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(autoStepRef.current)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [autoStep])

  // At midnight: reset clock immediately (no freeze) and fire /step in background.
  // Animation resumes for the next day while /step processes. When response arrives,
  // setBackendState swaps in new day data. Brief window (~1-4s) of prior-day flight
  // data is acceptable and masked by fine-grained ticks.
  useEffect(() => {
    if (!autoStep) return
    if (simClockMinutes < 1440) return
    if (stepInProgressRef.current) return  // already fired this midnight

    stepInProgressRef.current = true
    api.stepSimulation().then((newState) => {
      if (!newState) return
      stepInProgressRef.current = false
      setBackendState(newState)
      // Reset clock to midnight simultaneously with new day data
      setSimClockMinutes(0)
      if (newState.finalizada) {
        setAutoStep(false)
        clearInterval(autoStepRef.current)
        stopPolling()
        setTimeout(() => setScreen('resultados'), 8000)
      }
    }).catch((err) => {
      console.error('Auto-step error:', err)
      stepInProgressRef.current = false
    })
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
      const ocupFin = airport.currentOccupation ?? airport.ocupacionActual ?? 0
      const ocupIni = airport.ocupacionInicioDia ?? ocupFin
      return {
        ...airport,
        id: iata,
        name: airport.name || airport.nombre,
        continent: airport.continent || airport.continente,
        lat: airport.lat,
        lng: airport.lng,
        currentOccupation: ocupFin,
        ocupacionInicioDia: ocupIni,
        warehouseCapacity: airport.warehouseCapacity ?? airport.capacidadAlmacen ?? 600,
        vuelosSalientes: vuelosList.filter((v) => (v.origen || v.origin) === iata && v.estado === 'activo').length,
        vuelosLlegando:  vuelosList.filter((v) => (v.destino || v.destination) === iata && v.estado === 'activo').length,
      }
    })
  }, [simState?.aeropuertos, simState?.airports, simState?.vuelos])

  const clockedAirports = useMemo(() => {
    if (!backendState?.enEjecucion) return normalizedAirports
    const fraction = Math.min(simClockMinutes / 1440, 1)
    return normalizedAirports.map((ap) => ({
      ...ap,
      currentOccupation: Math.round(ap.ocupacionInicioDia + (ap.currentOccupation - ap.ocupacionInicioDia) * fraction),
    }))
  }, [normalizedAirports, simClockMinutes, backendState?.enEjecucion])

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
    if (!originSet && !destSet) return clockedAirports
    const visible = new Set()
    for (const ap of clockedAirports) {
      if (!originSet || originSet.has(ap.id)) visible.add(ap.id)
      if (!destSet || destSet.has(ap.id)) visible.add(ap.id)
    }
    return clockedAirports.filter((a) => visible.has(a.id))
  }, [clockedAirports, originSet, destSet])

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
      .filter((v) => v.estado === 'activo')
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
        husOrigen: v.husOrigen ?? null,
        husDestino: v.husDestino ?? null,
        depMin: parseTimeToMinutes(v.horaSalida),
        arrMin: parseTimeToMinutes(v.horaLlegada),
      }))
  }, [backendState?.vuelos])

  // Light work: apply clock position. Reruns every second but only on pre-filtered list.
  // On Day 1, only flights departing at or after horaInicio are visible (no pre-existing
  // flights that were already in the air before the simulation started).
  const backendFlights = useMemo(() => {
    const day = backendState?.diaActual || backendState?.currentDay || 1
    const startMin = day <= 1 ? simStartMinuteRef.current : 0
    return activeVuelosWithTimes
      .filter((v) =>
        v.depMin >= startMin &&
        isActiveAtMinute(simClockMinutes, v.depMin, v.arrMin, day) &&
        (!originSet || originSet.has(v.origin)) &&
        (!destSet || destSet.has(v.destination))
      )
      .map((v) => ({
        ...v,
        fraction: flightFractionAtMinute(simClockMinutes, v.depMin, v.arrMin),
      }))
  }, [activeVuelosWithTimes, simClockMinutes, originSet, destSet, backendState?.diaActual])

  const fechaSimuladaDisplay = useMemo(() => {
    if (!backendState?.fechaSimulada) return null
    const source = new Date(backendState.fechaSimulada)
    if (Number.isNaN(source.getTime())) return backendState.fechaSimulada

    source.setHours(0, 0, 0, 0)
    const dayOffset = Math.max(0, ((backendState.diaActual || backendState.currentDay || 1) - 1)) * 24 * 60 * 60 * 1000
    const current = new Date(source.getTime() + dayOffset + simClockMinutes * 60000)
    const mm = String(current.getMonth() + 1).padStart(2, '0')
    const dd = String(current.getDate()).padStart(2, '0')
    const rawH = current.getHours()
    const hh = String(rawH % 12 || 12).padStart(2, '0')
    const mi = String(current.getMinutes()).padStart(2, '0')
    const ss = String(realElapsedSeconds % 60).padStart(2, '0')
    const ampm = rawH >= 12 ? 'p.m.' : 'a.m.'
    return `${mm}-${dd} ${hh}:${mi}:${ss} ${ampm}`
  }, [backendState?.fechaSimulada, backendState?.diaActual, backendState?.currentDay, simClockMinutes, realElapsedSeconds])

  useEffect(() => {
    if (!selectedFlight) {
      setMapSelectedVuelo(null)
      return
    }
    const vuelo = backendFlights.find((f) => f.id === selectedFlight)
    if (vuelo) setMapSelectedVuelo(vuelo)
    // If vuelo not found in current frame, keep the previous drawer content open.
  }, [selectedFlight, backendState, backendFlights])

  const activeKpis = useMemo(() => {
    const base = backendState?.kpis
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
        }
    const globalFleetOccupancy = backendFlights.length > 0
      ? backendFlights.reduce((acc, f) => acc + (f.capacity > 0 ? (f.currentLoad / f.capacity) * 100 : 0), 0) / backendFlights.length
      : 0
    const withCap = clockedAirports.filter((a) => (a.warehouseCapacity ?? 0) > 0)
    const globalWarehouseOccupancy = withCap.length > 0
      ? withCap.reduce((acc, a) => acc + (a.currentOccupation / a.warehouseCapacity) * 100, 0) / withCap.length
      : 0
    return { ...base, globalFleetOccupancy, globalWarehouseOccupancy }
  }, [backendState?.kpis, simState?.kpis, backendFlights, clockedAirports])

  const isOpsActive = Boolean(opsState)

  const opsNowMinutes = useMemo(() => {
    const now = new Date()
    return now.getHours() * 60 + now.getMinutes()
  }, [opsState?.vuelos])

  const opsActiveFlights = useMemo(() => {
    if (!opsState?.vuelos) return []
    return opsState.vuelos
      .map((v) => ({
        id: v.codigoVuelo,
        origin: v.origen,
        destination: v.destino,
        currentLoad: v.cargaActual,
        capacity: v.capacidadTotal,
        type: v.tipo === 'continental' ? 'continental' : 'intercontinental',
        status: v.enUso ? 'active' : 'inactive',
        horaSalida: v.horaSalida,
        horaLlegada: v.horaLlegada,
        depMin: parseTimeToMinutes(v.horaSalida),
        arrMin: parseTimeToMinutes(v.horaLlegada),
      }))
  }, [opsState?.vuelos])

  const opsAsSimState = useMemo(() => {
    if (!opsState) return null
    const envios = opsEnvios.map((e) => ({
      idEnvio: e.idPedido,
      aeropuertoOrigen: e.iataOrigen,
      aeropuertoDestino: e.iataDestino,
      estado: e.estado,
      cantidadMaletas: e.cantidadMaletas,
      sla: e.sla,
      escalas: [],
      planResumen: e.estado !== 'PENDIENTE' ? `${e.iataOrigen} → ${e.iataDestino}` : null,
    }))
    const vuelos = (opsState.vuelos || []).map((v) => ({
      codigoVuelo: v.codigoVuelo,
      origen: v.origen,
      destino: v.destino,
      horaSalida: v.horaSalida,
      horaLlegada: v.horaLlegada,
      tipo: v.tipo,
      estado: v.enUso ? 'EN_VUELO' : 'PROGRAMADO',
      capacidadTotal: v.capacidadTotal,
      cargaActual: v.cargaActual,
      enUso: v.enUso,
    }))
    const kpisNorm = opsReporte ? {
      maletasEnTransito: opsReporte.enviosPendientes,
      maletasEntregadas: opsReporte.enviosEntregados,
      cumplimientoSLA: opsReporte.porcentajeCumplimientoSla,
      vuelosActivos: (opsState.vuelos || []).filter((v) => v.enUso).length,
      slaVencidos: opsReporte.enviosViolados,
      bagsInTransit: opsReporte.enviosPendientes,
      bagsDelivered: opsReporte.enviosEntregados,
      slaCompliance: opsReporte.porcentajeCumplimientoSla,
      activeFlights: (opsState.vuelos || []).filter((v) => v.enUso).length,
      slaViolated: opsReporte.enviosViolados,
    } : null
    const aeropuertos = (opsState.aeropuertos || []).map((a) => ({
      ...a,
      ocupacionActual: a.maletasPendientes,
    }))
    return {
      aeropuertos,
      vuelos,
      envios,
      kpis: kpisNorm,
      finalizada: true,
      totalDias: null,
      logOperaciones: [],
      cancelaciones: [],
    }
  }, [opsState, opsEnvios, opsReporte])

  async function handleReset() {
    stepInProgressRef.current = false
    colapsoPuntoAlertedRef.current = false
    stopPolling()
    pollingErrorsRef.current = 0
    setPollingError(null)
    onReset()
    setBackendState(null)
    api.resetSimulation().catch((err) => console.error('Reset backend error:', err))
  }

  async function handleRestart() {
    if (!backendState) return
    stepInProgressRef.current = false
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

  // Ops backend frames "now" and flight times in UTC; send a true UTC instant.
  function toUtcISO(date) {
    const pad = (n) => String(n).padStart(2, '0')
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
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

  function stopOps() {
    clearInterval(opsPollingRef.current)
    clearInterval(opsOccRef.current)
    opsPollingRef.current = null
    opsOccRef.current = null
    setOpsState(null)
    setOpsEnvios([])
    setOpsReporte(null)
  }

  function refreshOpsViewData() {
    getOpsEnvios().then((data) => setOpsEnvios(data || [])).catch((err) => console.error('Ops envios error:', err))
    getOpsReporte().then(setOpsReporte).catch((err) => console.error('Ops reporte error:', err))
  }

  // Ops is a REAL-time view. Full state (incl. flights) is heavier, so poll it
  // slower; warehouse occupancy is cheap, so poll it fast for a live airport
  // view that tracks the clock and newly ingested bags.
  const OPS_POLL_MS = 10 * 1000
  const OPS_OCC_POLL_MS = 2 * 1000

  function startOps() {
    stopOps()
    refreshOps()
    refreshOpsViewData()
    refreshOccupancy()
    opsPollingRef.current = setInterval(refreshOps, OPS_POLL_MS)
    opsOccRef.current = setInterval(refreshOccupancy, OPS_OCC_POLL_MS)
  }

  function refreshOps() {
    const now = new Date()
    getOpsState(toUtcISO(now)).then(setOpsState).catch((err) => console.error('Ops refresh error:', err))
  }

  // Fast path: refresh only airport occupancy, merging into the existing state.
  function refreshOccupancy() {
    const now = new Date()
    getOpsOccupancy(toUtcISO(now))
      .then((aeropuertos) => setOpsState((prev) => (prev ? { ...prev, aeropuertos } : { aeropuertos, vuelos: [] })))
      .catch((err) => console.error('Ops occupancy error:', err))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleNavigate = useCallback((next) => {
    setConfigOpen(false)
    if (next === 'live') {
      setScreen('live')
      startLive()
    } else if (next === 'ops' || (next === 'main' && isOpsActive)) {
      if (screen === 'live') stopLive()
      setScreen('ops')
      if (!isOpsActive) startOps()
    } else if (isOpsActive && (next === 'envios' || next === 'dashboard' || next === 'resultados')) {
      refreshOpsViewData()
      setScreen(next)
    } else if (!isOpsActive && next === 'envios') {
      if (screen === 'live') stopLive()
      setScreen('main')
      setActiveSideSection('envios')
    } else if (next === 'config') {
      if (backendState) {
        if (screen === 'live') stopLive()
        void handleReset()
        setActiveSideSection('config')
        return
      }
      if (screen === 'live') stopLive()
      setScreen('main')
      setActiveSideSection('config')
    } else {
      if (screen === 'live') stopLive()
      if (screen === 'ops') stopOps()
      setScreen(next)
    }
  }, [screen, isOpsActive])

  const handleCloseAirport = useCallback(() => setMapSelectedAirport(null), [])
  const handleCloseVuelo   = useCallback(() => { setMapSelectedVuelo(null); setSelectedFlight(null) }, [])

  const handleShowEnvioRoute = useCallback(async (envioId) => {
    try {
      const envio = await api.getEnvioById(envioId)
      const escalas = envio?.planDetalle?.escalas || []
      if (escalas.length < 2) return
      const apMap = Object.fromEntries(clockedAirports.map((a) => [a.id, a]))
      const legs = []
      for (let i = 0; i < escalas.length - 1; i++) {
        const o = apMap[escalas[i].codigoAeropuerto]
        const d = apMap[escalas[i + 1].codigoAeropuerto]
        if (o && d) legs.push({ originIata: escalas[i].codigoAeropuerto, destIata: escalas[i + 1].codigoAeropuerto, originLat: o.lat, originLng: o.lng, destLat: d.lat, destLng: d.lng })
      }
      if (legs.length > 0) {
        setHighlightedRoute({ envioId, legs })
        setScreen('main')
      }
    } catch (e) {
      console.error('handleShowEnvioRoute', e)
    }
  }, [clockedAirports])
  const handleCancelFlight = useCallback(async (codigoVuelo) => {
    try {
      await api.cancelFlight(codigoVuelo)
      setMapSelectedVuelo(null)
      setSelectedFlight(null)
      const newState = await api.getState()
      if (newState && (newState.enEjecucion || newState.finalizada)) {
        setBackendState(newState)
      }
    } catch (err) {
      alert('Error al cancelar vuelo: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [])
  const handleBackToMain   = useCallback(() => setScreen(isOpsActive ? 'ops' : 'main'), [isOpsActive])

  const handleCancelConfig = useCallback(() => {
    setScreen('main')
    setConfigOpen(false)
  }, [])

  const handleOpenOps = useCallback(() => {
    setActiveSideSection(null)
    handleNavigate('ops')
  }, [handleNavigate])

  const handleSimulationStarted = useCallback((state, params) => {
    setConfigOpen(false)
    setBackendState(state)
    setLastParams(params)
    const [h = 0, m = 0] = (params?.horaInicio || '00:00').split(':').map(Number)
    const startMin = h * 60 + m
    simStartMinuteRef.current = startMin
    setSimClockMinutes(startMin)
    // Reset real-elapsed counter for each new simulation
    realStartRef.current = null
    accumulatedRealMsRef.current = 0
    setRealElapsedSeconds(0)
    setScreen('main')
    setActiveSideSection('vuelos')
    startPolling()
  }, [startPolling])

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <TopBar
        simRateLabel={null}
        kpis={activeKpis}
        backendState={backendState}
        onCancel={handleReset}
        onRestart={handleRestart}
        canRestart={Boolean(backendState)}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onNavigate={handleNavigate}
        onIniciar={onIniciar}
        screen={screen}
        hasSimulation={Boolean(backendState)}
        isOpsActive={isOpsActive}
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
          <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: activeSideSection ? 372 : 52,
              zIndex: 0,
              transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}>
              <MapView
                airports={visibleAirports}
                flights={backendFlights}
                selectedFlight={selectedFlight}
                setSelectedFlight={setSelectedFlight}
                selectedFlightData={mapSelectedVuelo}
                onAirportClick={setMapSelectedAirport}
                onMapClick={() => { handleCloseVuelo(); setHighlightedRoute(null) }}
                theme={theme}
                highlightedRoute={highlightedRoute}
              />
            </div>

            {/* Side panel — overlay on top of map */}
            <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, zIndex: 700, display: 'flex' }}>
              <SidePanel
                activeSection={activeSideSection}
                onSectionChange={setActiveSideSection}
                flights={backendFlights}
                selectedFlight={selectedFlight}
                setSelectedFlight={setSelectedFlight}
                setMapSelectedVuelo={setMapSelectedVuelo}
                setMapSelectedAirport={setMapSelectedAirport}
                simState={simState}
                airports={normalizedAirports}
                threshold={threshold}
                setThreshold={setThreshold}
                onSimulationStarted={handleSimulationStarted}
                originIds={originIds}
                setOriginIds={setOriginIds}
                destIds={destIds}
                setDestIds={setDestIds}
                theme={theme}
                onOpenOps={handleOpenOps}
              />
            </div>

            {/* KPIs / clocks — shift right when panel open */}
            <div style={{
              position: 'absolute', top: 20,
              left: activeSideSection ? 392 : 72,
              zIndex: 600,
              display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none',
              transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}>
              <FloatingKPIs kpis={activeKpis} hasSimulation={Boolean(backendState)} />
              <FloatingClocks backendState={backendState} simClockMinutes={simClockMinutes} realElapsedSeconds={realElapsedSeconds} />
            </div>

            <DrawerAeropuerto
              airport={mapSelectedAirport}
              vuelos={backendState?.vuelos || []}
              onClose={handleCloseAirport}
              fetchInventory={isOpsActive ? api.getOpsAirportInventory : api.getAirportInventory}
            />
            <DrawerVuelo
              vuelo={mapSelectedVuelo}
              onClose={handleCloseVuelo}
              onCancelFlight={null}
            />
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

        {/* ── OPS VIEW — full height, own layout ── */}
        {screen === 'ops' && (
          <div style={{ height: '100%', overflow: 'hidden' }}>
            <OpsScreen
              opsState={opsState}
              opsEnvios={opsEnvios}
              theme={theme}
              onBack={() => { stopOps(); handleNavigate('config') }}
              onRefreshOps={() => { refreshOps(); refreshOpsViewData() }}
            />
          </div>
        )}

        {/* ── OVERLAY SCREENS ── */}
        {screen !== 'main' && screen !== 'live' && screen !== 'ops' && (
          <div style={{ height: '100%', overflow: 'auto', background: 'var(--bg)' }}>
            {screen === 'envios' && isOpsActive && (
              <EnviosScreen
                simState={opsAsSimState}
                theme={theme}
                onBack={handleBackToMain}
                onShowInMap={null}
                onCancelFlight={null}
                simClockMinutes={opsNowMinutes}
                flights={opsActiveFlights}
                opsMode={true}
                fetchEnvio={api.getOpsEnvioById}
              />
            )}
            {screen === 'dashboard' && (
              <DashboardScreen
                simState={isOpsActive ? opsAsSimState : simState}
                theme={theme}
                onBack={handleBackToMain}
                globalKpis={isOpsActive ? null : activeKpis}
                opsMode={isOpsActive}
              />
            )}
            {screen === 'resultados' && (
              <ResultadosScreen
                simState={isOpsActive ? opsAsSimState : simState}
                theme={theme}
                onBack={handleBackToMain}
                opsMode={isOpsActive}
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
