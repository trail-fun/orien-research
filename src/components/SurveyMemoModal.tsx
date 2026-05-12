import { useState, useRef } from 'react'
import type {
  SurveyMemo, SurveyMemoObjectType, MemoCategory,
  PointStyle, LineStyle, AreaStyle,
} from '../types'
import { defaultStyle, generateId } from '../lib/geojson'
import { MapPositionPicker } from './MapPositionPicker'

const POINT_CATS: MemoCategory[] = ['岩', '崖', '通行止め', '水場', 'その他']
const LINE_CATS: MemoCategory[]  = ['トレイル', 'フェンス', '崖（線状）', 'その他']
const AREA_CATS: MemoCategory[]  = ['立入禁止区域', '藪', 'その他']
function catsFor(t: SurveyMemoObjectType): MemoCategory[] {
  return t === 'point' ? POINT_CATS : t === 'line' ? LINE_CATS : AREA_CATS
}
const TYPE_LABEL: Record<SurveyMemoObjectType, string> = { point: 'ポイント', line: 'ライン', area: 'エリア' }

interface Props {
  memo: SurveyMemo | null            // null = new
  objectType?: SurveyMemoObjectType  // for new
  selectedPointIndex?: number        // pre-select a vertex (line/area edit)
  projectBbox?: [number, number, number, number]
  mapCenter: [number, number]
  mapZoom: number
  existingIds: string[]
  onSave: (memo: SurveyMemo) => void
  onCancel: () => void
  onDelete?: (id: string) => void
}

export function SurveyMemoModal({
  memo, objectType, selectedPointIndex,
  mapCenter, mapZoom, existingIds,
  onSave, onCancel, onDelete,
}: Props) {
  const objType: SurveyMemoObjectType = memo?.object_type ?? objectType ?? 'point'
  const isNew = !memo

  // ---- form state ----
  const [category, setCategory] = useState<MemoCategory>(memo?.category ?? catsFor(objType)[0])
  const [text, setText] = useState(memo?.memo ?? '')
  const [photos, setPhotos] = useState<string[]>(memo?.photos ?? [])

  // coords: point → single [lng,lat] or null; line/area → array
  const [coords, setCoords] = useState<[number, number][]>(() => {
    if (!memo) return []
    if (memo.object_type === 'point') return [memo.coordinates as [number, number]]
    return memo.coordinates as [number, number][]
  })
  const [selIdx, setSelIdx] = useState(selectedPointIndex ?? 0)

  // style
  const rawStyle = memo?.style ?? defaultStyle(objType)
  const [color, setColor]   = useState((rawStyle as { color: string }).color)
  const [opacity, setOpacity] = useState(rawStyle.opacity)
  const [size, setSize]     = useState((rawStyle as Partial<PointStyle>).size ?? 10)
  const [width, setWidth]   = useState((rawStyle as Partial<LineStyle>).width ?? 3)

  const [pickerOpen, setPickerOpen] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // ---- helpers ----
  const handlePhotoAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files ?? [])) {
      const reader = new FileReader()
      reader.onload = ev => {
        if (ev.target?.result) setPhotos(prev => [...prev, ev.target!.result as string])
      }
      reader.readAsDataURL(file)
    }
    e.target.value = ''
  }

  const handlePickerConfirm = (newCoords: [number, number][]) => {
    if (objType === 'point') {
      setCoords(newCoords.slice(0, 1))
    } else {
      setCoords(newCoords)
    }
    setPickerOpen(false)
  }

  const handleDeleteVertex = () => {
    if (coords.length <= 1) return
    setCoords(prev => prev.filter((_, i) => i !== selIdx))
    setSelIdx(prev => Math.max(0, prev - 1))
  }

  const buildStyle = (): PointStyle | LineStyle | AreaStyle => {
    if (objType === 'point') return { size, color, opacity }
    if (objType === 'line')  return { width, color, opacity }
    return { color, opacity }
  }

  const handleSave = () => {
    if (objType === 'point' && coords.length === 0) {
      alert('位置を指定してください')
      return
    }
    if (objType === 'line' && coords.length < 2) {
      alert('2点以上のポイントが必要です')
      return
    }
    if (objType === 'area' && coords.length < 3) {
      alert('3点以上のポイントが必要です')
      return
    }
    const id = memo?.id ?? generateId('sm_', existingIds)
    const finalCoords = objType === 'point' ? coords[0] : coords
    onSave({
      id, type: 'survey_memo', object_type: objType,
      category, memo: text, photos,
      coordinates: finalCoords,
      style: buildStyle(),
    })
  }

  // picker initial coords
  const pickerInitialCoords = objType === 'point'
    ? (coords.length > 0 ? coords : [])
    : coords

  const inp: React.CSSProperties = {
    width: '100%', padding: '8px 10px', border: '1px solid #ccc',
    borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
  }

  const coordLabel = (): string => {
    if (objType === 'point') {
      if (coords.length === 0) return '未設定'
      return `${coords[0][1].toFixed(6)}, ${coords[0][0].toFixed(6)}`
    }
    if (coords.length === 0) return '未設定'
    const c = coords[selIdx] ?? coords[0]
    return `${c[1].toFixed(6)}, ${c[0].toFixed(6)}`
  }

  return (
    <>
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-end', zIndex: 1000,
      }}>
        <div style={{
          background: 'white', width: '100%', maxHeight: '88vh',
          borderRadius: '16px 16px 0 0', overflow: 'auto', padding: 20,
        }}>
          {/* title */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>
              {TYPE_LABEL[objType]}の{isNew ? '追加' : '編集'}
            </h2>
            <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#888' }}>✕</button>
          </div>

          {/* category chips */}
          <div style={{ marginBottom: 12 }}>
            <div style={label}>カテゴリ</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {catsFor(objType).map(c => (
                <button key={c} onClick={() => setCategory(c)} style={{
                  padding: '5px 12px', borderRadius: 16, fontSize: 13, cursor: 'pointer',
                  background: category === c ? '#2d6a4f' : '#f0faf4',
                  color: category === c ? 'white' : '#2d6a4f',
                  border: `1px solid ${category === c ? '#2d6a4f' : '#c3e8d0'}`,
                  fontWeight: category === c ? 700 : 400,
                }}>{c}</button>
              ))}
            </div>
          </div>

          {/* memo */}
          <div style={{ marginBottom: 12 }}>
            <div style={label}>メモ</div>
            <textarea value={text} onChange={e => setText(e.target.value)}
              style={{ ...inp, minHeight: 70, resize: 'vertical' }} placeholder="メモを入力..." />
          </div>

          {/* photos */}
          <div style={{ marginBottom: 12 }}>
            <div style={label}>写真</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              {photos.map((p, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={p} alt="" style={{ width: 68, height: 68, objectFit: 'cover', borderRadius: 6 }} />
                  <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))} style={{
                    position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.5)', color: 'white',
                    border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 10, padding: 0,
                  }}>✕</button>
                </div>
              ))}
            </div>
            <button onClick={() => photoInputRef.current?.click()} style={smallBtn}>📷 写真を追加</button>
            <input ref={photoInputRef} type="file" accept="image/*" multiple capture="environment"
              onChange={handlePhotoAdd} style={{ display: 'none' }} />
          </div>

          {/* coordinates */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={label}>緯度経度</div>
              {(objType === 'line' || objType === 'area') && coords.length > 0 && (
                <select value={selIdx} onChange={e => setSelIdx(Number(e.target.value))}
                  style={{ fontSize: 12, padding: '2px 4px', borderRadius: 4, border: '1px solid #ccc' }}>
                  {coords.map((_, i) => (
                    <option key={i} value={i}>点{i + 1}</option>
                  ))}
                </select>
              )}
              {(objType === 'line' || objType === 'area') && coords.length > 0 && !isNew && (
                <button onClick={handleDeleteVertex} style={{ ...smallBtn, color: '#c0392b', borderColor: '#f5a5a5' }}>
                  ポイント削除
                </button>
              )}
            </div>
            <div style={{
              padding: '8px 10px', background: '#f5f5f5', borderRadius: 6,
              fontSize: 13, color: coords.length === 0 ? '#aaa' : '#333',
              marginBottom: 8,
            }}>
              {coordLabel()}
              {(objType === 'line' || objType === 'area') && coords.length > 0 &&
                <span style={{ color: '#888', marginLeft: 8 }}>{coords.length}点</span>}
            </div>
            <button onClick={() => setPickerOpen(true)} style={{
              width: '100%', padding: '9px', background: '#f0faf4',
              border: '1px solid #2d6a4f', borderRadius: 6, cursor: 'pointer',
              fontSize: 13, color: '#2d6a4f', fontWeight: 600,
            }}>
              🗺️ 地図上で位置を調整
            </button>
          </div>

          {/* style */}
          <div style={{ marginBottom: 16 }}>
            <div style={label}>スタイル</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                色 <input type="color" value={color} onChange={e => setColor(e.target.value)}
                  style={{ width: 36, height: 28, border: 'none', cursor: 'pointer' }} />
              </label>
              {objType === 'point' && (
                <label style={{ fontSize: 13 }}>大きさ {size}px
                  <input type="range" min={6} max={24} value={size} onChange={e => setSize(Number(e.target.value))}
                    style={{ marginLeft: 6, width: 80 }} />
                </label>
              )}
              {objType === 'line' && (
                <label style={{ fontSize: 13 }}>太さ {width}px
                  <input type="range" min={1} max={10} value={width} onChange={e => setWidth(Number(e.target.value))}
                    style={{ marginLeft: 6, width: 80 }} />
                </label>
              )}
              <label style={{ fontSize: 13 }}>透明度 {Math.round((1 - opacity) * 100)}%
                <input type="range" min={0} max={1} step={0.05} value={opacity}
                  onChange={e => setOpacity(Number(e.target.value))}
                  style={{ marginLeft: 6, width: 80 }} />
              </label>
            </div>
          </div>

          {/* buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            {onDelete && memo && (
              <button onClick={() => onDelete(memo.id)} style={{
                flex: 1, padding: 10, background: '#fff0f0', color: '#c0392b',
                border: '1px solid #f5a5a5', borderRadius: 8, cursor: 'pointer', fontSize: 14,
              }}>削除</button>
            )}
            <button onClick={handleSave} style={{
              flex: 2, padding: 10, background: '#2d6a4f', color: 'white',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 700,
            }}>保存</button>
          </div>
        </div>
      </div>

      {pickerOpen && (
        <MapPositionPicker
          mode={objType}
          initialCoords={pickerInitialCoords}
          initialCenter={
            coords.length > 0
              ? (objType === 'point' ? coords[0] : coords[coords.length - 1])
              : mapCenter
          }
          initialZoom={mapZoom}
          onConfirm={handlePickerConfirm}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </>
  )
}

const label: React.CSSProperties = { fontSize: 12, color: '#666', marginBottom: 4, display: 'block' }
const smallBtn: React.CSSProperties = {
  padding: '5px 12px', background: '#f5f5f5', border: '1px solid #ccc',
  borderRadius: 6, cursor: 'pointer', fontSize: 12,
}
