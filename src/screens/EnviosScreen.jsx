import React, { useMemo, useState } from 'react'
import DrawerEnvio from '../drawers/DrawerEnvio.jsx'

const STATUS_ORDER = ['EN_TRANSITO', 'ENTREGADO', 'RETRASADO', 'PLANIFICADO', 'PENDIENTE', 'CANCELADO']
const STATUS_COLOR = {
  EN_TRANSITO: 'var(--blue)',
  ENTREGADO: 'var(--green)',
  RETRASADO: 'var(--red)',
  PLANIFICADO: 'var(--amber)',
  PENDIENTE: 'var(--muted)',
  CANCELADO: 'var(--red)',
}

const ROUTE_TYPES = ['continental', 'intercontinental']

const getEnvios = (s) =>
  s?.envios || s?.routes?.map((r) => ({
    idEnvio: r.id,
    codigoAerolinea: r.baggageId,
    aeropuertoOrigen: r.flightLegs?.[0]?.origin,
    aeropuertoDestino: r.flightLegs?.slice(-1)[0]?.destination,
    cantidadMaletas: r.bags,
    estado: r.status === 'green' ? 'ENTREGADO'
      : r.status === 'red' ? 'RETRASADO'
        : 'EN_TRANSITO',
    sla: r.type === 'same' ? 1 : 2,
    planResumen: r.flightLegs?.map((l) =>
      `${l.origin}->${l.destination}`).join(' | '),
    tiempoRestante: r.etaRemaining
      ? `${Math.round(r.etaRemaining)}h` : '—',
  })) || []

const getAeropuertos = (s) =>
  s?.aeropuertos || s?.airports || []

const getKpis = (s) => s?.kpis || {
  maletasEnTransito: s?.kpis?.bagsInTransit || 0,
  maletasEntregadas: s?.kpis?.bagsDelivered || 0,
  cumplimientoSLA: s?.kpis?.slaCompliance || 0,
  vuelosActivos: s?.kpis?.activeFlights || 0,
  slaVencidos: s?.kpis?.slaViolated || 0,
  ocupacionPromedioAlmacen: 0,
}

const getThroughput = (s) =>
  s?.throughputHistorial || s?.throughputHistory || []

const getLog = (s) =>
  s?.logOperaciones || []

function truncate(value, max = 30) {
  if (!value) return '--'
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function headingStyle() {
  return {
    fontFamily: 'var(--mono)',
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: 'var(--muted)',
    marginBottom: 8,
  }
}

function deriveEstado(envio, effectiveNow) {
  const backend = envio.estado ?? 'PENDIENTE'
  if (backend === 'CANCELADO' || backend === 'PENDIENTE') return backend
  const escalas = envio.escalasResumen
  if (!escalas || escalas.length === 0 || !effectiveNow) return backend

  const deadline = new Date(envio.fechaHoraIngreso).getTime() + envio.sla * 86400000
  if (effectiveNow.getTime() > deadline) return 'RETRASADO'

  const last = escalas[escalas.length - 1]
  if (last.horaLlegadaEst && effectiveNow >= new Date(last.horaLlegadaEst)) return 'ENTREGADO'

  const anyDeparted = escalas.some((e) => e.horaSalidaEst && effectiveNow >= new Date(e.horaSalidaEst))
  if (anyDeparted) return 'EN_TRANSITO'

  return 'PLANIFICADO'
}

function flightStatus(flight, simMin) {
  const { depMin, arrMin } = flight
  if (depMin == null) return 'POR_DESPEGAR'
  if (simMin < depMin) return 'POR_DESPEGAR'
  const overnight = arrMin != null && arrMin < depMin
  if (arrMin == null) return 'EN_VUELO'
  if (overnight) return simMin >= depMin || simMin < arrMin ? 'EN_VUELO' : 'COMPLETADO'
  return simMin < arrMin ? 'EN_VUELO' : 'COMPLETADO'
}

export default function EnviosScreen({ simState, onShowInMap, onCancelFlight, simClockMinutes = 0, flights = [], opsMode = false, fetchEnvio }) {
  const [activeTab, setActiveTab] = useState('envios')
  // envíos filters
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState(new Set(STATUS_ORDER))
  const [routeFilter, setRouteFilter] = useState(new Set(ROUTE_TYPES))
  const [filterOrigen, setFilterOrigen] = useState('')
  const [filterDestino, setFilterDestino] = useState('')
  const [selectedEnvioId, setSelectedEnvioId] = useState(null)
  // vuelos filters
  const [vueloQuery, setVueloQuery] = useState('')
  const [vueloEstado, setVueloEstado] = useState('all')
  const [vueloOrigen, setVueloOrigen] = useState('')
  const [vueloDest, setVueloDest] = useState('')

  const effectiveNow = useMemo(() => {
    const fechaSimulada = simState?.fechaSimulada
    if (!fechaSimulada) return null
    const base = new Date(fechaSimulada)
    if (Number.isNaN(base.getTime())) return null
    return new Date(base.getTime() + simClockMinutes * 60000)
  }, [simState?.fechaSimulada, simClockMinutes])

  const envios = useMemo(() => {
    return getEnvios(simState).map((envio, idx) => ({
      idEnvio: envio.idEnvio ?? `ENV-${idx + 1}`,
      codigoAerolinea: envio.codigoAerolinea ?? '--',
      aeropuertoOrigen: envio.aeropuertoOrigen ?? '--',
      aeropuertoDestino: envio.aeropuertoDestino ?? '--',
      cantidadMaletas: Number(envio.cantidadMaletas ?? 0),
      estado: deriveEstado(envio, effectiveNow),
      sla: Number(envio.sla ?? 1),
      planResumen: envio.planResumen ?? '--',
      tipoRuta: Number(envio.sla ?? 1) > 1 ? 'intercontinental' : 'continental',
    }))
  }, [simState, effectiveNow])

  const kpis = useMemo(() => getKpis(simState), [simState])
  const aeropuertos = useMemo(() => getAeropuertos(simState), [simState])

  const uniqueOrigenes = useMemo(() =>
    [...new Set(envios.map((e) => e.aeropuertoOrigen).filter(Boolean))].sort()
  , [envios])
  const uniqueDestinos = useMemo(() =>
    [...new Set(envios.map((e) => e.aeropuertoDestino).filter(Boolean))].sort()
  , [envios])
  const throughput = useMemo(() => getThroughput(simState), [simState])
  const logEntries = useMemo(() => getLog(simState), [simState])

  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]))
    for (const envio of envios) {
      counts[envio.estado] = (counts[envio.estado] || 0) + 1
    }
    return counts
  }, [envios])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return envios.filter((envio) => {
      const haystack = `${envio.idEnvio} ${envio.aeropuertoOrigen} ${envio.aeropuertoDestino} ${envio.planResumen}`.toLowerCase()
      const matchesSearch = !q || haystack.includes(q)
      const matchesStatus = statusFilter.has(envio.estado)
      const matchesRoute = routeFilter.has(envio.tipoRuta)
      const matchesOrigen = !filterOrigen || envio.aeropuertoOrigen === filterOrigen
      const matchesDestino = !filterDestino || envio.aeropuertoDestino === filterDestino
      return matchesSearch && matchesStatus && matchesRoute && matchesOrigen && matchesDestino
    })
  }, [envios, query, statusFilter, routeFilter, filterOrigen, filterDestino])

  const summary = useMemo(() => {
    const totalEnvios = visible.length
    const totalMaletas = visible.reduce((acc, envio) => acc + Number(envio.cantidadMaletas || 0), 0)
    const vencidos = visible.filter((envio) => envio.estado === 'RETRASADO').length
    const slaOk = totalEnvios === 0 ? 0 : Math.round(((totalEnvios - vencidos) / totalEnvios) * 100)
    const fallbackSla = Number(kpis.cumplimientoSLA || 0)
    const finalSla = totalEnvios === 0 ? fallbackSla : slaOk
    return { totalEnvios, totalMaletas, slaOk: finalSla, vencidos }
  }, [visible, kpis])

  const vuelosConEstado = useMemo(() =>
    flights.map((f) => ({ ...f, statusVuelo: flightStatus(f, simClockMinutes) }))
  , [flights, simClockMinutes])

  const vueloOrigenes = useMemo(() =>
    [...new Set(vuelosConEstado.map((f) => f.origin).filter(Boolean))].sort()
  , [vuelosConEstado])
  const vueloDestinos = useMemo(() =>
    [...new Set(vuelosConEstado.map((f) => f.destination).filter(Boolean))].sort()
  , [vuelosConEstado])

  const visibleVuelos = useMemo(() => {
    const q = vueloQuery.trim().toLowerCase()
    return vuelosConEstado.filter((f) => {
      if (vueloEstado !== 'all' && f.statusVuelo !== vueloEstado) return false
      if (vueloOrigen && f.origin !== vueloOrigen) return false
      if (vueloDest && f.destination !== vueloDest) return false
      if (!q) return true
      return (
        (f.id || '').toLowerCase().includes(q) ||
        (f.origin || '').toLowerCase().includes(q) ||
        (f.destination || '').toLowerCase().includes(q)
      )
    })
  }, [vuelosConEstado, vueloQuery, vueloEstado, vueloOrigen, vueloDest])

  function toggleStatus(status) {
    setStatusFilter((current) => {
      const next = new Set(current)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  function toggleRoute(type) {
    setRouteFilter((current) => {
      const next = new Set(current)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const inputStyle = {
    width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
    color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13,
    padding: '7px 10px', borderRadius: 2, outline: 'none',
  }
  const selectStyle = (hasVal) => ({
    flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
    color: hasVal ? 'var(--text)' : 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12,
    padding: '6px 6px', borderRadius: 2, outline: 'none', cursor: 'pointer',
  })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--panel)', flexShrink: 0 }}>
        {[['envios', 'ENVÍOS'], ['vuelos', 'VUELOS']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              padding: '10px 20px', border: 'none', background: 'transparent',
              cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11,
              letterSpacing: 1.5, textTransform: 'uppercase',
              color: activeTab === key ? 'var(--text-bright)' : 'var(--muted)',
              borderBottom: activeTab === key ? '2px solid var(--blue)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >{label}</button>
        ))}
      </div>

      {/* Envíos tab */}
      {activeTab === 'envios' && (
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '280px 1fr', minHeight: 0 }}>
      <aside style={{ background: 'var(--panel)', borderRight: '1px solid var(--border)', padding: '16px 14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar ID, origen, destino..."
          style={{
            width: '100%',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontFamily: 'var(--mono)',
            fontSize: 13,
            padding: '7px 10px',
            borderRadius: 2,
            outline: 'none',
          }}
        />

        <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
          {[
            { label: 'Origen', value: filterOrigen, set: setFilterOrigen, opts: uniqueOrigenes },
            { label: 'Destino', value: filterDestino, set: setFilterDestino, opts: uniqueDestinos },
          ].map(({ label, value, set, opts }) => (
            <select
              key={label}
              value={value}
              onChange={(e) => set(e.target.value)}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
                color: value ? 'var(--text)' : 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12,
                padding: '6px 6px', borderRadius: 2, outline: 'none', cursor: 'pointer',
              }}
            >
              <option value="">{label}</option>
              {opts.map((iata) => <option key={iata} value={iata}>{iata}</option>)}
            </select>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={headingStyle()}>Estado</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {STATUS_ORDER.map((status) => {
              const active = statusFilter.has(status)
              return (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  style={{
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text)',
                    borderRadius: 2,
                    padding: '7px 8px',
                    cursor: 'pointer',
                    display: 'grid',
                    gridTemplateColumns: '3px 1fr auto',
                    gap: 8,
                    alignItems: 'center',
                    opacity: active ? 1 : 0.35,
                  }}
                >
                  <span style={{ width: 3, height: 14, background: STATUS_COLOR[status], display: 'block' }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'left' }}>{status}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{statusCounts[status] || 0}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={headingStyle()}>Tipo de ruta</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ROUTE_TYPES.map((type) => {
              const active = routeFilter.has(type)
              const label = type === 'continental' ? 'Continental' : 'Intercontinental'
              return (
                <button
                  key={type}
                  onClick={() => toggleRoute(type)}
                  style={{
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text)',
                    borderRadius: 2,
                    padding: '7px 8px',
                    cursor: 'pointer',
                    display: 'grid',
                    gridTemplateColumns: '3px 1fr auto',
                    gap: 8,
                    alignItems: 'center',
                    opacity: active ? 1 : 0.35,
                  }}
                >
                  <span style={{ width: 3, height: 14, background: 'var(--blue)', display: 'block' }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'left' }}>{label}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                    {envios.filter((envio) => envio.tipoRuta === type).length}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={headingStyle()}>Resumen</div>
          {[
            ['Total envios', summary.totalEnvios],
            ['Total maletas', summary.totalMaletas],
            ['SLA cumplido %', `${summary.slaOk}%`],
            ['Vencidos', summary.vencidos],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)' }}>{value}</span>
            </div>
          ))}
        </div>
      </aside>

      <section style={{ overflowY: 'auto', minHeight: 0 }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--panel)', borderBottom: '1px solid var(--border)', padding: '8px 14px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1.2fr 0.9fr 0.8fr 0.8fr 0.7fr 0.9fr 0.6fr 1.7fr',
            gap: 10,
            fontFamily: 'var(--mono)',
            fontSize: 10,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            color: 'var(--muted)',
          }}>
            <span>ID</span><span>Aerolínea</span><span>Origen</span><span>Destino</span><span style={{ textAlign: 'right' }}>Maletas</span><span>Estado</span><span>SLA</span><span>Ruta</span>
          </div>
        </div>

        {visible.length === 0 ? (
          <div style={{ minHeight: 'calc(100% - 44px)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
            SIN DATOS — Inicie una simulación
          </div>
        ) : visible.map((envio) => (
          <div
            key={envio.idEnvio}
            onClick={() => setSelectedEnvioId(envio.idEnvio)}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.2fr 0.9fr 0.8fr 0.8fr 0.7fr 0.9fr 0.6fr 1.7fr',
              gap: 10,
              padding: '9px 14px',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              fontFamily: 'var(--mono)',
              fontSize: 13,
              color: 'var(--text)',
              cursor: 'pointer',
            }}
            onMouseEnter={(event) => { event.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
            onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ color: 'var(--blue)' }}>{envio.idEnvio}</span>
            <span>{envio.codigoAerolinea}</span>
            <span style={{ color: 'var(--text-bright)' }}>{envio.aeropuertoOrigen}</span>
            <span style={{ color: 'var(--text-bright)' }}>{envio.aeropuertoDestino}</span>
            <span style={{ color: 'var(--muted)', textAlign: 'right' }}>{envio.cantidadMaletas}</span>
            <span style={{ color: STATUS_COLOR[envio.estado] || 'var(--muted)' }}>{envio.estado}</span>
            <span style={{ color: 'var(--muted)' }}>{envio.sla}d</span>
            <span style={{ color: 'var(--muted)' }}>{truncate(envio.planResumen, 30)}</span>
          </div>
        ))}
      </section>

      <DrawerEnvio
        envioId={selectedEnvioId}
        onClose={() => setSelectedEnvioId(null)}
        onShowInMap={onShowInMap}
        fetchEnvio={fetchEnvio}
      />
    </div>
      )}

      {/* Vuelos tab */}
      {activeTab === 'vuelos' && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: 0 }}>
          {/* Sidebar vuelos */}
          <aside style={{ background: 'var(--panel)', borderRight: '1px solid var(--border)', padding: '16px 14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              value={vueloQuery}
              onChange={(e) => setVueloQuery(e.target.value)}
              placeholder="Buscar vuelo, origen, destino..."
              style={inputStyle}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={vueloOrigen} onChange={(e) => setVueloOrigen(e.target.value)} style={selectStyle(!!vueloOrigen)}>
                <option value="">Origen</option>
                {vueloOrigenes.map((ap) => <option key={ap} value={ap}>{ap}</option>)}
              </select>
              <select value={vueloDest} onChange={(e) => setVueloDest(e.target.value)} style={selectStyle(!!vueloDest)}>
                <option value="">Destino</option>
                {vueloDestinos.map((ap) => <option key={ap} value={ap}>{ap}</option>)}
              </select>
            </div>
            <div>
              <div style={headingStyle()}>Estado de vuelo</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  ['all', 'Todos', 'var(--muted)'],
                  ['EN_VUELO', 'En vuelo', 'var(--blue)'],
                  ['POR_DESPEGAR', 'Por despegar', 'var(--amber)'],
                  ['COMPLETADO', 'Completado', 'var(--green)'],
                ].map(([val, label, color]) => (
                  <button
                    key={val}
                    onClick={() => setVueloEstado(val)}
                    style={{
                      border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)',
                      borderRadius: 2, padding: '7px 8px', cursor: 'pointer',
                      display: 'grid', gridTemplateColumns: '3px 1fr auto', gap: 8, alignItems: 'center',
                      opacity: vueloEstado === val ? 1 : 0.4,
                    }}
                  >
                    <span style={{ width: 3, height: 14, background: color, display: 'block' }} />
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'left' }}>{label}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                      {val === 'all' ? vuelosConEstado.length : vuelosConEstado.filter((f) => f.statusVuelo === val).length}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <div style={headingStyle()}>Resumen</div>
              {[
                ['Total vuelos', vuelosConEstado.length],
                ['En vuelo', vuelosConEstado.filter((f) => f.statusVuelo === 'EN_VUELO').length],
                ['Por despegar', vuelosConEstado.filter((f) => f.statusVuelo === 'POR_DESPEGAR').length],
                ['Completados', vuelosConEstado.filter((f) => f.statusVuelo === 'COMPLETADO').length],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)' }}>{value}</span>
                </div>
              ))}
            </div>
          </aside>

          {/* Tabla vuelos */}
          <section style={{ overflowY: 'auto', minHeight: 0 }}>
            <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--panel)', borderBottom: '1px solid var(--border)', padding: '8px 14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.8fr 0.7fr 0.7fr 0.7fr 0.8fr 80px', gap: 10, fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)' }}>
                <span>Vuelo</span><span>Origen</span><span>Destino</span><span>Salida</span><span>Llegada</span><span style={{ textAlign: 'right' }}>Carga</span><span>Estado</span><span />
              </div>
            </div>
            {visibleVuelos.length === 0 ? (
              <div style={{ minHeight: 'calc(100% - 44px)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                SIN VUELOS
              </div>
            ) : visibleVuelos.map((f) => {
              const stColor = f.statusVuelo === 'EN_VUELO' ? 'var(--blue)' : f.statusVuelo === 'COMPLETADO' ? 'var(--green)' : 'var(--amber)'
              const ocupPct = f.capacity > 0 ? Math.round((f.currentLoad / f.capacity) * 100) : 0
              return (
                <div
                  key={f.id}
                  style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.8fr 0.7fr 0.7fr 0.7fr 0.8fr 80px', gap: 10, padding: '9px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)', alignItems: 'center' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ color: 'var(--blue)' }}>{f.id}</span>
                  <span style={{ color: 'var(--text-bright)' }}>{f.origin}</span>
                  <span style={{ color: 'var(--text-bright)' }}>{f.destination}</span>
                  <span style={{ color: 'var(--muted)' }}>{f.horaSalida || '--'}</span>
                  <span style={{ color: 'var(--muted)' }}>{f.horaLlegada || '--'}</span>
                  <span style={{ color: 'var(--muted)', textAlign: 'right' }}>{ocupPct}%</span>
                  <span style={{ color: stColor }}>{f.statusVuelo === 'EN_VUELO' ? 'EN VUELO' : f.statusVuelo === 'COMPLETADO' ? 'COMPLETADO' : 'POR DESPEGAR'}</span>
                  <span>
                    {f.statusVuelo === 'POR_DESPEGAR' && onCancelFlight && (
                      <button
                        onClick={() => onCancelFlight(f.id)}
                        style={{ background: 'rgba(240,75,75,0.08)', border: '1px solid rgba(240,75,75,0.25)', color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 9, padding: '3px 8px', cursor: 'pointer', letterSpacing: 0.8, textTransform: 'uppercase', borderRadius: 2 }}
                      >
                        Cancelar
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </section>
        </div>
      )}
    </div>
  )
}
