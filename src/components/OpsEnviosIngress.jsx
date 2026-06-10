import React, { useEffect, useRef, useState } from 'react'
import { addOpsEnvio, planificarOps, resetOpsEnvios, uploadOpsEnvios } from '../services/api.js'

const FILE_PATTERN = /_envios_[A-Za-z]{4}_\.txt$/i

function getNowHHMM() {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function getLocalTimeForHuso(huso) {
  const now = new Date()
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000
  const localMs = utcMs + huso * 3600 * 1000
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
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, currentFile: '' })
  const [uploadResult, setUploadResult] = useState(null)
  const [uploadError, setUploadError] = useState(null)

  // ── manual form state ──────────────────────────────────────────────
  const [origen, setOrigen] = useState('')
  const [destino, setDestino] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const [hora, setHora] = useState(getNowHHMM)
  const [formLoading, setFormLoading] = useState(false)
  const [formSuccess, setFormSuccess] = useState(null)
  const [formError, setFormError] = useState(null)

  // ── planificar state ───────────────────────────────────────────────
  const [planLoading, setPlanLoading] = useState(false)
  const [planResult, setPlanResult] = useState(null)
  const [planError, setPlanError] = useState(null)

  // ── reset state ────────────────────────────────────────────────────
  const [resetLoading, setResetLoading] = useState(false)
  const [resetResult, setResetResult] = useState(null)
  const [resetError, setResetError] = useState(null)

  // ── file upload handlers ───────────────────────────────────────────
  function handleFileChange(event) {
    const files = Array.from(event.target.files || [])
    setUploadResult(null)
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
    setUploadResult(null)
    setUploadProgress({ current: 0, total: uploadFiles.length, currentFile: '' })

    const initialFiles = [...uploadFiles]
    let totalCount = 0
    const errors = []
    let processed = 0

    for (let i = 0; i < initialFiles.length; i++) {
      const item = initialFiles[i]
      setUploadFiles(prev => {
        const copy = prev.slice()
        if (copy[i]) copy[i] = { ...copy[i], status: 'in_progress', error: null }
        return copy
      })
      setUploadProgress({ current: processed, total: initialFiles.length, currentFile: item.file.name })
      try {
        const result = await uploadOpsEnvios(item.file)
        totalCount += result.count ?? 0
        processed += 1
        setUploadFiles(prev => {
          const copy = prev.slice()
          if (copy[i]) copy[i] = { ...copy[i], status: 'done' }
          return copy
        })
        setUploadProgress({ current: processed, total: initialFiles.length, currentFile: '' })
        if (onEnviosChanged) onEnviosChanged()
      } catch (err) {
        processed += 1
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${item.file.name}: ${msg}`)
        setUploadFiles(prev => {
          const copy = prev.slice()
          if (copy[i]) copy[i] = { ...copy[i], status: 'error', error: msg }
          return copy
        })
        setUploadProgress({ current: processed, total: initialFiles.length, currentFile: '' })
      }
    }

    const totalFiles = initialFiles.length
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (errors.length > 0) setUploadError(errors.join(' | '))
    if (totalCount > 0 || errors.length === 0) setUploadResult({ count: totalCount, files: totalFiles })

    setUploadFiles([])
    setUploadLoading(false)
    setUploadProgress({ current: 0, total: 0, currentFile: '' })
  }

  // ── manual form handler ────────────────────────────────────────────
  async function handleAddEnvio(event) {
    event.preventDefault()
    if (!origen || !destino || !hora) return
    setFormLoading(true)
    setFormSuccess(null)
    setFormError(null)

    const airport = airports.find(a => a.id === origen)
    const huso = airport ? (airport.huso ?? 0) : 0
    const today = new Date().toISOString().slice(0, 10)
    const absOffset = Math.abs(huso)
    const offsetSign = huso >= 0 ? '+' : '-'
    const fechaHoraIngreso = `${today}T${hora}:00${offsetSign}${String(absOffset).padStart(2, '0')}:00`

    try {
      await addOpsEnvio({
        iataOrigen: origen,
        iataDestino: destino,
        cantidadMaletas: Number(cantidad),
        fechaHoraIngreso,
      })
      setFormSuccess('Envío registrado correctamente')
      setDestino('')
      setCantidad(1)
      if (onEnviosChanged) onEnviosChanged()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setFormLoading(false)
    }
  }

  // ── reset handler ─────────────────────────────────────────────────
  async function handleReset() {
    setResetLoading(true)
    setResetResult(null)
    setResetError(null)
    try {
      const result = await resetOpsEnvios()
      setResetResult(result)
      if (onEnviosChanged) onEnviosChanged()
    } catch (err) {
      setResetError(err instanceof Error ? err.message : String(err))
    } finally {
      setResetLoading(false)
    }
  }

  // ── planificar handler ─────────────────────────────────────────────
  async function handlePlanificar() {
    setPlanLoading(true)
    setPlanResult(null)
    setPlanError(null)
    try {
      const result = await planificarOps()
      setPlanResult(result)
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
    const localMs = now.getTime() + (off * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000)
    const local = new Date(localMs)
    setHora(`${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`)
  }, [origen, airports])

  // ── derived ────────────────────────────────────────────────────────
  const origenAirport = airports.find(a => a.id === origen)
  const destinoOptions = airports.filter(a => a.id !== origen)
  const localTimeHint = origenAirport
    ? `Hora local en ${origenAirport.id} (${getOffsetStr(origenAirport.huso ?? 0)}): ${getLocalTimeForHuso(origenAirport.huso ?? 0)}`
    : null

  // ── styles ─────────────────────────────────────────────────────────
  const inputStyle = {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    fontFamily: 'var(--mono)',
    fontSize: 13,
    padding: '8px 10px',
    boxSizing: 'border-box',
    outline: 'none',
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
                            {status === 'pending' && 'Pendiente'}
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

              {uploadLoading && uploadProgress.total > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                    Subiendo {uploadProgress.current}/{uploadProgress.total}
                    {uploadProgress.currentFile ? ` · ${uploadProgress.currentFile}` : ''}
                  </div>
                  <div style={{ width: '100%', height: 8, background: 'rgba(255,255,255,0.04)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.round((uploadProgress.current / Math.max(1, uploadProgress.total)) * 100)}%`,
                      height: '100%',
                      background: 'var(--blue)',
                      transition: 'width 300ms',
                    }} />
                  </div>
                </div>
              )}

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
                {uploadLoading ? 'Subiendo...' : 'Subir'}
              </button>
            </div>
          )}

          {uploadResult && (
            <div style={{ marginTop: 6, color: '#22c55e', fontFamily: 'var(--mono)', fontSize: 11 }}>
              {uploadResult.files > 1
                ? `${uploadResult.files} archivos procesados — ${uploadResult.count} envíos cargados`
                : `${uploadResult.count} envíos cargados`}
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
                disabled={formLoading}
                style={{ ...inputStyle, appearance: 'none', WebkitAppearance: 'none' }}
                required
              >
                <option value="">Origen</option>
                {airports.map(a => (
                  <option key={a.id} value={a.id}>{a.id} — {a.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Destino</label>
              <select
                value={destino}
                onChange={e => setDestino(e.target.value)}
                disabled={formLoading || !origen}
                style={{ ...inputStyle, appearance: 'none', WebkitAppearance: 'none', opacity: !origen ? 0.5 : 1 }}
                required
              >
                <option value="">Destino</option>
                {destinoOptions.map(a => (
                  <option key={a.id} value={a.id}>{a.id} — {a.name}</option>
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
                disabled={formLoading}
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
                disabled={formLoading}
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
              disabled={formLoading || !origen || !destino}
              style={{
                padding: '8px 12px',
                background: 'rgba(34,197,94,0.1)',
                border: '1px solid rgba(34,197,94,0.4)',
                color: '#22c55e',
                fontFamily: 'var(--mono)',
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: 1,
                cursor: formLoading || !origen || !destino ? 'not-allowed' : 'pointer',
                opacity: formLoading || !origen || !destino ? 0.5 : 1,
              }}
            >
              {formLoading ? 'Registrando...' : '+ Agregar'}
            </button>

            {formSuccess && (
              <div style={{ color: '#22c55e', fontFamily: 'var(--mono)', fontSize: 11 }}>
                {formSuccess}
              </div>
            )}
            {formError && (
              <div style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11 }}>
                {formError}
              </div>
            )}
          </form>
        </div>
      </div>

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

        <button
          onClick={handleReset}
          disabled={resetLoading}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 12px',
            background: 'rgba(255,80,80,0.06)',
            border: '1px solid rgba(255,80,80,0.3)',
            color: 'var(--red, #f87171)',
            fontFamily: 'var(--mono)',
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: 1,
            cursor: resetLoading ? 'not-allowed' : 'pointer',
            opacity: resetLoading ? 0.6 : 1,
          }}
        >
          {resetLoading ? 'Limpiando...' : '✕ Limpiar datos'}
        </button>

        {resetResult && !resetLoading && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#22c55e' }}>
            {resetResult.deleted ?? 0} envíos eliminados
          </div>
        )}

        {resetError && !resetLoading && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--red)' }}>
            {resetError}
          </div>
        )}
      </div>
    </div>
  )
}
