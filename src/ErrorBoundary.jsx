import React from 'react'

export default class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', gap: 16, background: '#0d1117', color: '#e6edf3',
          fontFamily: "'DM Mono', monospace",
        }}>
          <span style={{ fontSize: 32 }}>⚠</span>
          <div style={{ fontSize: 14, color: '#f04b4b', fontWeight: 700 }}>Error inesperado</div>
          <div style={{ fontSize: 11, color: '#6e7f9a', maxWidth: 480, textAlign: 'center' }}>
            {this.state.error?.message ?? 'Error desconocido'}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8, padding: '8px 20px', borderRadius: 6, cursor: 'pointer',
              background: 'rgba(61,139,255,0.12)', border: '1px solid rgba(61,139,255,0.4)',
              color: '#4d9fff', fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 1,
            }}
          >
            Recargar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
