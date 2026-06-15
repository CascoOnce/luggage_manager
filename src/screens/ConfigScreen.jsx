import React, { useEffect, useRef, useState } from 'react'
import { api, startSimulation, previewOpsEnvios, batchSaveOpsEnvios } from '../services/api.js'

const FILE_PATTERN = /_envios_[A-Za-z]{4}_\.txt$/i

function formatIdPedido(id) {
  if (!id) return 'NUEVO'
  return id.replace(/-0*(\d+)$/, '-$1')
}

const PERIOD_OPTIONS = [
  { key: '3', label: '3 DÍAS', sublabel: 'Simulación corta' },
  { key: '5', label: '5 DÍAS', sublabel: 'Simulación estándar' },
  { key: '7', label: '7 DÍAS', sublabel: 'Simulación semanal' },
  { key: 'colapso', label: 'COLAPSO', sublabel: 'Sin límite — hasta el colapso' },
]

function sectionHeaderStyle() {
  return {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 2,
    color: 'var(--muted)',
    marginBottom: 12,
    display: 'block',
  }
}

export default function ConfigScreen({ onCancel, onSimulationStarted, onOperacionesStarted }) {
  const [periodo, setPeriodo] = useState('3')
  const algoritmo = 'SIMULATED_ANNEALING'
  const [fechaInicio, setFechaInicio] = useState('2026-06-01')
  const [horaInicio, setHoraInicio] = useState('00:00')
  const [escalaMinima, setEscalaMinima] = useState(10)
  const [tiempoRecogida, setTiempoRecogida] = useState(10)
  const [semaforo, setSemaforo] = useState({ verde: 60, ambar: 85 })
  const [umbralColapso, setUmbralColapso] = useState(50)
  const [cancelacionesAleatorias, setCancelacionesAleatorias] = useState(false)
  const [porcentajeCancelacion, setPorcentajeCancelacion] = useState(5)
  const [loading, setLoading] = useState(false)
  const [loadingElapsed, setLoadingElapsed] = useState(0)
  const [error, setError] = useState(null)
  // uploadFile: array of { file: File, status: 'pending'|'in_progress'|'done'|'error', error?: string }
  const [uploadFile, setUploadFile] = useState([])
  const [uploadFileError, setUploadFileError] = useState(null)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, currentFile: '' })
  const fileInputRef = useRef(null)

  const [modoConfig, setModoConfig] = useState('simulacion') // 'simulacion' | 'operaciones'
  const [opsAirports, setOpsAirports] = useState([])
  const [opsUploadFile, setOpsUploadFile] = useState([])
  const [opsUploadFileError, setOpsUploadFileError] = useState(null)
  const [opsUploadLoading, setOpsUploadLoading] = useState(false)
  const [opsUploadError, setOpsUploadError] = useState(null)
  const opsFileInputRef = useRef(null)
  const [opsOrigen, setOpsOrigen] = useState('')
  const [opsDestino, setOpsDestino] = useState('')
  const [opsCantidad, setOpsCantidad] = useState(1)
  const [opsHora, setOpsHora] = useState(() => { const n = new Date(); return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}` })
  const [opsFormError, setOpsFormError] = useState(null)
  const [pendingEnvios, setPendingEnvios] = useState([])
  const [opsIniciarLoading, setOpsIniciarLoading] = useState(false)

  useEffect(() => {
    if (!loading) { setLoadingElapsed(0); return }
    setLoadingElapsed(0)
    const start = Date.now()
    const id = setInterval(() => setLoadingElapsed(Math.floor((Date.now() - start) / 100) / 10), 100)
    return () => clearInterval(id)
  }, [loading])

  useEffect(() => {
    if (modoConfig !== 'operaciones') return
    api.getAirports().then(data => {
      setOpsAirports(data.map(a => ({ id: a.codigoIATA, name: a.nombre, huso: a.huso ?? 0 })))
    }).catch(() => {})
  }, [modoConfig])

  useEffect(() => {
    if (!opsOrigen) return
    const ap = opsAirports.find(a => a.id === opsOrigen)
    const off = ap?.huso ?? null
    if (off === null) return
    const now = new Date()
    const localMs = now.getTime() + off * 3600 * 1000
    const local = new Date(localMs)
    setOpsHora(`${String(local.getUTCHours()).padStart(2,'0')}:${String(local.getUTCMinutes()).padStart(2,'0')}`)
    if (opsDestino === opsOrigen) setOpsDestino('')
  }, [opsOrigen, opsAirports])

  const semaforoError = Number(semaforo.ambar) <= Number(semaforo.verde)
    ? 'Umbral ámbar debe ser mayor que verde'
    : null

  function rowStyle(selected) {
    return {
      width: '100%',
      padding: '10px 12px',
      border: `1px solid ${selected ? 'var(--blue)' : 'var(--border)'}`,
      background: selected ? 'rgba(88,166,255,0.06)' : 'transparent',
      marginBottom: 4,
      cursor: loading ? 'not-allowed' : 'pointer',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      textAlign: 'left',
      opacity: loading ? 0.7 : 1,
    }
  }

  function handleFileChange(event) {
    const files = Array.from(event.target.files || [])
    setUploadResult(null)
    setUploadError(null)
    if (files.length === 0) {
      setUploadFile([])
      setUploadFileError(null)
      return
    }
    // Validación estricta de extensión .txt
    const notTxt = files.find(f => !f.name.toLowerCase().endsWith('.txt'))
    if (notTxt) {
      setUploadFile([])
      setUploadFileError('Solo se aceptan archivos .txt')
      return
    }

    // Separar archivos válidos e inválidos según el patrón de nombre
    const validFiles = files.filter(f => FILE_PATTERN.test(f.name))
    const invalidFiles = files.filter(f => !FILE_PATTERN.test(f.name))

    if (validFiles.length === 0) {
      setUploadFile([])
      setUploadFileError(`Ningún archivo válido. Debe ser: _envios_XXXX_.txt`)
      return
    }

    setUploadFile(validFiles.map(f => ({ file: f, status: 'pending', error: null })))
    setUploadFileError(invalidFiles.length > 0
      ? `Se ignoraron ${invalidFiles.length} archivo(s): ${invalidFiles.map(f => f.name).join(', ')}`
      : null
    )
  }

  function removeSelectedFile(index) {
    setUploadFile((prev) => prev.filter((_, i) => i !== index))
    setUploadFileError(null)
  }

  async function handleUpload() {
    if (!uploadFile || uploadFile.length === 0) return
    setUploadLoading(true)
    setUploadError(null)
    setUploadResult(null)
    setUploadProgress({ current: 0, total: uploadFile.length, currentFile: '' })

    const initialFiles = [...uploadFile]
    let totalCount = 0
    const errors = []
    let processed = 0

    for (let i = 0; i < initialFiles.length; i++) {
      const item = initialFiles[i]
      // mark in progress
      setUploadFile((prev) => {
        const copy = prev.slice()
        if (copy[i]) copy[i] = { ...copy[i], status: 'in_progress', error: null }
        return copy
      })
      setUploadProgress({ current: processed, total: initialFiles.length, currentFile: item.file.name })
      try {
        const result = await api.uploadEnvios(item.file)
        totalCount += result.count ?? 0
        processed += 1
        // mark done
        setUploadFile((prev) => {
          const copy = prev.slice()
          if (copy[i]) copy[i] = { ...copy[i], status: 'done' }
          return copy
        })
        setUploadProgress({ current: processed, total: initialFiles.length, currentFile: '' })
      } catch (err) {
        processed += 1
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${item.file.name}: ${msg}`)
        setUploadFile((prev) => {
          const copy = prev.slice()
          if (copy[i]) copy[i] = { ...copy[i], status: 'error', error: msg }
          return copy
        })
        setUploadProgress({ current: processed, total: initialFiles.length, currentFile: '' })
      }
    }

    const totalFiles = initialFiles.length
    // reset input and selection
    if (fileInputRef.current) fileInputRef.current.value = ''
    // set results / errors
    if (errors.length > 0) {
      setUploadError(errors.join(' | '))
    }
    if (totalCount > 0 || errors.length === 0) {
      setUploadResult({ count: totalCount, files: totalFiles })
    }

    // clear selection after upload completes
    setUploadFile([])
    setUploadLoading(false)
    setUploadProgress({ current: 0, total: 0, currentFile: '' })
  }

  async function handleSimular() {
    if (semaforoError) {
      setError(semaforoError)
      return
    }
    const esColapso = periodo === 'colapso'
    const dias = esColapso ? 99 : Number.parseInt(periodo, 10)
    const params = {
      algoritmo,
      dias,
      esColapso,
      minutosEscalaMinima: Number(escalaMinima),
      minutosRecogidaDestino: Number(tiempoRecogida),
      umbralSemaforoVerde: Number(semaforo.verde),
      umbralSemaforoAmbar: Number(semaforo.ambar),
      fechaInicio,
      horaInicio,
      umbralColapsoPorcentajeSlaVencido: esColapso ? Number(umbralColapso) : 50,
      porcentajeCancelacionAleatoria: cancelacionesAleatorias ? Number(porcentajeCancelacion) : 0,
    }

    setLoading(true)
    setError(null)
    try {
      const state = await startSimulation(params)
      onSimulationStarted(state, params)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  function handleOpsFileChange(event) {
    const files = Array.from(event.target.files || [])
    setOpsUploadError(null)
    if (!files.length) { setOpsUploadFile([]); setOpsUploadFileError(null); return }
    const notTxt = files.find(f => !f.name.toLowerCase().endsWith('.txt'))
    if (notTxt) { setOpsUploadFile([]); setOpsUploadFileError('Solo archivos .txt'); return }
    const valid = files.filter(f => FILE_PATTERN.test(f.name))
    const invalid = files.filter(f => !FILE_PATTERN.test(f.name))
    if (!valid.length) { setOpsUploadFile([]); setOpsUploadFileError('Formato inválido: _envios_XXXX_.txt'); return }
    setOpsUploadFile(valid.map(f => ({ file: f, status: 'pending', error: null })))
    setOpsUploadFileError(invalid.length > 0 ? `Ignorados ${invalid.length}: ${invalid.map(f => f.name).join(', ')}` : null)
  }

  async function handleOpsUpload() {
    if (!opsUploadFile.length) return
    setOpsUploadLoading(true)
    setOpsUploadError(null)
    const initial = [...opsUploadFile]
    const errors = []
    for (let i = 0; i < initial.length; i++) {
      setOpsUploadFile(prev => { const c = [...prev]; c[i] = { ...c[i], status: 'in_progress' }; return c })
      try {
        const result = await previewOpsEnvios(initial[i].file)
        const newItems = (result.items ?? []).map(item => ({ ...item, _localId: `${Date.now()}-${Math.random()}` }))
        setPendingEnvios(prev => [...prev, ...newItems])
        if (result.errors?.length) errors.push(...result.errors.map(e => `${initial[i].file.name}: ${e}`))
        setOpsUploadFile(prev => { const c = [...prev]; c[i] = { ...c[i], status: 'done' }; return c })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${initial[i].file.name}: ${msg}`)
        setOpsUploadFile(prev => { const c = [...prev]; c[i] = { ...c[i], status: 'error', error: msg }; return c })
      }
    }
    if (opsFileInputRef.current) opsFileInputRef.current.value = ''
    if (errors.length) setOpsUploadError(errors.join(' | '))
    setOpsUploadFile([])
    setOpsUploadLoading(false)
  }

  function handleOpsAddManual(e) {
    e.preventDefault()
    if (!opsOrigen || !opsDestino || opsCantidad < 1) { setOpsFormError('Origen, destino y cantidad requeridos'); return }
    if (opsOrigen === opsDestino) { setOpsFormError('Origen y destino deben ser distintos'); return }
    const ap = opsAirports.find(a => a.id === opsOrigen)
    const utcOffset = ap?.huso ?? 0
    const today = new Date().toISOString().slice(0, 10)
    const sign = utcOffset >= 0 ? '+' : '-'
    const absOff = Math.abs(utcOffset)
    const fechaHoraIngreso = `${today}T${opsHora}:00${sign}${String(absOff).padStart(2, '0')}:00`
    const newItem = {
      _localId: `${Date.now()}-${Math.random()}`,
      idPedido: null,
      iataOrigen: opsOrigen,
      iataDestino: opsDestino,
      cantidadMaletas: Number(opsCantidad),
      fechaHoraIngreso,
      sla: null,
    }
    setPendingEnvios(prev => [...prev, newItem])
    setOpsFormError(null)
    setOpsDestino('')
    setOpsCantidad(1)
  }

  async function handleOpsIniciar() {
    setOpsIniciarLoading(true)
    try {
      const dtos = pendingEnvios.map(({ idPedido, iataOrigen, iataDestino, cantidadMaletas, fechaHoraIngreso }) => ({
        idPedido: idPedido ?? null,
        iataOrigen,
        iataDestino,
        cantidadMaletas,
        fechaHoraIngreso,
      }))
      if (dtos.length > 0) {
        await batchSaveOpsEnvios(dtos)
      }
      onOperacionesStarted && onOperacionesStarted()
    } catch (err) {
      setOpsUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setOpsIniciarLoading(false)
    }
  }

  return (
    <>
      {loading && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(13,17,23,0.88)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', border: '3px solid rgba(88,166,255,0.15)', borderTopColor: 'var(--blue)', animation: 'spin 0.75s linear infinite' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)', letterSpacing: 1, marginBottom: 6 }}>Calculando rutas óptimas…</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
              Simulated Annealing · {periodo === 'colapso' ? 'Modo Colapso' : `${periodo} días`}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 22, color: 'var(--blue-bright)', fontWeight: 700, letterSpacing: 2 }}>
              {loadingElapsed.toFixed(1)}s
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 2, marginTop: 4 }}>
              tiempo de planificación
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Mode selector tabs */}
        <div style={{ display: 'flex', gap: 8, padding: '10px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {[
            { key: 'simulacion', label: 'Simulación', accent: 'var(--blue)', rgb: '88,166,255' },
            { key: 'operaciones', label: 'Operaciones día a día', accent: '#22c55e', rgb: '34,197,94' },
          ].map(opt => {
            const active = modoConfig === opt.key
            return (
              <button key={opt.key} onClick={() => setModoConfig(opt.key)}
                style={{ padding: '5px 14px', fontFamily: 'var(--mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, background: active ? `rgba(${opt.rgb},0.1)` : 'transparent', border: `1px solid ${active ? opt.accent : 'var(--border)'}`, borderBottom: active ? `2px solid ${opt.accent}` : '1px solid var(--border)', color: active ? opt.accent : 'var(--muted)', cursor: 'pointer' }}>
                {opt.label}
              </button>
            )
          })}
        </div>

        {modoConfig === 'simulacion' ? (
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '420px 1fr', background: 'var(--bg)', overflow: 'hidden', minHeight: 0 }}>
            <aside style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '24px 20px' }}>
              <span style={sectionHeaderStyle()}>Tipo de periodo</span>
              {PERIOD_OPTIONS.map((option) => {
                const selected = periodo === option.key
                return (
                  <button key={option.key} style={rowStyle(selected)} onClick={() => !loading && setPeriodo(option.key)} disabled={loading}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)' }}>{option.label}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{option.sublabel}</span>
                    </div>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: selected ? 'var(--blue)' : 'transparent', border: `1px solid ${selected ? 'var(--blue)' : 'var(--border)'}` }} />
                  </button>
                )
              })}

              <div style={{ marginTop: 20 }}>
                <span style={sectionHeaderStyle()}>Fecha y hora de inicio</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="date"
                    value={fechaInicio}
                    onChange={(event) => setFechaInicio(event.target.value)}
                    disabled={loading}
                    style={{ flex: 2, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13, padding: '8px 10px' }}
                  />
                  <input
                    type="time"
                    value={horaInicio}
                    onChange={(event) => setHoraInicio(event.target.value)}
                    disabled={loading}
                    style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13, padding: '8px 10px' }}
                  />
                </div>
              </div>

              <div style={{ marginTop: 20 }}>
                <span style={sectionHeaderStyle()}>Archivos de envíos</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt"
                  multiple
                  onChange={handleFileChange}
                  disabled={loading || uploadLoading}
                  style={{ display: 'none' }}
                  id="upload-envios-input"
                />
                <label
                  htmlFor="upload-envios-input"
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
                    cursor: loading || uploadLoading ? 'not-allowed' : 'pointer',
                    textAlign: 'center',
                    opacity: loading || uploadLoading ? 0.5 : 1,
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

                {uploadFile && uploadFile.length > 0 && !uploadFileError && (
                  <div style={{ marginTop: 8 }}>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 160, overflowY: 'auto' }}>
                      {uploadFile.map((item, idx) => {
                        const name = item.file.name
                        const ext = name.split('.').pop() || ''
                        const status = item.status || 'pending'
                        const statusColor = status === 'pending' ? 'var(--muted)' : status === 'in_progress' ? 'var(--blue)' : status === 'done' ? 'var(--green)' : 'var(--red)'
                        return (
                          <li key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 6 }}>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                              <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)' }}>{name}</div>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                                  <span style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', marginRight: 6 }}>{ext}</span>
                                  {status === 'pending' && 'Pendiente'}{status === 'in_progress' && 'En curso'}{status === 'done' && 'Completado'}{status === 'error' && `Error: ${item.error}`}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <button
                                onClick={() => removeSelectedFile(idx)}
                                disabled={uploadLoading || loading}
                                title="Eliminar"
                                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 16, cursor: uploadLoading || loading ? 'not-allowed' : 'pointer' }}
                              >
                                ×
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>

                    {uploadLoading && uploadProgress.total > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                          Subiendo {uploadProgress.current}/{uploadProgress.total} {uploadProgress.currentFile ? `· ${uploadProgress.currentFile}` : ''}
                        </div>
                        <div style={{ width: '100%', height: 8, background: 'rgba(255,255,255,0.04)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.round((uploadProgress.current / Math.max(1, uploadProgress.total)) * 100)}%`, height: '100%', background: 'var(--blue)', transition: 'width 300ms' }} />
                        </div>
                      </div>
                    )}

                    <button
                      onClick={handleUpload}
                      disabled={uploadLoading || loading || uploadFile.length === 0}
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
                        cursor: uploadLoading || loading ? 'not-allowed' : 'pointer',
                        opacity: uploadLoading || loading ? 0.5 : 1,
                        marginTop: 8,
                      }}
                    >
                      {uploadLoading ? 'Subiendo...' : 'Subir'}
                    </button>
                  </div>
                )}

                {uploadResult && (
                  <div style={{ marginTop: 6, color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: 11 }}>
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
            </aside>

            <section style={{ overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ marginBottom: 20 }}>
                <span style={sectionHeaderStyle()}>Parámetros de conexión</span>
                {[
                  { key: 'escala', label: 'Escala mínima (min)', value: escalaMinima, setter: setEscalaMinima },
                  { key: 'recogida', label: 'Tiempo recogida destino (min)', value: tiempoRecogida, setter: setTiempoRecogida },
                ].map(({ key, label, value, setter }) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>{label}</span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={value}
                      disabled={loading}
                      onChange={(event) => {
                        const v = Number(event.target.value)
                        if (Number.isFinite(v) && v >= 1 && v <= 60) setter(v)
                      }}
                      style={{ width: 64, textAlign: 'right', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13, padding: '6px 8px', appearance: 'textfield', MozAppearance: 'textfield', WebkitAppearance: 'none' }}
                    />
                  </div>
                ))}
              </div>

              {periodo === 'colapso' && (
                <div style={{ marginBottom: 20 }}>
                  <span style={sectionHeaderStyle()}>Condición de colapso</span>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>Umbral SLA vencido (%)</span>
                    <input
                      type="number"
                      min={10}
                      max={90}
                      step={5}
                      value={umbralColapso}
                      disabled={loading}
                      onChange={(event) => {
                        const v = Number(event.target.value)
                        if (Number.isFinite(v) && v >= 10 && v <= 90) setUmbralColapso(v)
                      }}
                      style={{ width: 64, textAlign: 'right', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13, padding: '6px 8px', appearance: 'textfield', MozAppearance: 'textfield', WebkitAppearance: 'none' }}
                    />
                  </div>
                  <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 10, opacity: 0.6 }}>
                    La sim detecta colapso cuando ≥{umbralColapso}% de envíos superan su SLA
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 20 }}>
                <span style={sectionHeaderStyle()}>Rangos de semáforo</span>
                {[
                  { key: 'verde', color: 'var(--green)', label: 'Verde', description: 'Ocupación normal' },
                  { key: 'ambar', color: 'var(--amber)', label: 'Ámbar', description: 'Ocupación elevada' },
                ].map((item) => (
                  <div key={item.key} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color }} />
                    <div>
                      <div style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12 }}>{item.label}</div>
                      <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>{item.description}</div>
                    </div>
                    <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>{'<'}</span>
                    <input
                      type="number"
                      value={semaforo[item.key]}
                      disabled={loading}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        setSemaforo((prev) => ({ ...prev, [item.key]: Number.isFinite(value) ? value : prev[item.key] }))
                      }}
                      style={{ width: 56, textAlign: 'right', background: 'rgba(255,255,255,0.04)', border: `1px solid ${semaforoError && item.key === 'ambar' ? 'var(--red)' : 'var(--border)'}`, color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '4px 6px', appearance: 'textfield', MozAppearance: 'textfield', WebkitAppearance: 'none' }}
                    />
                  </div>
                ))}
                {semaforoError && (
                  <div style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11, marginTop: 4 }}>{semaforoError}</div>
                )}
              </div>

              <div style={{ marginBottom: 20 }}>
                <span style={sectionHeaderStyle()}>Cancelaciones Aleatorias</span>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setCancelacionesAleatorias((v) => !v)}
                  style={rowStyle(cancelacionesAleatorias)}
                >
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)' }}>
                    {cancelacionesAleatorias ? 'Habilitadas' : 'Deshabilitadas'}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                    {cancelacionesAleatorias ? 'ON' : 'OFF'}
                  </span>
                </button>
                {cancelacionesAleatorias && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>
                      % por día
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={porcentajeCancelacion}
                      disabled={loading}
                      onChange={(e) => setPorcentajeCancelacion(e.target.value)}
                      style={{
                        width: 70,
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                        fontFamily: 'var(--mono)',
                        fontSize: 13,
                        padding: '6px 8px',
                        borderRadius: 2,
                        outline: 'none',
                      }}
                    />
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 20 }}>
                <span style={sectionHeaderStyle()}>Resumen de configuración</span>
                {[
                  ['Periodo', periodo === 'colapso' ? `Colapso desde ${fechaInicio}` : `${periodo} días desde ${fechaInicio}`],
                  ['Escala mínima', `${escalaMinima} min`],
                  ['Tiempo recogida', `${tiempoRecogida} min`],
                  ['Semáforo verde', `< ${semaforo.verde}%`],
                  ['Semáforo ámbar', `< ${semaforo.ambar}%`],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>{label}</span>
                    <span style={{ color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: 13 }}>{value}</span>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 'auto', position: 'sticky', bottom: 0, background: 'var(--bg)', borderTop: '1px solid var(--border)', padding: '14px 20px', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  {error ? (
                    <div style={{ borderLeft: '2px solid var(--red)', background: 'rgba(248,81,73,0.06)', padding: '8px 12px', color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                      {error}
                    </div>
                  ) : null}
                </div>
                <button
                  onClick={onCancel}
                  disabled={loading}
                  style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, padding: '8px 16px', cursor: loading ? 'not-allowed' : 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSimular}
                  disabled={Boolean(semaforoError) || loading}
                  style={{
                    background: 'rgba(88,166,255,0.12)',
                    border: '1px solid rgba(88,166,255,0.4)',
                    color: 'var(--blue)',
                    fontFamily: 'var(--mono)',
                    fontSize: 13,
                    textTransform: 'uppercase',
                    letterSpacing: 1,
                    fontWeight: 700,
                    padding: '8px 20px',
                    cursor: Boolean(semaforoError) || loading ? 'not-allowed' : 'pointer',
                    opacity: Boolean(semaforoError) || loading ? 0.35 : 1,
                  }}
                >
                  {loading ? 'PROCESANDO...' : '▶ SIMULAR'}
                </button>
              </div>
            </section>
          </div>
        ) : (
          /* OPS LAYOUT */
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '420px 1fr', background: 'var(--bg)', overflow: 'hidden', minHeight: 0 }}>

            {/* LEFT: ops file upload */}
            <aside style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '24px 20px' }}>
              <span style={sectionHeaderStyle()}>Archivos de envíos</span>
              <input ref={opsFileInputRef} type="file" accept=".txt" multiple onChange={handleOpsFileChange}
                disabled={opsUploadLoading} style={{ display: 'none' }} id="ops-upload-config-input" />
              <label htmlFor="ops-upload-config-input" style={{ display: 'block', width: '100%', padding: '8px 12px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, cursor: opsUploadLoading ? 'not-allowed' : 'pointer', textAlign: 'center', boxSizing: 'border-box' }}>
                Seleccionar archivos (.txt)
              </label>
              {opsUploadFileError && (
                <div style={{ marginTop: 6, color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11 }}>{opsUploadFileError}</div>
              )}
              {opsUploadFile.length > 0 && !opsUploadFileError && (
                <div style={{ marginTop: 8 }}>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 180, overflowY: 'auto' }}>
                    {opsUploadFile.map((item, idx) => {
                      const statusColor = item.status === 'done' ? 'var(--green)' : item.status === 'error' ? 'var(--red)' : item.status === 'in_progress' ? 'var(--blue)' : 'var(--muted)'
                      return (
                        <li key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', border: '1px solid var(--border)', marginBottom: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{item.file.name}</span>
                          {item.status === 'in_progress' && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--blue)', flexShrink: 0 }}>En curso</span>}
                          {item.status === 'done' && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--green)', flexShrink: 0 }}>Listo</span>}
                          {item.status === 'error' && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--red)', flexShrink: 0 }}>Error</span>}
                          {item.status === 'pending' && (
                            <button onClick={() => setOpsUploadFile(prev => prev.filter((_, i) => i !== idx))}
                              style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>×</button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  <button onClick={handleOpsUpload} disabled={opsUploadLoading}
                    style={{ width: '100%', marginTop: 8, padding: '7px 12px', background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.3)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, cursor: opsUploadLoading ? 'not-allowed' : 'pointer' }}>
                    {opsUploadLoading ? 'Subiendo...' : 'Subir'}
                  </button>
                </div>
              )}
              {opsUploadError && (
                <div style={{ marginTop: 6, color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11 }}>{opsUploadError}</div>
              )}
              <div style={{ marginTop: 8, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 10, opacity: 0.6 }}>Formato: _envios_XXXX_.txt</div>
            </aside>

            {/* RIGHT: flex-column — top=form, bottom=preview */}
            <section style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>

              {/* Top ~45%: manual form */}
              <div style={{ flex: '0 0 45%', overflowY: 'auto', padding: '24px 20px', borderBottom: '1px solid var(--border)' }}>
                <span style={sectionHeaderStyle()}>Ingreso manual de envío</span>
                <form onSubmit={handleOpsAddManual} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Aeropuerto origen</div>
                    <select value={opsOrigen} onChange={e => setOpsOrigen(e.target.value)}
                      style={{ width: '100%', background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '6px 8px', boxSizing: 'border-box', colorScheme: 'dark' }}>
                      <option value="" style={{ background: '#161b22', color: 'var(--text)' }}>Seleccionar origen</option>
                      {opsAirports.map(a => <option key={a.id} value={a.id} style={{ background: '#161b22', color: 'var(--text)' }}>{a.id} — {a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Aeropuerto destino</div>
                    <select value={opsDestino} onChange={e => setOpsDestino(e.target.value)}
                      style={{ width: '100%', background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '6px 8px', boxSizing: 'border-box', colorScheme: 'dark' }}>
                      <option value="" style={{ background: '#161b22', color: 'var(--text)' }}>Seleccionar destino</option>
                      {opsAirports.filter(a => a.id !== opsOrigen).map(a => <option key={a.id} value={a.id} style={{ background: '#161b22', color: 'var(--text)' }}>{a.id} — {a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Cantidad de maletas</div>
                    <input type="number" min={1} max={999} value={opsCantidad} onChange={e => setOpsCantidad(e.target.value)}
                      style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '6px 8px', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                      {opsOrigen && opsAirports.find(a => a.id === opsOrigen)
                        ? (() => { const off = opsAirports.find(a => a.id === opsOrigen).huso; return `Hora de ingreso (local origen · UTC${off >= 0 ? '+' : ''}${off})` })()
                        : 'Hora de ingreso (local origen)'}
                    </div>
                    <input type="time" value={opsHora} onChange={e => setOpsHora(e.target.value)}
                      style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '6px 8px', boxSizing: 'border-box' }} />
                  </div>
                  {opsFormError && <div style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11 }}>{opsFormError}</div>}
                  <button type="submit"
                    style={{ padding: '7px 12px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', color: '#22c55e', fontFamily: 'var(--mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, cursor: 'pointer' }}>
                    + Agregar envío
                  </button>
                </form>
              </div>

              {/* Bottom ~55%: preview table + footer */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '12px 20px 8px', flexShrink: 0 }}>
                  <span style={sectionHeaderStyle()}>Por confirmar ({pendingEnvios.length})</span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 8px' }}>
                  {pendingEnvios.length === 0 ? (
                    <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                      Ningún envío. Sube un archivo o ingresa manualmente.
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 11 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['ID Pedido', 'Origen', 'Destino', 'Maletas', 'Hora', ''].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 400, fontSize: 10 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pendingEnvios.map((e) => {
                          const horaDisplay = e.fechaHoraIngreso ? e.fechaHoraIngreso.slice(11, 16) : '—'
                          return (
                            <tr key={e._localId} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <td style={{ padding: '5px 8px', color: 'var(--muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatIdPedido(e.idPedido)}</td>
                              <td style={{ padding: '5px 8px', color: 'var(--text)' }}>{e.iataOrigen}</td>
                              <td style={{ padding: '5px 8px', color: 'var(--text)' }}>{e.iataDestino}</td>
                              <td style={{ padding: '5px 8px', color: 'var(--text)' }}>{e.cantidadMaletas}</td>
                              <td style={{ padding: '5px 8px', color: 'var(--text)' }}>{horaDisplay}</td>
                              <td style={{ padding: '5px 8px' }}>
                                <button onClick={() => setPendingEnvios(prev => prev.filter(x => x._localId !== e._localId))}
                                  title="Eliminar"
                                  style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}>×</button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 12, flexShrink: 0, background: 'var(--bg)' }}>
                  {opsUploadError && (
                    <div style={{ flex: 1, borderLeft: '2px solid var(--red)', background: 'rgba(248,81,73,0.06)', padding: '8px 12px', color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11, marginRight: 12 }}>
                      {opsUploadError}
                    </div>
                  )}
                  <button onClick={onCancel} disabled={opsIniciarLoading}
                    style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, padding: '8px 16px', cursor: opsIniciarLoading ? 'not-allowed' : 'pointer' }}>
                    Cancelar
                  </button>
                  <button onClick={handleOpsIniciar} disabled={opsIniciarLoading}
                    style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.4)', color: '#22c55e', fontFamily: 'var(--mono)', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, padding: '8px 20px', cursor: opsIniciarLoading ? 'not-allowed' : 'pointer', opacity: opsIniciarLoading ? 0.6 : 1 }}>
                    {opsIniciarLoading ? 'INICIANDO...' : '▶ INICIAR OPERACIONES'}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  )
}
