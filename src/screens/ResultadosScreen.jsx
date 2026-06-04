import React, { useMemo, useState } from 'react'
import { registrarExperimento, exportarExperimentos } from '../services/api.js'

const getEnvios = (s) =>
  s?.envios || s?.routes?.map((r) => ({
    idEnvio: r.id,
    codigoAerolinea: r.baggageId,
    aeropuertoOrigen: r.flightLegs?.[0]?.origin,
    aeropuertoDestino: r.flightLegs?.slice(-1)[0]?.destination,
    cantidadMaletas: r.bags,
    estado: r.status === 'green'
      ? 'ENTREGADO'
      : r.status === 'red'
        ? 'RETRASADO'
        : 'EN_TRANSITO',
    sla: r.type === 'same' ? 1 : 2,
    planResumen: r.flightLegs?.map((l) => `${l.origin}->${l.destination}`).join(' | '),
    tiempoRestante: r.etaRemaining ? `${Math.round(r.etaRemaining)}h` : '—',
  })) || []

const getAeropuertos = (s) => s?.aeropuertos || s?.airports || []

const getKpis = (s) => s?.kpis || {
  maletasEnTransito: s?.kpis?.bagsInTransit || 0,
  maletasEntregadas: s?.kpis?.bagsDelivered || 0,
  cumplimientoSLA: s?.kpis?.slaCompliance || 0,
  vuelosActivos: s?.kpis?.activeFlights || 0,
  slaVencidos: s?.kpis?.slaViolated || 0,
  ocupacionPromedioAlmacen: 0,
}

const getLog = (s) => s?.logOperaciones || []

function escapeCsv(value) {
  const text = String(value ?? '')
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

function csvDownload(state, rows, envios, cancelacionesList) {
  const dia = state.diaActual || state.currentDay || 0
  const fechaRaw = state.fechaSimulada || ''
  const fechaSlug = fechaRaw.split(' ')[0].replace(/\//g, '-') || 'sim'
  const filename = `tasf_reporte_${fechaSlug}_dia-${dia}.csv`

  const metadata = [
    ['fecha_simulada', state.fechaSimulada || '--'],
    ['dias_simulacion', state.totalDias || state.totalDays || 0],
    ['cumplimiento_sla_pct', Number(state.kpis?.cumplimientoSLA ?? state.kpis?.slaCompliance ?? 0).toFixed(2)],
    ['sla_vencidos', state.kpis?.slaVencidos ?? state.kpis?.slaViolated ?? 0],
    ['total_replanificaciones', (state.logOperaciones || []).filter((l) => /replan/i.test(l)).length],
    ['total_cancelaciones', (cancelacionesList || []).length],
  ]

  const airportHeader = ['aeropuerto', 'ciudad', 'recibidas', 'enviadas', 'ocup_prom_pct', 'ocup_max_pct', 'estado', 'sla_cumplido']
  const airportLines = rows.map((row) => [
    row.aeropuerto,
    row.ciudad || '',
    row.recib,
    row.enviad,
    row.ocupProm,
    row.ocupMax,
    row.estado,
    row.slaCumplido === null ? '--' : row.slaCumplido ? 'si' : 'no',
  ])

  const envioHeader = ['id_envio', 'origen', 'destino', 'estado', 'sla_dias', 'cumplido']
  const envioLines = (envios || []).map((e) => [
    e.idEnvio,
    e.aeropuertoOrigen || '--',
    e.aeropuertoDestino || '--',
    e.estado,
    e.sla || 1,
    e.estado === 'ENTREGADO' ? 'si' : 'no',
  ])

  const content = [
    ...metadata.map(([k, v]) => `${escapeCsv(k)},${escapeCsv(v)}`),
    '',
    '# AEROPUERTOS',
    airportHeader.join(','),
    ...airportLines.map((line) => line.map(escapeCsv).join(',')),
    '',
    '# ENVIOS',
    envioHeader.join(','),
    ...envioLines.map((line) => line.map(escapeCsv).join(',')),
    '',
    '# CANCELACIONES',
    'id,codigo_vuelo,fecha,hora',
    ...(cancelacionesList || []).map((c) =>
      [c.id, c.codigoVuelo, c.fecha, c.hora ? String(c.hora).substring(0, 5) : ''].map(escapeCsv).join(',')
    ),
  ].join('\n')

  const blob = new Blob([`﻿${content}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function headingStyle() {
  return {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    color: 'var(--muted)',
    letterSpacing: 2,
    textTransform: 'uppercase',
  }
}

function semaforoLabel(semaforo) {
  if (semaforo === 'rojo') return 'CRÍTICO'
  if (semaforo === 'ambar') return 'ALTO'
  return 'NORMAL'
}

function semaforoColor(semaforo) {
  if (semaforo === 'rojo') return 'var(--red)'
  if (semaforo === 'ambar') return 'var(--amber)'
  return 'var(--green)'
}

export default function ResultadosScreen({ simState }) {
  const isReady = simState?.finalizada === true
  // const [experSaved, setExperSaved] = useState(false)
  // const [experLoading, setExperLoading] = useState(false)
  // const [experError, setExperError] = useState(null)
  // const [exportLoading, setExportLoading] = useState(false)

  const airports = useMemo(() => getAeropuertos(simState).map((airport) => {
    if (airport.codigoIATA) return airport
    const pct = airport.warehouseCapacity > 0 ? (airport.currentOccupation / airport.warehouseCapacity) * 100 : 0
    const semaforo = pct >= 85 ? 'rojo' : pct >= 60 ? 'ambar' : 'verde'
    return {
      codigoIATA: airport.id,
      ciudad: airport.name,
      continente: airport.continent,
      capacidadAlmacen: Number(airport.warehouseCapacity || 0),
      ocupacionActual: Number(airport.currentOccupation || 0),
      semaforo,
    }
  }), [simState])

  const envios = useMemo(() => getEnvios(simState), [simState])

  const kpis = useMemo(() => {
    const value = getKpis(simState)
    if (value?.maletasEnTransito !== undefined) {
      return {
        enTransito: Number(value.maletasEnTransito || 0),
        entregadas: Number(value.maletasEntregadas || 0),
        cumplimiento: Number(value.cumplimientoSLA || 0),
        vuelosActivos: Number(value.vuelosActivos || 0),
        slaVencidos: Number(value.slaVencidos || 0),
      }
    }

    return {
      enTransito: Number(value?.bagsInTransit || 0),
      entregadas: Number(value?.bagsDelivered || 0),
      cumplimiento: Number(value?.slaCompliance || 0),
      vuelosActivos: Number(value?.activeFlights || 0),
      slaVencidos: Number(value?.slaViolated || 0),
    }
  }, [simState])

  const enviosByAirport = useMemo(() => {
    const map = {}
    for (const envio of envios) {
      for (const iata of [envio.aeropuertoOrigen, envio.aeropuertoDestino]) {
        if (!iata || iata === '--') continue
        if (!map[iata]) map[iata] = { entregados: 0, total: 0 }
        map[iata].total++
        if (envio.estado === 'ENTREGADO') map[iata].entregados++
      }
    }
    return map
  }, [envios])

  const airportRows = useMemo(() => airports
    .map((airport) => {
      const livePct = airport.capacidadAlmacen ? (airport.ocupacionActual / airport.capacidadAlmacen) * 100 : 0
      const apStats = enviosByAirport[airport.codigoIATA] || { entregados: 0, total: 0 }
      const slaCumplido = apStats.total === 0 ? null
        : apStats.entregados / apStats.total >= 0.85
      return {
        aeropuerto: airport.codigoIATA,
        ciudad: airport.ciudad || '',
        recib: airport.maletasRecibidas ?? airport.ocupacionActual,
        enviad: airport.maletasEnviadas ?? airport.ocupacionActual,
        ocupProm: Number((airport.ocupacionPromedio != null ? airport.ocupacionPromedio : livePct).toFixed(1)),
        ocupMax: Number((airport.ocupacionMaxima != null ? airport.ocupacionMaxima : livePct).toFixed(1)),
        estado: semaforoLabel(airport.semaforo),
        semaforo: airport.semaforo,
        slaCumplido,
      }
    })
    .sort((a, b) => b.ocupMax - a.ocupMax), [airports, enviosByAirport])

  const cancelaciones = useMemo(() => {
    if (Array.isArray(simState?.cancelaciones)) {
      return simState.cancelaciones
    }
    return []
  }, [simState])

  const replanificaciones = useMemo(() => {
    if (Array.isArray(simState?.logOperaciones)) {
      return getLog(simState).filter((line) => /replan/i.test(line)).length
    }
    return envios.filter((envio) => String(envio.planResumen || '').includes('|')).length
  }, [simState, envios])

  const slaBreakdown = useMemo(() => {
    const continental = envios.filter((envio) => Number(envio.sla || 1) === 1)
    const intercontinental = envios.filter((envio) => Number(envio.sla || 1) > 1)
    const continentalOk = continental.filter((envio) => envio.estado !== 'RETRASADO').length
    const intercontinentalOk = intercontinental.filter((envio) => envio.estado !== 'RETRASADO').length

    return {
      continental: continental.length ? (continentalOk / continental.length) * 100 : 0,
      intercontinental: intercontinental.length ? (intercontinentalOk / intercontinental.length) * 100 : 0,
    }
  }, [envios])

  /* async function handleGuardarExperimento() {
    setExperLoading(true)
    setExperError(null)
    try {
      await registrarExperimento()
      setExperSaved(true)
    } catch (err) {
      setExperError(err instanceof Error ? err.message : String(err))
    } finally {
      setExperLoading(false)
    }
  } */

  /* async function handleDescargarExperimentos() {
    setExportLoading(true)
    setExperError(null)
    try {
      await exportarExperimentos()
    } catch (err) {
      setExperError(err instanceof Error ? err.message : String(err))
    } finally {
      setExportLoading(false)
    }
  } */

  const totalMaletas = envios.reduce((sum, e) => sum + Number(e.cantidadMaletas || 0), 0)
  const statusColor = kpis.cumplimiento >= 95 ? 'var(--green)' : 'var(--amber)'
  const statusLabel = kpis.cumplimiento >= 95 ? '● SIMULACIÓN COMPLETADA' : '● COMPLETADA CON ALERTAS'

  if (!isReady) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        height: '100%', gap: 8,
      }}>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 12,
          color: 'var(--muted)', textTransform: 'uppercase',
          letterSpacing: 2,
        }}>SIN RESULTADOS</span>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 11,
          color: 'var(--muted)'
        }}>
          Ejecute una simulación completa para ver resultados
        </span>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '55% 45%', minHeight: 0 }}>
      <section style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', minHeight: 0 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${statusColor}` }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: statusColor }}>{statusLabel}</div>
          <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 11 }}>
            Cumplimiento SLA {kpis.cumplimiento.toFixed(1)}% · {kpis.slaVencidos} vencidos · {simState?.totalDays || simState?.totalDias || 0} días
          </div>
        </div>

        <div style={{ borderBottom: '1px solid var(--border)', padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {[
            ['Total maletas', totalMaletas],
            ['Entregadas', kpis.entregadas],
            ['Cumpl. SLA', `${kpis.cumplimiento.toFixed(1)}%`],
            ['Cancelaciones', cancelaciones.length],
            ['Replanificaciones', replanificaciones],
            ['Duración sim', `${simState?.totalDays || simState?.totalDias || 0}d`],
          ].map(([label, value], idx) => (
            <div key={label} style={{ padding: '10px 8px', borderRight: idx % 3 !== 2 ? '1px solid var(--border)' : 'none', borderBottom: idx < 3 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 24, color: 'var(--text-bright)' }}>{value}</div>
              <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: 1.5, textTransform: 'uppercase' }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ padding: '14px 18px', minHeight: 0 }}>
          <div style={headingStyle()}>Desempeño por aeropuerto</div>
          <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.9fr 0.6fr 0.6fr 0.8fr 0.8fr 0.8fr', gap: 8, padding: '6px 0', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: 1.2, color: 'var(--muted)', textTransform: 'uppercase' }}>
              <span>Aeropuerto</span><span>Ciudad</span><span style={{ textAlign: 'right' }}>Recib</span><span style={{ textAlign: 'right' }}>Enviad</span><span style={{ textAlign: 'right' }}>Ocup.prom</span><span style={{ textAlign: 'right' }}>Ocup.max</span><span>Estado</span>
            </div>
            {airportRows.map((row) => (
              <div key={row.aeropuerto} style={{ display: 'grid', gridTemplateColumns: '1fr 0.9fr 0.6fr 0.6fr 0.8fr 0.8fr 0.8fr', gap: 8, padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.04)', fontFamily: 'var(--mono)', fontSize: 13 }}>
                <span style={{ color: 'var(--blue)' }}>{row.aeropuerto}</span>
                <span style={{ color: 'var(--muted)', fontSize: 11 }}>{row.ciudad || '—'}</span>
                <span style={{ textAlign: 'right', color: 'var(--text)' }}>{row.recib}</span>
                <span style={{ textAlign: 'right', color: 'var(--text)' }}>{row.enviad}</span>
                <span style={{ textAlign: 'right', color: 'var(--muted)' }}>{row.ocupProm}%</span>
                <span style={{ textAlign: 'right', color: 'var(--muted)' }}>{row.ocupMax}%</span>
                <span style={{ color: semaforoColor(row.semaforo) }}>{row.estado}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ padding: 18, overflowY: 'auto', minHeight: 0 }}>
        <div>
          <div style={{ marginTop: 10 }}>
            {[
              ['Rutas evaluadas', envios.length || '--'],
              ['Periodo', `${simState?.totalDays || simState?.totalDias || 0} días`],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={headingStyle()}>Análisis SLA</div>
          {[
            ['Continental', slaBreakdown.continental],
            ['Intercontinental', slaBreakdown.intercontinental],
          ].map(([label, value]) => {
            const color = value >= 85 ? 'var(--green)' : value >= 70 ? 'var(--amber)' : 'var(--red)'
            return (
              <div key={label} style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)' }}>{Number(value).toFixed(1)}%</span>
                </div>
                <div style={{ width: '100%', height: 6, background: 'var(--border)' }}>
                  <div style={{ width: `${Math.min(100, value)}%`, height: '100%', background: color }} />
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={headingStyle()}>Log de operaciones</div>
          <div style={{ marginTop: 8, maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', padding: 8 }}>
            {(getLog(simState).length ? getLog(simState) : ['Sin eventos en esta simulación']).map((entry, idx) => {
              const [ts, ...rest] = String(entry).split('|')
              const body = rest.length ? rest.join('|').trim() : ts
              const stamp = rest.length ? ts.trim() : '--'
              return (
                <div key={`${entry}-${idx}`} style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                  <span style={{ color: 'rgba(127,127,127,0.9)', marginRight: 8 }}>{stamp}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{body}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Historial de vuelos */}
        {(() => {
          const vuelosHistorial = (simState?.vuelos || []).filter((v) =>
            v.cancelado || v.cargaActual > 0 || v.currentLoad > 0
          )
          if (vuelosHistorial.length === 0) return null
          return (
            <div style={{ marginTop: 20 }}>
              <div style={headingStyle()}>Historial de vuelos ({vuelosHistorial.length})</div>
              <div style={{ marginTop: 8, border: '1px solid var(--border)', overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.7fr 0.7fr 1fr 0.7fr', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: 1.5, textTransform: 'uppercase' }}>
                  <span>Código</span><span>Origen</span><span>Destino</span><span>Estado</span><span style={{ textAlign: 'right' }}>Carga</span>
                </div>
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {vuelosHistorial.map((v, i) => {
                    const cancelado = v.cancelado === true || v.status === 'cancelado' || v.estado === 'cancelado'
                    const carga = v.cargaActual ?? v.currentLoad ?? 0
                    return (
                      <div key={v.id || v.codigoVuelo || i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.7fr 0.7fr 1fr 0.7fr', gap: 8, padding: '5px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                        <span style={{ color: 'var(--blue)' }}>{v.id || v.codigoVuelo || '—'}</span>
                        <span style={{ color: 'var(--muted)' }}>{v.origin || v.origen || '—'}</span>
                        <span style={{ color: 'var(--muted)' }}>{v.destination || v.destino || '—'}</span>
                        <span style={{ color: cancelado ? 'var(--red)' : 'var(--green)' }}>{cancelado ? 'CANCELADO' : 'COMPLETADO'}</span>
                        <span style={{ textAlign: 'right', color: 'var(--muted)' }}>{carga}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })()}

        {cancelaciones.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={headingStyle()}>Cancelaciones ({cancelaciones.length})</div>
            <div style={{ marginTop: 8, border: '1px solid var(--border)', overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.8fr 0.8fr', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: 1.5, textTransform: 'uppercase' }}>
                <span>ID</span><span>Vuelo</span><span>Fecha</span><span>Hora</span>
              </div>
              <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                {cancelaciones.map((c) => (
                  <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.8fr 0.8fr', gap: 8, padding: '5px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                    <span style={{ color: 'var(--red)', fontSize: 10 }}>{c.id}</span>
                    <span style={{ color: 'var(--blue)' }}>{c.codigoVuelo}</span>
                    <span style={{ color: 'var(--muted)' }}>{c.fecha}</span>
                    <span style={{ color: 'var(--muted)' }}>{c.hora ? String(c.hora).substring(0, 5) : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <button
          onClick={() => csvDownload(simState, airportRows, envios, cancelaciones)}
          style={{
            marginTop: 20,
            width: '100%',
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontFamily: 'var(--mono)',
            fontSize: 12,
            padding: 10,
            letterSpacing: 1,
            cursor: 'pointer',
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.borderColor = 'var(--blue)'
            event.currentTarget.style.color = 'var(--blue)'
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.borderColor = 'var(--border)'
            event.currentTarget.style.color = 'var(--text)'
          }}
        >
          ↓ EXPORTAR REPORTE CSV
        </button>

        {/* <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div style={headingStyle()}>Experimentación numérica</div>
          {experError && (
            <div style={{ marginTop: 8, borderLeft: '2px solid var(--red)', background: 'rgba(248,81,73,0.06)', padding: '6px 10px', color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11 }}>
              {experError}
            </div>
          )}
          <button
            onClick={handleGuardarExperimento}
            disabled={experSaved || experLoading}
            style={{
              marginTop: 10,
              width: '100%',
              background: experSaved ? 'rgba(34,208,122,0.08)' : 'transparent',
              border: `1px solid ${experSaved ? 'var(--green)' : 'var(--border)'}`,
              color: experSaved ? 'var(--green)' : 'var(--text)',
              fontFamily: 'var(--mono)',
              fontSize: 12,
              padding: 10,
              letterSpacing: 1,
              cursor: experSaved || experLoading ? 'not-allowed' : 'pointer',
              opacity: experSaved || experLoading ? 0.7 : 1,
            }}
          >
            {experSaved ? '✓ EXPERIMENTO GUARDADO' : experLoading ? 'GUARDANDO...' : '↑ GUARDAR EXPERIMENTO'}
          </button>
          <button
            onClick={handleDescargarExperimentos}
            disabled={exportLoading}
            style={{
              marginTop: 8,
              width: '100%',
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              fontFamily: 'var(--mono)',
              fontSize: 12,
              padding: 10,
              letterSpacing: 1,
              cursor: exportLoading ? 'not-allowed' : 'pointer',
              opacity: exportLoading ? 0.7 : 1,
            }}
            onMouseEnter={(event) => {
              if (!exportLoading) {
                event.currentTarget.style.borderColor = 'var(--blue)'
                event.currentTarget.style.color = 'var(--blue)'
              }
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.borderColor = 'var(--border)'
              event.currentTarget.style.color = 'var(--text)'
            }}
          >
            {exportLoading ? 'DESCARGANDO...' : '↓ DESCARGAR REGISTRO DE EXPERIMENTOS'}
          </button>
        </div> */}
      </section>
    </div>
  )
}
