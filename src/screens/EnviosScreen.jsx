import React, { useMemo, useState } from 'react'
import DrawerEnvio from '../drawers/DrawerEnvio.jsx'
import DrawerVuelo from '../drawers/DrawerVuelo.jsx'

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

const VUELO_STATUS_ORDER = ['activo', 'planificado', 'cancelled', 'cancelado']
const VUELO_STATUS_COLOR = {
  activo: 'var(--blue)',
  planificado: 'var(--amber)',
  cancelled: 'var(--red)',
  cancelado: 'var(--red)',
}

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

const getVuelos = (s) =>
  s?.vuelos || []

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

export default function EnviosScreen({ simState, onCancelFlight }) {
  const [subtab, setSubtab] = useState('envios')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState(new Set(STATUS_ORDER))
  const [routeFilter, setRouteFilter] = useState(new Set(ROUTE_TYPES))
  const [vueloStatusFilter, setVueloStatusFilter] = useState(new Set(VUELO_STATUS_ORDER))
  const [selectedEnvioId, setSelectedEnvioId] = useState(null)
  const [selectedVuelo, setSelectedVuelo] = useState(null)

  const envios = useMemo(() => {
    return getEnvios(simState).map((envio, idx) => ({
      idEnvio: envio.idEnvio ?? `ENV-${idx + 1}`,
      codigoAerolinea: envio.codigoAerolinea ?? '--',
      aeropuertoOrigen: envio.aeropuertoOrigen ?? '--',
      aeropuertoDestino: envio.aeropuertoDestino ?? '--',
      cantidadMaletas: Number(envio.cantidadMaletas ?? 0),
      estado: envio.estado ?? 'PENDIENTE',
      sla: Number(envio.sla ?? 1),
      planResumen: envio.planResumen ?? '--',
      tipoRuta: Number(envio.sla ?? 1) > 1 ? 'intercontinental' : 'continental',
    }))
  }, [simState])

  const kpis = useMemo(() => getKpis(simState), [simState])
  const aeropuertos = useMemo(() => getAeropuertos(simState), [simState])
  const throughput = useMemo(() => getThroughput(simState), [simState])
  const logEntries = useMemo(() => getLog(simState), [simState])

  const vuelos = useMemo(() => getVuelos(simState), [simState])

  const vuelosCounts = useMemo(() => {
    const counts = Object.fromEntries(VUELO_STATUS_ORDER.map((s) => [s, 0]))
    for (const v of vuelos) {
      const key = v.estado?.toLowerCase() || 'planificado'
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  }, [vuelos])

  const visibleVuelos = useMemo(() => {
    const q = query.trim().toLowerCase()
    return vuelos.filter((v) => {
      const estado = (v.estado || 'planificado').toLowerCase()
      const haystack = `${v.codigoVuelo || ''} ${v.origen || ''} ${v.destino || ''}`.toLowerCase()
      return vueloStatusFilter.has(estado) && (!q || haystack.includes(q))
    })
  }, [vuelos, query, vueloStatusFilter])

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
      const haystack = `${envio.idEnvio} ${envio.aeropuertoOrigen} ${envio.aeropuertoDestino}`.toLowerCase()
      const matchesSearch = !q || haystack.includes(q)
      const matchesStatus = statusFilter.has(envio.estado)
      const matchesRoute = routeFilter.has(envio.tipoRuta)
      return matchesSearch && matchesStatus && matchesRoute
    })
  }, [envios, query, statusFilter, routeFilter])

  const summary = useMemo(() => {
    const totalEnvios = visible.length
    const totalMaletas = visible.reduce((acc, envio) => acc + Number(envio.cantidadMaletas || 0), 0)
    const vencidos = visible.filter((envio) => envio.estado === 'RETRASADO').length
    const slaOk = totalEnvios === 0 ? 0 : Math.round(((totalEnvios - vencidos) / totalEnvios) * 100)
    const fallbackSla = Number(kpis.cumplimientoSLA || 0)
    const finalSla = totalEnvios === 0 ? fallbackSla : slaOk
    return { totalEnvios, totalMaletas, slaOk: finalSla, vencidos }
  }, [visible, kpis])

  function toggleStatus(status) {
    setStatusFilter((current) => {
      const next = new Set(current)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  function toggleVueloStatus(status) {
    setVueloStatusFilter((current) => {
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

  const subtabBtn = (key, label, count) => ({
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 1.5,
      padding: '6px 14px',
      background: 'transparent',
      border: 'none',
      borderBottom: `2px solid ${subtab === key ? 'var(--blue)' : 'transparent'}`,
      color: subtab === key ? 'var(--text-bright)' : 'var(--muted)',
      cursor: 'pointer',
    },
    onClick: () => { setSubtab(key); setQuery('') },
    children: `${label} (${count})`,
  })

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr', minHeight: 0 }}>
      {/* Subtab toggle */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--panel)', padding: '0 14px', flexShrink: 0 }}>
        <button {...subtabBtn('envios', 'Envíos', envios.length)} />
        <button {...subtabBtn('vuelos', 'Vuelos', vuelos.length)} />
      </div>

      {/* Main content */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', minHeight: 0, overflow: 'hidden' }}>
        <aside style={{ background: 'var(--panel)', borderRight: '1px solid var(--border)', padding: '16px 14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={subtab === 'envios' ? 'Buscar ID, origen, destino...' : 'Buscar código, origen, destino...'}
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

          {subtab === 'envios' ? (
            <>
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
            </>
          ) : (
            <>
              <div style={{ marginTop: 16 }}>
                <div style={headingStyle()}>Estado</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {VUELO_STATUS_ORDER.map((status) => {
                    const active = vueloStatusFilter.has(status)
                    return (
                      <button
                        key={status}
                        onClick={() => toggleVueloStatus(status)}
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
                        <span style={{ width: 3, height: 14, background: VUELO_STATUS_COLOR[status] || 'var(--muted)', display: 'block' }} />
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'left' }}>{status}</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{vuelosCounts[status] || 0}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <div style={headingStyle()}>Resumen</div>
                {[
                  ['Total vuelos', vuelos.length],
                  ['Activos', vuelosCounts['activo'] || 0],
                  ['Cancelados', (vuelosCounts['cancelled'] || 0) + (vuelosCounts['cancelado'] || 0)],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)' }}>{value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>

        <section style={{ overflowY: 'auto', minHeight: 0 }}>
          {subtab === 'envios' ? (
            <>
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
            </>
          ) : (
            <>
              <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--panel)', borderBottom: '1px solid var(--border)', padding: '8px 14px' }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1.8fr 0.8fr 0.8fr 0.8fr 0.8fr 0.9fr 0.8fr',
                  gap: 10,
                  fontFamily: 'var(--mono)',
                  fontSize: 10,
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                  color: 'var(--muted)',
                }}>
                  <span>Código</span><span>Origen</span><span>Destino</span><span>Salida</span><span>Llegada</span><span style={{ textAlign: 'right' }}>Carga/Cap</span><span>Estado</span>
                </div>
              </div>
              {visibleVuelos.length === 0 ? (
                <div style={{ minHeight: 'calc(100% - 44px)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                  SIN DATOS — Inicie una simulación
                </div>
              ) : visibleVuelos.map((v) => {
                const estado = (v.estado || 'planificado').toLowerCase()
                const colorEstado = VUELO_STATUS_COLOR[estado] || 'var(--muted)'
                const carga = v.cargaActual ?? v.currentLoad ?? '—'
                const cap = v.capacidadTotal ?? v.capacity ?? '—'
                return (
                  <div
                    key={v.codigoVuelo || v.id}
                    onClick={() => setSelectedVuelo(v)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.8fr 0.8fr 0.8fr 0.8fr 0.8fr 0.9fr 0.8fr',
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
                    <span style={{ color: 'var(--blue)' }}>{v.codigoVuelo || v.id || '—'}</span>
                    <span style={{ color: 'var(--text-bright)' }}>{v.origen || v.origin || '—'}</span>
                    <span style={{ color: 'var(--text-bright)' }}>{v.destino || v.destination || '—'}</span>
                    <span style={{ color: 'var(--muted)' }}>{v.horaSalida ? String(v.horaSalida).slice(0, 5) : '—'}</span>
                    <span style={{ color: 'var(--muted)' }}>{v.horaLlegada ? String(v.horaLlegada).slice(0, 5) : '—'}</span>
                    <span style={{ color: 'var(--muted)', textAlign: 'right' }}>{carga}/{cap}</span>
                    <span style={{ color: colorEstado }}>{estado}</span>
                  </div>
                )
              })}
            </>
          )}
        </section>
      </div>

      <DrawerEnvio
        envioId={selectedEnvioId}
        onClose={() => setSelectedEnvioId(null)}
      />
      <DrawerVuelo
        vuelo={selectedVuelo}
        onClose={() => setSelectedVuelo(null)}
        onCancelFlight={onCancelFlight}
      />
    </div>
  )
}
