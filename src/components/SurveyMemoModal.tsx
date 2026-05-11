import { useState, useRef } from 'react'
import type { SurveyMemo, SurveyMemoObjectType, MemoCategory, PointCategory, LineCategory, AreaCategory } from '../types'

interface Props {
  memo: SurveyMemo | null
  onSave: (memo: SurveyMemo) => void
  onCancel: () => void
  onDelete?: (id: string) => void
}

const POINT_CATEGORIES: PointCategory[] = ['岩', '崖', '通行止め', '水場', 'その他']
const LINE_CATEGORIES: LineCategory[] = ['トレイル', 'フェンス', '崖（線状）', 'その他']
const AREA_CATEGORIES: AreaCategory[] = ['立入禁止区域', '藪', 'その他']

function categoriesFor(type: SurveyMemoObjectType): MemoCategory[] {
  if (type === 'point') return POINT_CATEGORIES
  if (type === 'line') return LINE_CATEGORIES
  return AREA_CATEGORIES
}

const TYPE_LABELS: Record<SurveyMemoObjectType, string> = {
  point: 'ポイント', line: 'ライン', area: 'エリア'
}

export function SurveyMemoModal({ memo, onSave, onCancel, onDelete }: Props) {
  const [objType, setObjType] = useState<SurveyMemoObjectType>(memo?.object_type ?? 'point')
  const [category, setCategory] = useState<MemoCategory>(memo?.category ?? '岩')
  const [text, setText] = useState(memo?.memo ?? '')
  const [photos, setPhotos] = useState<string[]>(memo?.photos ?? [])
  const photoInputRef = useRef<HTMLInputElement>(null)

  const handlePhotoAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        if (ev.target?.result) setPhotos(prev => [...prev, ev.target!.result as string])
      }
      reader.readAsDataURL(file)
    }
    e.target.value = ''
  }

  const handleTypeChange = (t: SurveyMemoObjectType) => {
    setObjType(t)
    setCategory(categoriesFor(t)[0])
  }

  const handleSave = () => {
    if (!memo) return
    onSave({ ...memo, object_type: objType, category, memo: text, photos })
  }

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
        background: 'white', width: '100%', maxHeight: '80vh',
        borderRadius: '16px 16px 0 0', overflow: 'auto', padding: 20
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>調査メモ{memo?.id ? '編集' : ''}</h2>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#666', marginBottom: 4, display: 'block' }}>種別</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['point', 'line', 'area'] as SurveyMemoObjectType[]).map(t => (
              <button
                key={t}
                onClick={() => handleTypeChange(t)}
                style={{
                  flex: 1, padding: '8px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                  background: objType === t ? '#2d6a4f' : '#f5f5f5',
                  color: objType === t ? 'white' : '#444',
                  border: 'none', fontWeight: objType === t ? 700 : 400
                }}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#666', marginBottom: 4, display: 'block' }}>カテゴリ</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {categoriesFor(objType).map(c => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                style={{
                  padding: '6px 12px', borderRadius: 16, fontSize: 13, cursor: 'pointer',
                  background: category === c ? '#2d6a4f' : '#f0faf4',
                  color: category === c ? 'white' : '#2d6a4f',
                  border: `1px solid ${category === c ? '#2d6a4f' : '#c3e8d0'}`,
                  fontWeight: category === c ? 700 : 400
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#666', marginBottom: 4, display: 'block' }}>メモ</label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
            placeholder="メモを入力..."
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: '#666', marginBottom: 4, display: 'block' }}>写真</label>
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
            style={{ padding: '7px 14px', background: '#f5f5f5', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
          >📷 写真を追加</button>
          <input ref={photoInputRef} type="file" accept="image/*" multiple capture="environment"
            onChange={handlePhotoAdd} style={{ display: 'none' }} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {onDelete && memo?.id && (
            <button onClick={() => onDelete(memo.id)} style={{
              flex: 1, padding: 10, background: '#fff0f0', color: '#c0392b',
              border: '1px solid #f5a5a5', borderRadius: 8, cursor: 'pointer', fontSize: 14
            }}>削除</button>
          )}
          <button onClick={handleSave} style={{
            flex: 2, padding: 10, background: '#2d6a4f', color: 'white',
            border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 700
          }}>保存</button>
        </div>
      </div>
    </div>
  )
}
