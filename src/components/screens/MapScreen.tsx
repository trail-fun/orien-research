import { useRef, useState, useEffect, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import type { ProjectData, Cp, CpCandidate, SurveyMemo, SurveyMemoObjectType, HistoryAction } from '../../types'
import { generateId } from '../../lib/geojson'
import { exportZip } from '../../lib/export'
import { CPEditModal } from '../CPEditModal'
import { GPSFallbackModal } from '../GPSFallbackModal'
import { SurveyMemoModal } from '../SurveyMemoModal'

interface Props {
  project: ProjectData
  onProjectChange: (p: ProjectData) => void
  onBackToPrepare: () => void
}

type DrawMode = 'none' | 'point' | 'line' | 'area'
type ModalState =
  | { type: 'none' }
  | { type: 'cp-edit'; cp: Cp; candidate?: CpCandidate }
  | { type: 'cp-new'; acquired: { lat: number; lng: number; at: string }; candidate?: CpCandidate }
  | { type: 'gps-fail'; afterFix: (lat: number, lng: number) => void }
  | { type: 'map-select'; afterFix: (lat: number, lng: number) => void }
  | { type: 'survey-new'; memo: SurveyMemo }
  | { type: 'survey-edit'; memo: SurveyMemo }
  | { type: 'position-select'; cp: Cp }

const GSI_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'
const MAX_UNDO = 50

export function MapScreen({ project, onProjectChange, onBackToPrepare }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const cursorMarker = useRef<maplibregl.Marker | null>(null)
  const userMarker = useRef<maplibregl.Marker | null>(null)

  const [displayOptions, setDisplayOptions] = useState({
    showCpCandidates: true,
    showCps: true,
    showPrintArea: true,
    showSurveyMemos: true,
    showCurrentLocation: false,
  })
  const [drawMode, setDrawMode] = useState<DrawMode>('none')
  const [drawingCoords, setDrawingCoords] = useState<[number, number][]>([])
  const [modal, setModal] = useState<ModalState>({ type: 'none' })
  const [showMenu, setShowMenu] = useState(false)
  const [history, setHistory] = useState<HistoryAction[]>([])
  const [, setRedoStack] = useState<HistoryAction[]>([])
  const projectRef = useRef(project)
  projectRef.current = project

  // ---- map init ----
  useEffect(() => {
    if (!mapContainer.current) return
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          gsi: { type: 'raster', tiles: [GSI_TILE_URL], tileSize: 256, attribution: '© 国土地理院' }
        },
        layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }],
      },
      center: project.metadata.print.bbox
        ? [(project.metadata.print.bbox[0] + project.metadata.print.bbox[2]) / 2,
           (project.metadata.print.bbox[1] + project.metadata.print.bbox[3]) / 2]
        : [136.0, 36.0],
      zoom: 14,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    map.on('load', () => {
      initLayers(map)
      updateLayers(map, project, displayOptions)
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- layer update when project changes ----
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    updateLayers(map, project, displayOptions)
  }, [project, displayOptions])

  // ---- map click ----
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const lngLat = e.lngLat
      if (drawMode === 'none') {
        // Check clicks on CP candidates / CPs (handled by layer click below)
        return
      }
      if (drawMode === 'point') {
        const coords: [number, number] = [lngLat.lng, lngLat.lat]
        const id = generateId('sm_', projectRef.current.surveyMemos.map(m => m.id))
        const newMemo: SurveyMemo = {
          id, type: 'survey_memo', object_type: 'point',
          category: '岩', memo: '', photos: [], coordinates: coords
        }
        setModal({ type: 'survey-new', memo: newMemo })
      } else if (drawMode === 'line' || drawMode === 'area') {
        setDrawingCoords(prev => [...prev, [lngLat.lng, lngLat.lat]])
      }
    }

    map.on('click', onClick)
    return () => { map.off('click', onClick) }
  }, [drawMode])

  // ---- CP candidate layer click ----
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const onCpcClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      e.preventDefault()
      const f = e.features?.[0]
      if (!f) return
      const cpcId = f.properties?.id as string
      const cpc = projectRef.current.cpCandidates.find(c => c.id === cpcId)
      if (!cpc) return

      const existing = projectRef.current.cps.find(cp => cp.source_candidate_id === cpcId)
      if (existing) {
        setModal({ type: 'cp-edit', cp: existing, candidate: cpc })
      } else {
        // Show candidate info with option to place CP
        setModal({
          type: 'gps-fail',
          afterFix: (lat, lng) => {
            const id = generateId('cp_', projectRef.current.cps.map(c => c.id))
            const now = new Date().toISOString()
            const newCp: Cp = {
              id, type: 'cp', number: cpc.number, usage: cpc.usage, order: cpc.order,
              score: cpc.score, acquired_lat: lat, acquired_lng: lng, acquired_at: now,
              description: '', memo: cpc.memo, photos: [], source_candidate_id: cpc.id,
              coordinates: [lng, lat]
            }
            setModal({ type: 'cp-new', acquired: { lat, lng, at: now }, candidate: cpc })
            // Pre-fill with GPS
            setModal({ type: 'cp-edit', cp: newCp, candidate: cpc })
          }
        })
      }
    }

    map.on('click', 'cp-candidates', onCpcClick)
    map.on('mouseenter', 'cp-candidates', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'cp-candidates', () => { map.getCanvas().style.cursor = '' })

    const onCpClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      e.preventDefault()
      const f = e.features?.[0]
      if (!f) return
      const cpId = f.properties?.id as string
      const cp = projectRef.current.cps.find(c => c.id === cpId)
      if (cp) setModal({ type: 'cp-edit', cp })
    }

    map.on('click', 'cps', onCpClick)
    map.on('mouseenter', 'cps', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'cps', () => { map.getCanvas().style.cursor = '' })

    const onMemoClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      e.preventDefault()
      const f = e.features?.[0]
      if (!f) return
      const memoId = f.properties?.id as string
      const memo = projectRef.current.surveyMemos.find(m => m.id === memoId)
      if (memo) setModal({ type: 'survey-edit', memo })
    }

    map.on('click', 'survey-points', onMemoClick)
    map.on('click', 'survey-lines', onMemoClick)
    map.on('click', 'survey-areas', onMemoClick)

    return () => {
      map.off('click', 'cp-candidates', onCpcClick)
      map.off('click', 'cps', onCpClick)
      map.off('click', 'survey-points', onMemoClick)
      map.off('click', 'survey-lines', onMemoClick)
      map.off('click', 'survey-areas', onMemoClick)
    }
  }, [])

  // ---- GPS location ----
  const getCurrentLocation = useCallback((onSuccess: (lat: number, lng: number) => void) => {
    navigator.geolocation.getCurrentPosition(
      pos => onSuccess(pos.coords.latitude, pos.coords.longitude),
      () => setModal({
        type: 'gps-fail',
        afterFix: onSuccess
      }),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  const handlePlaceCp = useCallback(() => {
    getCurrentLocation((lat, lng) => {
      const id = generateId('cp_', projectRef.current.cps.map(c => c.id))
      const now = new Date().toISOString()
      const newCp: Cp = {
        id, type: 'cp', number: projectRef.current.cps.length + 1, usage: 'cp', order: 0,
        score: 10, acquired_lat: lat, acquired_lng: lng, acquired_at: now,
        description: '', memo: '', photos: [], coordinates: [lng, lat]
      }
      setModal({ type: 'cp-edit', cp: newCp })
    })
  }, [getCurrentLocation])

  const handleCurrentLocation = useCallback(() => {
    getCurrentLocation((lat, lng) => {
      const map = mapRef.current
      if (!map) return
      map.flyTo({ center: [lng, lat], zoom: 16 })
      if (userMarker.current) {
        userMarker.current.setLngLat([lng, lat])
      } else {
        const el = document.createElement('div')
        el.style.cssText = 'width:16px;height:16px;background:#2563eb;border:3px solid white;border-radius:50%;box-shadow:0 0 0 2px #2563eb'
        userMarker.current = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
      }
    })
  }, [getCurrentLocation])

  // ---- Undo ----
  const pushHistory = useCallback((action: HistoryAction) => {
    setHistory(prev => [...prev.slice(-MAX_UNDO + 1), action])
    setRedoStack([])
  }, [])

  const handleUndo = useCallback(() => {
    setHistory(prev => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      const next = prev.slice(0, -1)
      setRedoStack(r => [last, ...r])
      applyUndo(last)
      return next
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const applyUndo = (action: HistoryAction) => {
    const p = projectRef.current
    switch (action.type) {
      case 'ADD_CP':
        onProjectChange({ ...p, cps: p.cps.filter(c => c.id !== action.cp.id) })
        break
      case 'UPDATE_CP':
        onProjectChange({ ...p, cps: p.cps.map(c => c.id === action.prev.id ? action.prev : c) })
        break
      case 'DELETE_CP':
        onProjectChange({ ...p, cps: [...p.cps, action.cp] })
        break
      case 'ADD_MEMO':
        onProjectChange({ ...p, surveyMemos: p.surveyMemos.filter(m => m.id !== action.memo.id) })
        break
      case 'UPDATE_MEMO':
        onProjectChange({ ...p, surveyMemos: p.surveyMemos.map(m => m.id === action.prev.id ? action.prev : m) })
        break
      case 'DELETE_MEMO':
        onProjectChange({ ...p, surveyMemos: [...p.surveyMemos, action.memo] })
        break
    }
  }

  // ---- keyboard undo ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); handleUndo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleUndo])

  // ---- CP save ----
  const handleCpSave = (cp: Cp) => {
    const p = projectRef.current
    const existing = p.cps.find(c => c.id === cp.id)
    if (existing) {
      pushHistory({ type: 'UPDATE_CP', prev: existing, next: cp })
      onProjectChange({ ...p, cps: p.cps.map(c => c.id === cp.id ? cp : c) })
    } else {
      pushHistory({ type: 'ADD_CP', cp })
      onProjectChange({ ...p, cps: [...p.cps, cp] })
    }
    setModal({ type: 'none' })
  }

  const handleCpDelete = (id: string) => {
    const p = projectRef.current
    const cp = p.cps.find(c => c.id === id)
    if (cp) {
      pushHistory({ type: 'DELETE_CP', cp })
      onProjectChange({ ...p, cps: p.cps.filter(c => c.id !== id) })
    }
    setModal({ type: 'none' })
  }

  // ---- survey memo save ----
  const handleMemoSave = (memo: SurveyMemo) => {
    const p = projectRef.current
    const existing = p.surveyMemos.find(m => m.id === memo.id)
    if (existing) {
      pushHistory({ type: 'UPDATE_MEMO', prev: existing, next: memo })
      onProjectChange({ ...p, surveyMemos: p.surveyMemos.map(m => m.id === memo.id ? memo : m) })
    } else {
      pushHistory({ type: 'ADD_MEMO', memo })
      onProjectChange({ ...p, surveyMemos: [...p.surveyMemos, memo] })
    }
    setModal({ type: 'none' })
  }

  const handleMemoDelete = (id: string) => {
    const p = projectRef.current
    const memo = p.surveyMemos.find(m => m.id === id)
    if (memo) {
      pushHistory({ type: 'DELETE_MEMO', memo })
      onProjectChange({ ...p, surveyMemos: p.surveyMemos.filter(m => m.id !== id) })
    }
    setModal({ type: 'none' })
  }

  // ---- finish line/area ----
  const finishDrawing = () => {
    if (drawingCoords.length < 2) { setDrawingCoords([]); return }
    const id = generateId('sm_', projectRef.current.surveyMemos.map(m => m.id))
    const objType: SurveyMemoObjectType = drawMode === 'line' ? 'line' : 'area'
    const newMemo: SurveyMemo = {
      id, type: 'survey_memo', object_type: objType,
      category: drawMode === 'line' ? 'トレイル' : '立入禁止区域',
      memo: '', photos: [], coordinates: drawingCoords
    }
    setModal({ type: 'survey-new', memo: newMemo })
    setDrawingCoords([])
  }

  // ---- position select mode ----
  const handlePositionSelect = (cp: Cp) => {
    setModal({ type: 'position-select', cp })
    const map = mapRef.current
    if (!map) return
    // Show crosshair cursor marker at current cp position
    if (cursorMarker.current) cursorMarker.current.remove()
    const el = document.createElement('div')
    el.innerHTML = '＋'
    el.style.cssText = 'font-size:32px;color:#e74c3c;text-shadow:0 0 3px white;pointer-events:none;line-height:1'
    cursorMarker.current = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(cp.coordinates)
      .addTo(map)
  }

  const confirmPositionSelect = () => {
    if (modal.type !== 'position-select') return
    const map = mapRef.current
    if (!map) return
    const center = map.getCenter()
    const updated: Cp = { ...modal.cp, coordinates: [center.lng, center.lat] }
    if (cursorMarker.current) { cursorMarker.current.remove(); cursorMarker.current = null }
    setModal({ type: 'cp-edit', cp: updated })
  }

  // ---- export ----
  const handleExport = async () => {
    const areaName = project.metadata.area_name.replace(/\s/g, '_')
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    await exportZip(project, `${areaName}_${date}_s2_v1.zip`)
  }

  const toggleOption = (key: keyof typeof displayOptions) => {
    setDisplayOptions(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const setMemoDrawMode = (mode: DrawMode) => {
    setDrawMode(prev => prev === mode ? 'none' : mode)
    setDrawingCoords([])
  }

  // Capture drawMode before JSX to avoid TypeScript narrowing in ternary branches
  const dm: DrawMode = drawMode

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', background: '#2d6a4f', color: 'white', zIndex: 10, flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={onBackToPrepare} style={{
            background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white',
            borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13
          }}>← 準備</button>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{project.metadata.area_name}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleUndo} disabled={history.length === 0} style={{
            background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white',
            borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13,
            opacity: history.length === 0 ? 0.4 : 1
          }}>↩ Undo</button>
          <button onClick={() => setShowMenu(!showMenu)} style={{
            background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white',
            borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13
          }}>☰</button>
        </div>
      </div>

      {/* Menu dropdown */}
      {showMenu && (
        <div style={{
          position: 'absolute', top: 50, right: 12, background: 'white', zIndex: 200,
          borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', padding: 12, minWidth: 200
        }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 8, fontWeight: 600 }}>表示オプション</div>
          {([
            ['showCpCandidates', 'CP候補を表示'],
            ['showCps', '設置CPを表示'],
            ['showPrintArea', '印刷範囲を表示'],
            ['showSurveyMemos', '調査メモを表示'],
            ['showCurrentLocation', '現在地を表示'],
          ] as [keyof typeof displayOptions, string][]).map(([key, label]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer', fontSize: 14 }}>
              <input type="checkbox" checked={displayOptions[key]} onChange={() => toggleOption(key)} />
              {label}
            </label>
          ))}
          <hr style={{ margin: '8px 0', border: 'none', borderTop: '1px solid #eee' }} />
          <button onClick={() => { handleExport(); setShowMenu(false) }} style={{
            width: '100%', padding: '8px', background: '#2d6a4f', color: 'white',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600
          }}>
            📦 ZIPでエクスポート
          </button>
        </div>
      )}

      {/* Map */}
      <div ref={mapContainer} style={{ flex: 1, position: 'relative' }}>
        {/* Position select overlay */}
        {modal.type === 'position-select' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', zIndex: 50
          }}>
            <div style={{ fontSize: 40, color: '#e74c3c', textShadow: '0 0 4px white', lineHeight: 1 }}>＋</div>
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-around',
        padding: '8px 12px', background: 'white', borderTop: '1px solid #ddd',
        flexShrink: 0, flexWrap: 'wrap', gap: 6
      }}>
        {modal.type === 'position-select' ? (
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <button onClick={() => { if (cursorMarker.current) { cursorMarker.current.remove(); cursorMarker.current = null }; setModal({ type: 'none' }) }}
              style={tbBtn('#f5f5f5', '#444')}>キャンセル</button>
            <button onClick={confirmPositionSelect} style={{ ...tbBtn('#2d6a4f', 'white'), flex: 2 }}>
              この位置に設置
            </button>
          </div>
        ) : drawMode !== 'none' ? (
          <div style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#666', flex: 1 }}>
              {drawMode === 'point' ? 'タップで配置' : drawMode === 'line' ? `${drawingCoords.length}点 — タップで追加` : `${drawingCoords.length}点 — タップで追加（最初の点で閉じる）`}
            </span>
            {(drawMode === 'line' || drawMode === 'area') && drawingCoords.length >= 2 && (
              <button onClick={finishDrawing} style={tbBtn('#2d6a4f', 'white')}>完了</button>
            )}
            <button onClick={() => { setDrawMode('none'); setDrawingCoords([]) }} style={tbBtn('#f5f5f5', '#444')}>
              キャンセル
            </button>
          </div>
        ) : (
          <>
            <button onClick={handlePlaceCp} style={tbBtn('#e74c3c', 'white')}>
              📍 CP設置
            </button>
            <button onClick={handleCurrentLocation} style={tbBtn('#2563eb', 'white')}>
              🎯 現在地
            </button>
            <button onClick={() => setMemoDrawMode('point')} style={tbBtn(dm === 'point' ? '#f59e0b' : '#f5f5f5', dm === 'point' ? 'white' : '#444')}>
              ● ポイント
            </button>
            <button onClick={() => setMemoDrawMode('line')} style={tbBtn(dm === 'line' ? '#f59e0b' : '#f5f5f5', dm === 'line' ? 'white' : '#444')}>
              ∿ ライン
            </button>
            <button onClick={() => setMemoDrawMode('area')} style={tbBtn(dm === 'area' ? '#f59e0b' : '#f5f5f5', dm === 'area' ? 'white' : '#444')}>
              ▭ エリア
            </button>
          </>
        )}
      </div>

      {/* Modals */}
      {(modal.type === 'cp-edit') && (
        <CPEditModal
          cp={modal.cp}
          candidate={modal.candidate}
          onSave={handleCpSave}
          onCancel={() => setModal({ type: 'none' })}
          onDelete={handleCpDelete}
          onPositionSelect={handlePositionSelect}
        />
      )}

      {modal.type === 'gps-fail' && (
        <GPSFallbackModal
          onRetry={() => {
            setModal({ type: 'none' })
            setTimeout(handlePlaceCp, 100)
          }}
          onManualInput={(lat, lng) => {
            setModal({ type: 'none' })
            modal.afterFix(lat, lng)
          }}
          onMapSelect={() => {
            const afterFix = modal.afterFix
            setModal({ type: 'position-select', cp: {
              id: '', type: 'cp', number: 0, usage: 'cp', order: 0, score: 10,
              acquired_lat: 0, acquired_lng: 0, acquired_at: new Date().toISOString(),
              description: '', memo: '', photos: [],
              coordinates: mapRef.current ? [mapRef.current.getCenter().lng, mapRef.current.getCenter().lat] : [136, 36]
            }})
            // Override confirmPositionSelect for this flow
            const origConfirm = confirmPositionSelect
            void origConfirm
            const map = mapRef.current
            if (map) afterFix(map.getCenter().lat, map.getCenter().lng)
          }}
          onCancel={() => setModal({ type: 'none' })}
        />
      )}

      {(modal.type === 'survey-new' || modal.type === 'survey-edit') && (
        <SurveyMemoModal
          memo={modal.memo}
          onSave={handleMemoSave}
          onCancel={() => setModal({ type: 'none' })}
          onDelete={modal.type === 'survey-edit' ? handleMemoDelete : undefined}
        />
      )}

      {showMenu && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 150 }} onClick={() => setShowMenu(false)} />
      )}
    </div>
  )
}

function tbBtn(bg: string, color: string): React.CSSProperties {
  return {
    padding: '8px 12px', background: bg, color, border: 'none',
    borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, flex: 1, minWidth: 70
  }
}

function initLayers(map: maplibregl.Map) {
  // print bbox
  map.addSource('print-bbox', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'print-bbox-fill', type: 'fill', source: 'print-bbox', paint: { 'fill-color': '#2d6a4f', 'fill-opacity': 0.05 } })
  map.addLayer({ id: 'print-bbox-line', type: 'line', source: 'print-bbox', paint: { 'line-color': '#2d6a4f', 'line-width': 2, 'line-dasharray': [4, 2] } })

  // cp candidates
  map.addSource('cp-candidates-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'cp-candidates', type: 'circle', source: 'cp-candidates-src', paint: {
    'circle-radius': 10, 'circle-color': '#aaa', 'circle-opacity': 0.8, 'circle-stroke-width': 2, 'circle-stroke-color': '#666'
  }})
  map.addLayer({ id: 'cp-candidates-label', type: 'symbol', source: 'cp-candidates-src', layout: {
    'text-field': ['get', 'number'], 'text-size': 11, 'text-offset': [0, -1.5]
  }, paint: { 'text-color': '#444' }})

  // cps
  map.addSource('cps-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'cps', type: 'circle', source: 'cps-src', paint: {
    'circle-radius': 12, 'circle-color': '#e74c3c', 'circle-opacity': 0.9, 'circle-stroke-width': 2, 'circle-stroke-color': 'white'
  }})
  map.addLayer({ id: 'cps-label', type: 'symbol', source: 'cps-src', layout: {
    'text-field': ['get', 'number'], 'text-size': 12, 'text-offset': [0, -1.8]
  }, paint: { 'text-color': 'white', 'text-halo-color': '#c0392b', 'text-halo-width': 1 }})

  // survey memos
  map.addSource('survey-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'survey-areas', type: 'fill', source: 'survey-src', filter: ['==', ['get', 'object_type'], 'area'],
    paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.2 } })
  map.addLayer({ id: 'survey-lines', type: 'line', source: 'survey-src', filter: ['==', ['get', 'object_type'], 'line'],
    paint: { 'line-color': '#f59e0b', 'line-width': 3 } })
  map.addLayer({ id: 'survey-points', type: 'circle', source: 'survey-src', filter: ['==', ['get', 'object_type'], 'point'],
    paint: { 'circle-radius': 8, 'circle-color': '#f59e0b', 'circle-stroke-width': 2, 'circle-stroke-color': 'white' } })
}

function updateLayers(map: maplibregl.Map, project: ProjectData, opts: {
  showCpCandidates: boolean; showCps: boolean; showPrintArea: boolean
  showSurveyMemos: boolean; showCurrentLocation: boolean
}) {
  // print bbox
  const [w, s, e, n] = project.metadata.print.bbox
  ;(map.getSource('print-bbox') as maplibregl.GeoJSONSource)?.setData({
    type: 'FeatureCollection', features: opts.showPrintArea ? [{
      type: 'Feature', properties: {},
      geometry: { type: 'Polygon', coordinates: [[[w,s],[e,s],[e,n],[w,n],[w,s]]] }
    }] : []
  })

  // cp candidates
  ;(map.getSource('cp-candidates-src') as maplibregl.GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: opts.showCpCandidates ? project.cpCandidates.map(c => ({
      type: 'Feature' as const, properties: { id: c.id, number: c.number },
      geometry: { type: 'Point' as const, coordinates: c.coordinates }
    })) : []
  })

  // cps
  ;(map.getSource('cps-src') as maplibregl.GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: opts.showCps ? project.cps.map(c => ({
      type: 'Feature' as const, properties: { id: c.id, number: c.number },
      geometry: { type: 'Point' as const, coordinates: c.coordinates }
    })) : []
  })

  // survey memos
  const surveyFeatures: maplibregl.MapGeoJSONFeature[] = []
  if (opts.showSurveyMemos) {
    for (const m of project.surveyMemos) {
      let geometry: object
      if (m.object_type === 'point') {
        geometry = { type: 'Point', coordinates: m.coordinates }
      } else if (m.object_type === 'line') {
        geometry = { type: 'LineString', coordinates: m.coordinates }
      } else {
        const coords = m.coordinates as [number, number][]
        geometry = { type: 'Polygon', coordinates: [[...coords, coords[0]]] }
      }
      surveyFeatures.push({
        type: 'Feature', properties: { id: m.id, object_type: m.object_type, category: m.category },
        geometry
      } as unknown as maplibregl.MapGeoJSONFeature)
    }
  }
  ;(map.getSource('survey-src') as maplibregl.GeoJSONSource)?.setData({
    type: 'FeatureCollection', features: surveyFeatures
  })
}
