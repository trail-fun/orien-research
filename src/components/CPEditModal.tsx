import { useState, useRef } from 'react'
import type { Cp, CpCandidate } from '../types'

interface Props {
  cp: Cp | null
  candidate?: CpCandidate
  onSave: (cp: Cp) => void
  onCancel: () => void
  onDelete?: (id: string) => void
  onPositionSelect: (cp: Cp) => void
}

const USAGE_LABELS: Record<string, string> = {
  cp: 'CP', start: 'スタート', goal: 'ゴール', both: '兼用'
}

export function CPEditModal({ cp, candidate, onSave, onCancel, onDelete, onPositionSelect }: Props) {
  const [form, setForm] = useState<Cp>(cp ?? {
    id: '',
    type: 'cp',
    number: candidate?.number ?? 1,
    usage: candidate?.usage ?? 'cp',
    order: candidate?.order ?? 1,
    score: candidate?.score ?? 10,
    acquired_lat: 0,
    acquired_lng: 0,
    acquired_at: new Date().toISOString(),
    description: '',
    memo: '',
    photos: [],
    source_candidate_id: candidate?.id,
    coordinates: candidate?.coordinates ?? [0, 0],
  })
  const [photos, setPhotos] = useState<string[]>(cp?.photos ?? [])
  const photoInputRef = useRef<HTMLInputElement>(null)

  const handlePhotoAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        if (ev.target?.result) {
          setPhotos((prev) => [...prev, ev.target!.result as string])
        }
      }
      reader.readAsDataURL(file)
    }
    e.target.value = ''
  }

  const handleSave = () => {
    onSave({ ...form, photos })
  }

  const field = (label: string, children: React.ReactNode) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', border: '1px solid #ccc',
    borderRadius: 6, fontSize: 14, boxSizing: 'border-box'
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'flex-end', zIndex: 1000
    }}>
      <div style={{
        background: 'white', width: '100%', maxHeight: '85vh',
        borderRadius: '16px 16px 0 0', overflow: 'auto', padding: 20
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>
            {cp ? `CP編集 — CP${form.number}` : 'CP設置'}
          </h2>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* 取得情報（変更不可） */}
        <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px', marginBottom: 16, fontSize: 13 }}>
          <div style={{ color: '#888', marginBottom: 4 }}>取得情報（変更不可）</div>
          <div>取得緯度: {form.acquired_lat.toFixed(6)} / 取得経度: {form.acquired_lng.toFixed(6)}</div>
          <div>取得時刻: {new Date(form.acquired_at).toLocaleString('ja-JP')}</div>
        </div>

        {field('CP番号',
          <input type="number" value={form.number} style={inputStyle}
            onChange={e => setForm(f => ({ ...f, number: Number(e.target.value) }))} />
        )}

        {field('用途',
          <select value={form.usage} style={inputStyle}
            onChange={e => setForm(f => ({ ...f, usage: e.target.value as Cp['usage'] }))}>
            {Object.entries(USAGE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        )}

        {field('ポイント',
          <input type="number" value={form.score} style={inputStyle}
            onChange={e => setForm(f => ({ ...f, score: Number(e.target.value) }))} />
        )}

        {field('CP緯度経度',
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="number" step="0.000001" value={form.coordinates[1]} style={{ ...inputStyle, flex: 1 }}
              onChange={e => setForm(f => ({ ...f, coordinates: [f.coordinates[0], Number(e.target.value)] }))} />
            <input type="number" step="0.000001" value={form.coordinates[0]} style={{ ...inputStyle, flex: 1 }}
              onChange={e => setForm(f => ({ ...f, coordinates: [Number(e.target.value), f.coordinates[1]] }))} />
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => onPositionSelect(form)}
            style={{
              width: '100%', padding: '8px', background: '#f0faf4', border: '1px solid #2d6a4f',
              borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#2d6a4f'
            }}
          >
            🗺️ 地図上で位置を調整
          </button>
        </div>

        {field('設置箇所の説明（尾根・谷など）',
          <input type="text" value={form.description} style={inputStyle}
            placeholder="例: 尾根の北側"
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        )}

        {field('メモ（自分用）',
          <textarea value={form.memo} style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
            placeholder="メモを入力..."
            onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} />
        )}

        {field('写真',
          <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {photos.map((p, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={p} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6 }} />
                  <button
                    onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                    style={{
                      position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.5)',
                      color: 'white', border: 'none', borderRadius: '50%', width: 20, height: 20,
                      cursor: 'pointer', fontSize: 11, lineHeight: '20px', padding: 0
                    }}
                  >✕</button>
                </div>
              ))}
            </div>
            <button
              onClick={() => photoInputRef.current?.click()}
              style={{
                padding: '7px 14px', background: '#f5f5f5', border: '1px solid #ccc',
                borderRadius: 6, cursor: 'pointer', fontSize: 13
              }}
            >📷 写真を追加</button>
            <input ref={photoInputRef} type="file" accept="image/*" multiple capture="environment"
              onChange={handlePhotoAdd} style={{ display: 'none' }} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {onDelete && cp && (
            <button
              onClick={() => onDelete(cp.id)}
              style={{
                flex: 1, padding: '10px', background: '#fff0f0', color: '#c0392b',
                border: '1px solid #f5a5a5', borderRadius: 8, cursor: 'pointer', fontSize: 14
              }}
            >削除</button>
          )}
          <button
            onClick={handleSave}
            style={{
              flex: 2, padding: '10px', background: '#2d6a4f', color: 'white',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 700
            }}
          >保存</button>
        </div>
      </div>
    </div>
  )
}
