import { useState } from 'react'

interface Props {
  onRetry: () => void
  onManualInput: (lat: number, lng: number) => void
  onMapSelect: () => void
  onCancel: () => void
}

export function GPSFallbackModal({ onRetry, onManualInput, onMapSelect, onCancel }: Props) {
  const [mode, setMode] = useState<'select' | 'input'>('select')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  const handleManualSubmit = () => {
    const latNum = parseFloat(lat)
    const lngNum = parseFloat(lng)
    if (isNaN(latNum) || isNaN(lngNum) || latNum < 20 || latNum > 50 || lngNum < 120 || lngNum > 155) {
      setInputError('緯度（20〜50）経度（120〜155）の範囲で入力してください')
      return
    }
    onManualInput(latNum, lngNum)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20
    }}>
      <div style={{
        background: 'white', borderRadius: 12, padding: 24, width: '100%', maxWidth: 340
      }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>GPS信号を取得できませんでした</h3>

        {mode === 'select' && (
          <>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#666' }}>
              以下の方法で位置を指定してください
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={onRetry} style={btnStyle('#2d6a4f', 'white')}>
                🔄 再試行
              </button>
              <button onClick={() => setMode('input')} style={btnStyle('#1a4731', 'white')}>
                ⌨️ 緯度経度を入力
              </button>
              <button onClick={onMapSelect} style={btnStyle('#f0faf4', '#2d6a4f', '1px solid #2d6a4f')}>
                🗺️ 地図上で指定
              </button>
              <button onClick={onCancel} style={btnStyle('#f5f5f5', '#666')}>
                キャンセル
              </button>
            </div>
          </>
        )}

        {mode === 'input' && (
          <>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#666' }}>
              緯度・経度を直接入力してください
            </p>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: '#888' }}>緯度（例: 35.6762）</label>
              <input
                type="number" step="0.000001" value={lat}
                onChange={e => { setLat(e.target.value); setInputError(null) }}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, marginTop: 4, boxSizing: 'border-box' }}
                placeholder="35.000000"
              />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: '#888' }}>経度（例: 139.6503）</label>
              <input
                type="number" step="0.000001" value={lng}
                onChange={e => { setLng(e.target.value); setInputError(null) }}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, marginTop: 4, boxSizing: 'border-box' }}
                placeholder="135.000000"
              />
            </div>
            {inputError && (
              <div style={{ color: '#c0392b', fontSize: 12, marginBottom: 10 }}>{inputError}</div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setMode('select')} style={{ ...btnStyle('#f5f5f5', '#666'), flex: 1 }}>戻る</button>
              <button onClick={handleManualSubmit} style={{ ...btnStyle('#2d6a4f', 'white'), flex: 2 }}>確定</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function btnStyle(bg: string, color: string, border?: string): React.CSSProperties {
  return {
    padding: '11px 16px', background: bg, color, border: border ?? 'none',
    borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600, width: '100%'
  }
}
