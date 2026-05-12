import { useState } from 'react'
import type { Cp } from '../types'
import { sortByOrder, haversine, formatDistance } from '../lib/geojson'

interface Props {
  cps: Cp[]
  onSave: (cps: Cp[]) => void
  onEdit: (cp: Cp) => void
  onClose: () => void
}

function calcTotalDistance(list: Cp[]): number {
  let total = 0
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1]; const b = list[i]
    total += haversine(a.coordinates[0], a.coordinates[1], b.coordinates[0], b.coordinates[1])
  }
  return total
}

export function CPListModal({ cps, onSave, onEdit, onClose }: Props) {
  const [list, setList] = useState<Cp[]>(() => sortByOrder(cps))

  const moveUp = (i: number) => {
    if (i === 0) return
    setList(prev => {
      const next = [...prev]
      ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
      return next
    })
  }

  const moveDown = (i: number) => {
    setList(prev => {
      if (i >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
      return next
    })
  }

  const remove = (i: number) => {
    setList(prev => prev.filter((_, j) => j !== i))
  }

  const handleSave = () => {
    const updated = list.map((cp, i) => ({ ...cp, order: i + 1 }))
    onSave(updated)
  }

  const totalDist = calcTotalDistance(list)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'flex-end', zIndex: 1000,
    }}>
      <div style={{
        background: 'white', width: '100%', maxHeight: '80vh',
        borderRadius: '16px 16px 0 0', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 16px', borderBottom: '1px solid #eee', flexShrink: 0,
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>CP一覧 <span style={{ fontSize: 13, fontWeight: 400, color: '#888' }}>{list.length}件</span></h2>
            <div style={{ fontSize: 12, color: '#2d6a4f', marginTop: 2 }}>
              合計距離: {list.length >= 2 ? formatDistance(totalDist) : '---'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#888' }}>✕</button>
        </div>

        {/* List */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {list.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: '#aaa', fontSize: 14 }}>
              設置されたCPはありません
            </div>
          )}
          {list.map((cp, i) => {
            const isStart = cp.usage === 'start'
            const isGoal  = cp.usage === 'goal'
            const legDist = i > 0
              ? haversine(list[i - 1].coordinates[0], list[i - 1].coordinates[1], cp.coordinates[0], cp.coordinates[1])
              : null
            return (
              <div key={cp.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 12px', borderBottom: '1px solid #f0f0f0',
              }}>
                {/* Orienteering symbol */}
                <svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
                  {isStart ? (
                    <polygon points="14,3 25,23 3,23" fill="none" stroke="#c0392b" strokeWidth="2" />
                  ) : isGoal ? (<>
                    <circle cx="14" cy="14" r="11" fill="none" stroke="#c0392b" strokeWidth="2" />
                    <circle cx="14" cy="14" r="6"  fill="none" stroke="#c0392b" strokeWidth="1.5" />
                  </>) : (<>
                    <circle cx="14" cy="14" r="11" fill="none" stroke="#c0392b" strokeWidth="2" />
                    <circle cx="14" cy="14" r="2"  fill="#c0392b" />
                  </>)}
                </svg>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>
                    {isStart ? 'スタート' : isGoal ? 'フィニッシュ' : `CP ${cp.number}`}
                    <span style={{ fontSize: 12, color: '#888', fontWeight: 400, marginLeft: 6 }}>
                      {cp.score}点
                    </span>
                    {legDist !== null && (
                      <span style={{ fontSize: 11, color: '#2d6a4f', fontWeight: 400, marginLeft: 6 }}>
                        ↑{formatDistance(legDist)}
                      </span>
                    )}
                  </div>
                  {cp.description ? (
                    <div style={{ fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cp.description}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cp.coordinates[1].toFixed(5)}, {cp.coordinates[0].toFixed(5)}
                    </div>
                  )}
                </div>

                {/* Reorder buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                  <button onClick={() => moveUp(i)} disabled={i === 0}
                    style={arrowBtn(i === 0)}>▲</button>
                  <button onClick={() => moveDown(i)} disabled={i === list.length - 1}
                    style={arrowBtn(i === list.length - 1)}>▼</button>
                </div>

                {/* Edit */}
                <button onClick={() => onEdit(cp)} style={{
                  padding: '6px 10px', background: '#f0faf4', color: '#2d6a4f',
                  border: '1px solid #c3e8d0', borderRadius: 6, cursor: 'pointer',
                  fontSize: 13, flexShrink: 0,
                }}>編集</button>

                {/* Delete */}
                <button onClick={() => remove(i)} style={{
                  padding: '6px 10px', background: '#fff0f0', color: '#c0392b',
                  border: '1px solid #f5a5a5', borderRadius: 6, cursor: 'pointer',
                  fontSize: 13, flexShrink: 0,
                }}>削除</button>
              </div>
            )
          })}
        </div>

        {/* Save */}
        <div style={{ padding: 12, borderTop: '1px solid #eee', flexShrink: 0 }}>
          <button onClick={handleSave} style={{
            width: '100%', padding: 12, background: '#2d6a4f', color: 'white',
            border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 700,
          }}>保存</button>
        </div>
      </div>
    </div>
  )
}

const arrowBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '4px 8px', background: disabled ? '#f5f5f5' : '#eee',
  border: '1px solid #ddd', borderRadius: 4,
  cursor: disabled ? 'default' : 'pointer',
  fontSize: 10, color: disabled ? '#ccc' : '#555', lineHeight: 1,
})
