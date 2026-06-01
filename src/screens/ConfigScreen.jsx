import React, { useEffect, useRef, useState } from 'react'
import { api, startSimulation } from '../services/api.js'

const FILE_PATTERN = /_envios_[A-Za-z]{4}_\.txt$/i

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

export default function ConfigScreen({ onCancel, onSimulationStarted }) {
  const [periodo, setPeriodo] = useState('3')
  const algoritmo = 'SIMULATED_ANNEALING'
  const [fechaInicio, setFechaInicio] = useState('2026-06-01')
  const [horaInicio, setHoraInicio] = useState('00:00')
  const [escalaMinima, setEscalaMinima] = useState(10)
  const [tiempoRecogida, setTiempoRecogida] = useState(10)
  const [semaforo, setSemaforo] = useState({ verde: 60, ambar: 85 })
  const [umbralColapso, setUmbralColapso] = useState(50)
  const [loading, setLoading] = useState(false)
  const [loadingElapsed, setLoadingElapsed] = useState(0)
  const [error, setError] = useState(null)
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadFileError, setUploadFileError] = useState(null)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!loading) { setLoadingElapsed(0); return }
    setLoadingElapsed(0)
    const start = Date.now()
    const id = setInterval(() => setLoadingElapsed(Math.floor((Date.now() - start) / 100) / 10), 100)
    return () => clearInterval(id)
  }, [loading])

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
      setUploadFile(null)
      setUploadFileError(null)
      return
    }
    const invalid = files.find(f => !FILE_PATTERN.test(f.name))
    if (invalid) {
      setUploadFile(null)
      setUploadFileError(`Nombre inválido: ${invalid.name}. Debe ser: _envios_XXXX_.txt`)
      return
    }
    setUploadFile(files)
    setUploadFileError(null)
  }

  async function handleUpload() {
    if (!uploadFile || uploadFile.length === 0) return
    setUploadLoading(true)
    setUploadError(null)
    setUploadResult(null)
    let totalCount = 0
    const errors = []
    for (const file of uploadFile) {
      try {
        const result = await api.uploadEnvios(file)
        totalCount += result.count ?? 0
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    setUploadFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (errors.length > 0) {
      setUploadError(errors.join(' | '))
    }
    if (totalCount > 0 || errors.length === 0) {
      setUploadResult({ count: totalCount, files: uploadFile.length })
    }
    setUploadLoading(false)
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
      <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '420px 1fr', background: 'var(--bg)' }}>
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

            {uploadFile && !uploadFileError && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                  {uploadFile.length === 1 ? uploadFile[0].name : `${uploadFile.length} archivos seleccionados`}
                </div>
                <button
                  onClick={handleUpload}
                  disabled={uploadLoading || loading}
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
    </>
  )
}
