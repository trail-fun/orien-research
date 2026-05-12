import type { CpCandidate } from '../types'

const USAGE_LABELS: Record<string, string> = { cp: 'CP', start: 'スタート', goal: 'ゴール', both: 'CP（兼用）' }

interface Props {
  candidate: CpCandidate
  onClose: () => void
  onPlaceCp?: () => void
}

export function CPCandidateInfoModal({ candidate, onClose, onPlaceCp }: Props) {
  const isStart = candidate.usage === 'start'
  const isGoal  = candidate.usage === 'goal'
  const label   = isStart ? 'S' : isGoal ? 'F' : String(candidate.number)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'flex-end', zIndex: 900,
    }}>
      <div style={{
        background: 'white', width: '100%', borderRadius: '16px 16px 0 0', padding: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          {/* orienteering circle symbol */}
          <svg width="36" height="36" viewBox="0 0 36 36">
            {isStart ? (
              <polygon points="18,4 32,30 4,30" fill="none" stroke="#888" strokeWidth="2.5" />
            ) : isGoal ? (<>
              <circle cx="18" cy="18" r="14" fill="none" stroke="#888" strokeWidth="2.5" />
              <circle cx="18" cy="18" r="8"  fill="none" stroke="#888" strokeWidth="2" />
            </>) : (<>
              <circle cx="18" cy="18" r="14" fill="none" stroke="#888" strokeWidth="2.5" />
              <circle cx="18" cy="18" r="2"  fill="#888" />
            </>)}
          </svg>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {isStart ? 'スタート' : isGoal ? 'フィニッシュ' : `CP ${label}`}
            </div>
            <div style={{ fontSize: 13, color: '#888' }}>{USAGE_LABELS[candidate.usage]} / {candidate.score}点</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#888' }}>✕</button>
        </div>

        <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 13 }}>
          <div style={{ color: '#888', marginBottom: 4, fontSize: 11 }}>座標</div>
          <div>{candidate.coordinates[1].toFixed(6)}, {candidate.coordinates[0].toFixed(6)}</div>
        </div>

        {candidate.memo && (
          <div style={{ background: '#f0faf4', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 13 }}>
            <div style={{ color: '#2d6a4f', marginBottom: 4, fontSize: 11 }}>事前メモ</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{candidate.memo}</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={secondaryBtn}>閉じる</button>
          {onPlaceCp && (
            <button onClick={onPlaceCp} style={primaryBtn}>この位置にCPを設置</button>
          )}
        </div>
      </div>
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  flex: 2, padding: '10px', background: '#e74c3c', color: 'white',
  border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700,
}
const secondaryBtn: React.CSSProperties = {
  flex: 1, padding: '10px', background: '#f5f5f5', color: '#444',
  border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer', fontSize: 14,
}
