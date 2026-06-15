import React, { useEffect, useRef, useState } from 'react'
import { previewOpsEnvios, batchSaveOpsEnvios, planificarOps } from '../services/api.js'

const FILE_PATTERN = /_envios_[A-Za-z]{4}_\.txt$/i

function getNowHHMM() {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function getLocalTimeForHuso(huso) {
  const now = new Date()
  const localMs = now.getTime() + huso * 3600 * 1000
  const d = new Date(localMs)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function getOffsetStr(huso) {
  const sign = huso >= 0 ? '+' : '-'
  return `UTC${sign}${Math.abs(huso)}`
}

const TIME_INPUT_STYLE = `
.ops-time-input {
  color-scheme: dark;
}
.ops-time-input::-webkit-calendar-picker-indicator {
  filter: brightness(0) invert(0.65);
  cursor: pointer;
  opacity: 1;
}
`

export default function OpsEnviosIngress({ airports = [], onEnviosChanged }) {
  // ── file upload state ──────────────────────────────────────────────
  const fileInputRef = useRef(null)
  const [uploadFiles, setUploadFiles] = useState([])
  const [uploadFileError, setUploadFileError] = useState(null)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadError, setUploadError] = useState(null)

  // ── manual form state ──────────────────────────────────────────────
  const [origen, setOrigen] = useState('')
  const [destino, setDestino] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const [hora, setHora] = useState(getNowHHMM)
  const [formError, setFormError] = useState(null)

  // ── planificar state ───────────────────────────────────────────────
  const [planLoading, setPlanLoading] = useState(false)
  const [planResult, setPlanResult] = useState(null)
  const [planError, setPlanError] = useState(null)

  const [pendingEnvios, setPendingEnvios] = useState([])

  // ── file upload handlers ───────────────────────────────────────────
  function handleFileChange(event) {
    const files = Array.from(event.target.files || [])
    setUploadError(null)
    if (files.length === 0) {
      setUploadFiles([])
      setUploadFileError(null)
      return
    }
    const notTxt = files.find(f => !f.name.toLowerCase().endsWith('.txt'))
    if (notTxt) {
      setUploadFiles([])
      setUploadFileError('Solo se aceptan archivos .txt')
      return
    }
    const validFiles = files.filter(f => FILE_PATTERN.test(f.name))
    const invalidFiles = files.filter(f => !FILE_PATTERN.test(f.name))
    if (validFiles.length === 0) {
      setUploadFiles([])
      setUploadFileError('Ningún archivo válido. Debe ser: _envios_XXXX_.txt')
      return
    }
    setUploadFiles(validFiles.map(f => ({ file: f, status: 'pending', error: null })))
    setUploadFileError(invalidFiles.length > 0
      ? `Se ignoraron ${invalidFiles.length} archivo(s): ${invalidFiles.map(f => f.name).join(', ')}`
      : null
    )
  }

  function removeSelectedFile(index) {
    setUploadFiles(prev => prev.filter((_, i) => i !== index))
    setUploadFileError(null)
  }

  async function handleUpload() {
    if (!uploadFiles || uploadFiles.length === 0) return
    setUploadLoading(true)
    setUploadError(null)
    const initialFiles = [...uploadFiles]
    const errors = []
    for (let i = 0; i < initialFiles.length; i++) {
      const item = initialFiles[i]
      setUploadFiles(prev => {
        const copy = prev.slice()
        if (copy[i]) copy[i] = { ...copy[i], status: 'in_progress', error: null }
        return copy
      })
      try {
        const result = await previewOpsEnvios(item.file)
        const newItems = (result.items ?? []).map(it => ({ ...it, _localId: `${Date.now()}-${Math.random()}` }))
        setPendingEnvios(prev => [...prev, ...newItems])
        if (result.errors?.length) errors.push(...result.errors.map(e => `${item.file.name}: ${e}`))
        setUploadFiles(prev => {
          const copy = prev.slice()
          if (copy[i]) copy[i] = { ...copy[i], status: 'done' }
          return copy
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${item.file.name}: ${msg}`)
        setUploadFiles(prev => {
          const copy = prev.slice()
          if (copy[i]) copy[i] = { ...copy[i], status: 'error', error: msg }
          return copy
        })
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (errors.length > 0) setUploadError(errors.join(' | '))
    setUploadFiles([])
    setUploadLoading(false)
  }

  // ── manual form handler ────────────────────────────────────────────
  function handleAddEnvio(event) {
    event.preventDefault()
    if (!origen || !destino || !hora) return
    setFormError(null)
    const airport = airports.find(a => a.id === origen)
    const huso = airport ? (airport.huso ?? 0) : 0
    const today = new Date().toISOString().slice(0, 10)
    const absOffset = Math.abs(huso)
    const offsetSign = huso >= 0 ? '+' : '-'
    const fechaHoraIngreso = `${today}T${hora}:00${offsetSign}${String(absOffset).padStart(2, '0')}:00`
    const newItem = {
      _localId: `${Date.now()}-${Math.random()}`,
      idPedido: null,
      iataOrigen: origen,
      iataDestino: destino,
      cantidadMaletas: Number(cantidad),
      fechaHoraIngreso,
      sla: null,
    }
    setPendingEnvios(prev => [...prev, newItem])
    setDestino('')
    setCantidad(1)
  }

  // ── planificar handler ─────────────────────────────────────────────
  async function handlePlanificar() {
    setPlanLoading(true)
    setPlanResult(null)
    setPlanError(null)
    try {
      if (pendingEnvios.length > 0) {
        const dtos = pendingEnvios.map(({ idPedido, iataOrigen, iataDestino, cantidadMaletas, fechaHoraIngreso }) => ({
          idPedido: idPedido ?? null,
          iataOrigen,
          iataDestino,
          cantidadMaletas,
          fechaHoraIngreso,
        }))
        await batchSaveOpsEnvios(dtos)
        setPendingEnvios([])
      }
      const result = await planificarOps()
      setPlanResult(result)
      if (onEnviosChanged) onEnviosChanged()
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : String(err))
    } finally {
      setPlanLoading(false)
    }
  }

  // ── auto-update hora when origen changes (mirror ConfigScreen behaviour) ──
  useEffect(() => {
    if (!origen) return
    const ap = airports.find(a => a.id === origen)
    const off = ap?.huso ?? null
    if (off === null) return
    const now = new Date()
    const localMs = now.getTime() + off * 3600 * 1000
    const local = new Date(localMs)
    setHora(`${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`)
  }, [origen, airports])

  // ── derived ────────────────────────────────────────────────────────
  const origenAirport = airports.find(a => a.id === origen)
  const destinoOptions = airports.filter(a => a.id !== origen)
  const localTimeHint = origenAirport
    ? `Hora local en ${origenAirport.id} (${getOffsetStr(origenAirport.huso ?? 0)})`
    : null

  // ── styles ─────────────────────────────────────────────────────────
  const inputStyle = {
    width: '100%',
    background: '#161b22',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    fontFamily: 'var(--mono)',
    fontSize: 13,
    padding: '8px 10px',
    boxSizing: 'border-box',
    outline: 'none',
    colorScheme: 'dark',
  }

  const labelStyle = {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: 'var(--muted)',
    display: 'block',
    marginBottom: 4,
  }

  const sectionTitleStyle = {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 2,
    color: 'var(--muted)',
    marginBottom: 12,
    display: 'block',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <style>{TIME_INPUT_STYLE}</style>
      {/* File upload section */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>

        {/* File upload */}
        <div style={{ padding: '16px 16px' }}>
          <span style={sectionTitleStyle}>Subir archivo TXT</span>

          <input
            ref={fileInputRef}
            type="file"
            accept=".txt"
            multiple
            onChange={handleFileChange}
            disabled={uploadLoading}
            style={{ display: 'none' }}
            id="ops-upload-input"
          />
          <label
            htmlFor="ops-upload-input"
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 12px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--muted)',
              fontFamily: 'var(--mono)',
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: 1,
              cursor: uploadLoading ? 'not-allowed' : 'pointer',
              textAlign: 'center',
              opacity: uploadLoading ? 0.5 : 1,
              boxSizing: 'border-box',
            }}
          >
            Seleccionar archivos (.txt)
          </label>

          {uploadFileError && (
            <div style={{ marginTop: 6, color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11 }}>
              {uploadFileError}
            </div>
          )}

          {uploadFiles.length > 0 && !uploadFileError && (
            <div style={{ marginTop: 8 }}>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 160, overflowY: 'auto' }}>
                {uploadFiles.map((item, idx) => {
                  const name = item.file.name
                  const ext = name.split('.').pop() || ''
                  const status = item.status || 'pending'
                  const statusColor =
                    status === 'pending' ? 'var(--muted)' :
                    status === 'in_progress' ? 'var(--blue)' :
                    status === 'done' ? '#22c55e' :
                    'var(--red)'
                  return (
                    <li
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 8px',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        marginBottom: 6,
                      }}
                    >
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor, flexShrink: 0, display: 'inline-block' }} />
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                            <span style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', marginRight: 6 }}>{ext}</span>
                            {status === 'in_progress' && 'En curso'}
                            {status === 'done' && 'Completado'}
                            {status === 'error' && `Error: ${item.error}`}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeSelectedFile(idx)}
                        disabled={uploadLoading}
                        title="Eliminar"
                        style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 16, cursor: uploadLoading ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>

              <button
                onClick={handleUpload}
                disabled={uploadLoading || uploadFiles.length === 0}
                style={{
                  width: '100%',
                  padding: '7px 12px',
                  background: 'rgba(88,166,255,0.08)',
                  border: '1px solid rgba(88,166,255,0.3)',
                  color: 'var(--blue)',
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  cursor: uploadLoading ? 'not-allowed' : 'pointer',
                  opacity: uploadLoading ? 0.5 : 1,
                  marginTop: 8,
                }}
              >
                {uploadLoading ? 'Procesando...' : 'Cargar'}
              </button>
            </div>
          )}

          {uploadError && (
            <div style={{ marginTop: 6, color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11 }}>
              {uploadError}
            </div>
          )}

          <div style={{ marginTop: 8, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 10, opacity: 0.6 }}>
            Formato: _envios_XXXX_.txt
          </div>
        </div>

        {/* Manual form */}
        <div style={{ padding: '16px 16px', borderTop: '1px solid var(--border)' }}>
          <span style={sectionTitleStyle}>Ingreso manual</span>

          <form onSubmit={handleAddEnvio} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={labelStyle}>Origen</label>
              <select
                value={origen}
                onChange={e => { setOrigen(e.target.value); setDestino('') }}
                style={{ ...inputStyle, appearance: 'none', WebkitAppearance: 'none' }}
                required
              >
                <option value="" style={{ background: '#161b22', color: 'var(--text)' }}>Origen</option>
                {airports.map(a => (
                  <option key={a.id} value={a.id} style={{ background: '#161b22', color: 'var(--text)' }}>{a.id} — {a.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Destino</label>
              <select
                value={destino}
                onChange={e => setDestino(e.target.value)}
                disabled={!origen}
                style={{ ...inputStyle, appearance: 'none', WebkitAppearance: 'none', opacity: !origen ? 0.5 : 1 }}
                required
              >
                <option value="" style={{ background: '#161b22', color: 'var(--text)' }}>Destino</option>
                {destinoOptions.map(a => (
                  <option key={a.id} value={a.id} style={{ background: '#161b22', color: 'var(--text)' }}>{a.id} — {a.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Cantidad de maletas</label>
              <input
                type="number"
                min={1}
                value={cantidad}
                onChange={e => setCantidad(e.target.value)}
                style={{ ...inputStyle, appearance: 'textfield', MozAppearance: 'textfield', WebkitAppearance: 'none' }}
                required
              />
            </div>

            <div>
              <label style={labelStyle}>Hora de ingreso</label>
              <input
                type="time"
                className="ops-time-input"
                value={hora}
                onChange={e => setHora(e.target.value)}
                style={inputStyle}
                required
              />
              {localTimeHint && (
                <div style={{ marginTop: 4, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                  {localTimeHint}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!origen || !destino}
              style={{
                padding: '8px 12px',
                background: 'rgba(34,197,94,0.1)',
                border: '1px solid rgba(34,197,94,0.4)',
                color: '#22c55e',
                fontFamily: 'var(--mono)',
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: 1,
                cursor: !origen || !destino ? 'not-allowed' : 'pointer',
                opacity: !origen || !destino ? 0.5 : 1,
              }}
            >
              + Agregar
            </button>

            {formError && (
              <div style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11 }}>
                {formError}
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Pending envíos list */}
      {pendingEnvios.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>
          <span style={{ ...sectionTitleStyle, marginBottom: 8 }}>Por planificar ({pendingEnvios.length})</span>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 200, overflowY: 'auto' }}>
            {pendingEnvios.map(e => {
              const horaDisplay = e.fechaHoraIngreso ? e.fechaHoraIngreso.slice(11, 16) : '—'
              return (
                <li key={e._localId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, fontFamily: 'var(--mono)', fontSize: 11 }}>
                    <span style={{ color: 'var(--muted)' }}>{e.idPedido ?? '—'}</span>
                    <span style={{ color: 'var(--text)' }}>{e.iataOrigen}</span>
                    <span style={{ color: 'var(--muted)' }}>→</span>
                    <span style={{ color: 'var(--text)' }}>{e.iataDestino}</span>
                    <span style={{ color: 'var(--muted)' }}>{e.cantidadMaletas}✕</span>
                    <span style={{ color: 'var(--muted)' }}>{horaDisplay}</span>
                  </div>
                  <button onClick={() => setPendingEnvios(prev => prev.filter(x => x._localId !== e._localId))}
                    title="Eliminar" style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>×</button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Planificar row */}
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={handlePlanificar}
          disabled={planLoading}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 12px',
            background: 'rgba(88,166,255,0.08)',
            border: '1px solid rgba(88,166,255,0.3)',
            color: 'var(--blue)',
            fontFamily: 'var(--mono)',
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: 1,
            fontWeight: 700,
            cursor: planLoading ? 'not-allowed' : 'pointer',
            opacity: planLoading ? 0.6 : 1,
          }}
        >
          {planLoading ? 'Planificando...' : '▶ Planificar rutas (SA)'}
        </button>

        {planResult && !planLoading && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#22c55e' }}>
            {planResult.planesCalculados ?? planResult.planned ?? 0} planes calculados,{' '}
            {planResult.sinRuta ?? planResult.unplanned ?? 0} sin ruta
          </div>
        )}

        {planError && !planLoading && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--red)' }}>
            {planError}
          </div>
        )}
      </div>
    </div>
  )
}
