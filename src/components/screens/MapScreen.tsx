import { useRef, useState, useEffect, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import type {
  ProjectData, Cp, CpCandidate, SurveyMemo,
  SurveyMemoObjectType, HistoryAction, PointStyle, LineStyle, AreaStyle,
} from '../../types'
import { generateId, haversine, formatDistance, sortByOrder } from '../../lib/geojson'
import { exportZip } from '../../lib/export'
import { CPEditModal } from '../CPEditModal'
import { CPCandidateInfoModal } from '../CPCandidateInfoModal'
import { SurveyMemoModal } from '../SurveyMemoModal'

interface Props {
  project: ProjectData
  onProjectChange: (p: ProjectData) => void
  onBackToPrepare: () => void
}

type ModalState =
  | { type: 'none' }
  | { type: 'cp-edit'; cp: Cp; candidate?: CpCandidate }
  | { type: 'cp-candidate-info'; candidate: CpCandidate }
  | { type: 'survey-memo'; objectType: SurveyMemoObjectType; memo: SurveyMemo | null }

const GSI_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'
const MAX_UNDO = 50

async function drawOrienteeringImages(map: maplibregl.Map) {
  const size = 32

  const addImg = async (name: string, draw: (ctx: CanvasRenderingContext2D) => void) => {
    if (map.hasImage(name)) return
    const canvas = document.createElement('canvas')
    canvas.width = size; canvas.height = size
    draw(canvas.getContext('2d')!)
    const bitmap = await createImageBitmap(canvas)
    map.addImage(name, bitmap)
  }

  await addImg('cp-icon', ctx => {
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.arc(size / 2, size / 2, 12, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = '#c0392b'
    ctx.beginPath(); ctx.arc(size / 2, size / 2, 2.5, 0, Math.PI * 2); ctx.fill()
  })
  await addImg('cpc-icon', ctx => {
    ctx.strokeStyle = '#888'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(size / 2, size / 2, 11, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = '#888'
    ctx.beginPath(); ctx.arc(size / 2, size / 2, 2, 0, Math.PI * 2); ctx.fill()
  })
  await addImg('cpc-start-icon', ctx => {
    ctx.strokeStyle = '#888'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(size / 2, 4); ctx.lineTo(size - 4, size - 4); ctx.lineTo(4, size - 4); ctx.closePath(); ctx.stroke()
  })
  await addImg('cpc-finish-icon', ctx => {
    ctx.strokeStyle = '#888'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(size / 2, size / 2, 13, 0, Math.PI * 2); ctx.stroke()
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(size / 2, size / 2, 7, 0, Math.PI * 2); ctx.stroke()
  })
  await addImg('cp-start-icon', ctx => {
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.moveTo(size / 2, 4); ctx.lineTo(size - 4, size - 4); ctx.lineTo(4, size - 4); ctx.closePath(); ctx.stroke()
  })
  await addImg('cp-finish-icon', ctx => {
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.arc(size / 2, size / 2, 13, 0, Math.PI * 2); ctx.stroke()
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(size / 2, size / 2, 7, 0, Math.PI * 2); ctx.stroke()
  })
}

export function MapScreen({ project, onProjectChange, onBackToPrepare }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const userMarker = useRef<maplibregl.Marker | null>(null)

  const [modal, setModal] = useState<ModalState>({ type: 'none' })
  const [showMenu, setShowMenu] = useState(false)
  const [history, setHistory] = useState<HistoryAction[]>([])
  const [, setRedoStack] = useState<HistoryAction[]>([])
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null)
  const [mapCenter, setMapCenter] = useState<[number, number]>(() => {
    const bb = project.metadata.print?.bbox
    return bb ? [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2] : [136.0, 36.0]
  })
  const [mapZoom, setMapZoom] = useState(14)

  const [displayOptions, setDisplayOptions] = useState({
    showCpCandidates: true,
    showCps: true,
    showPrintArea: true,
    showSurveyMemos: true,
    showCpLines: true,
  })

  const projectRef = useRef(project)
  projectRef.current = project
  const selectedMemoIdRef = useRef(selectedMemoId)
  selectedMemoIdRef.current = selectedMemoId

  // single-click timer for survey memo double-click detection
  const memoClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const memoLastClickId = useRef<string | null>(null)

  // ---- map init ----
  useEffect(() => {
    if (!mapContainer.current) return
    const bb = project.metadata.print?.bbox
    const center: [number, number] = bb
      ? [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]
      : [136.0, 36.0]

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: { gsi: { type: 'raster', tiles: [GSI_TILE_URL], tileSize: 256, attribution: '© 国土地理院' } },
        layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }],
      },
      center,
      zoom: 14,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    map.on('move', () => {
      const c = map.getCenter()
      setMapCenter([c.lng, c.lat])
      setMapZoom(map.getZoom())
    })

    map.on('load', async () => {
      await drawOrienteeringImages(map)
      initLayers(map)
      updateLayers(map, project, displayOptions)
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- layer update when project / options change ----
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    updateLayers(map, project, displayOptions)
  }, [project, displayOptions])

  // ---- survey memo selection highlight ----
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    map.setFilter('survey-points-selected', selectedMemoId
      ? ['==', ['get', 'id'], selectedMemoId]
      : ['==', ['get', 'id'], ''])
    map.setFilter('survey-lines-selected', selectedMemoId
      ? ['==', ['get', 'id'], selectedMemoId]
      : ['==', ['get', 'id'], ''])
    map.setFilter('survey-areas-selected', selectedMemoId
      ? ['==', ['get', 'id'], selectedMemoId]
      : ['==', ['get', 'id'], ''])
  }, [selectedMemoId])

  // ---- layer click handlers ----
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
      setModal({ type: 'cp-candidate-info', candidate: cpc })
    }

    const onCpClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      e.preventDefault()
      const f = e.features?.[0]
      if (!f) return
      const cpId = f.properties?.id as string
      const cp = projectRef.current.cps.find(c => c.id === cpId)
      if (cp) setModal({ type: 'cp-edit', cp })
    }

    const onMemoClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      e.preventDefault()
      const f = e.features?.[0]
      if (!f) return
      const memoId = f.properties?.id as string

      if (memoLastClickId.current === memoId && memoClickTimer.current !== null) {
        // double-click: open edit
        clearTimeout(memoClickTimer.current)
        memoClickTimer.current = null
        memoLastClickId.current = null
        const memo = projectRef.current.surveyMemos.find(m => m.id === memoId)
        if (memo) setModal({ type: 'survey-memo', objectType: memo.object_type, memo })
      } else {
        // first click: select
        memoLastClickId.current = memoId
        setSelectedMemoId(memoId)
        if (memoClickTimer.current) clearTimeout(memoClickTimer.current)
        memoClickTimer.current = setTimeout(() => {
          memoClickTimer.current = null
          memoLastClickId.current = null
        }, 400)
      }
    }

    map.on('click', 'cp-candidates', onCpcClick)
    map.on('click', 'cps', onCpClick)
    map.on('click', 'survey-points', onMemoClick)
    map.on('click', 'survey-lines', onMemoClick)
    map.on('click', 'survey-areas', onMemoClick)
    map.on('mouseenter', 'cp-candidates', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'cp-candidates', () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'cps', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'cps', () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'survey-points', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'survey-points', () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'survey-lines', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'survey-lines', () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'survey-areas', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'survey-areas', () => { map.getCanvas().style.cursor = '' })

    return () => {
      map.off('click', 'cp-candidates', onCpcClick)
      map.off('click', 'cps', onCpClick)
      map.off('click', 'survey-points', onMemoClick)
      map.off('click', 'survey-lines', onMemoClick)
      map.off('click', 'survey-areas', onMemoClick)
    }
  }, [])

  // ---- GPS ----
  const handleCurrentLocation = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords
        map.flyTo({ center: [lng, lat], zoom: 16 })
        if (userMarker.current) {
          userMarker.current.setLngLat([lng, lat])
        } else {
          const el = document.createElement('div')
          el.style.cssText = [
            'width:28px;height:28px;position:relative;',
            'display:flex;align-items:center;justify-content:center;',
          ].join('')
          el.innerHTML = `<svg width="28" height="28" viewBox="0 0 28 28">
            <line x1="14" y1="2" x2="14" y2="26" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="2" y1="14" x2="26" y2="14" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>
          </svg>`
          userMarker.current = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([lng, lat]).addTo(map)
        }
      },
      () => alert('GPS信号を取得できませんでした'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  const handlePlaceCpAtLocation = useCallback(() => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords
        const p = projectRef.current
        const id = generateId('cp_', p.cps.map(c => c.id))
        const now = new Date().toISOString()
        const newCp: Cp = {
          id, type: 'cp', number: p.cps.length + 1, usage: 'cp', order: p.cps.length + 1,
          score: 10, acquired_lat: lat, acquired_lng: lng, acquired_at: now,
          description: '', memo: '', photos: [], coordinates: [lng, lat]
        }
        setModal({ type: 'cp-edit', cp: newCp })
      },
      () => alert('GPS信号を取得できませんでした'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  // ---- Undo ----
  const pushHistory = useCallback((action: HistoryAction) => {
    setHistory(prev => [...prev.slice(-MAX_UNDO + 1), action])
    setRedoStack([])
  }, [])

  const applyUndo = useCallback((action: HistoryAction) => {
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
  }, [onProjectChange])

  const handleUndo = useCallback(() => {
    setHistory(prev => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      const next = prev.slice(0, -1)
      setRedoStack(r => [last, ...r])
      applyUndo(last)
      return next
    })
  }, [applyUndo])

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
    setSelectedMemoId(null)
  }

  const handleMemoDelete = (id: string) => {
    const p = projectRef.current
    const memo = p.surveyMemos.find(m => m.id === id)
    if (memo) {
      pushHistory({ type: 'DELETE_MEMO', memo })
      onProjectChange({ ...p, surveyMemos: p.surveyMemos.filter(m => m.id !== id) })
    }
    setModal({ type: 'none' })
    setSelectedMemoId(null)
  }

  // ---- place CP from candidate info modal ----
  const handlePlaceCpFromCandidate = (candidate: CpCandidate) => {
    const p = projectRef.current
    const existing = p.cps.find(c => c.source_candidate_id === candidate.id)
    if (existing) {
      setModal({ type: 'cp-edit', cp: existing, candidate })
      return
    }
    const id = generateId('cp_', p.cps.map(c => c.id))
    const now = new Date().toISOString()
    const [lng, lat] = candidate.coordinates
    const newCp: Cp = {
      id, type: 'cp', number: candidate.number, usage: candidate.usage, order: candidate.order,
      score: candidate.score, acquired_lat: lat, acquired_lng: lng, acquired_at: now,
      description: '', memo: candidate.memo, photos: [],
      source_candidate_id: candidate.id, coordinates: candidate.coordinates,
    }
    setModal({ type: 'cp-edit', cp: newCp, candidate })
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
            ['showCpLines', 'CP間の線・距離を表示'],
            ['showPrintArea', '印刷範囲を表示'],
            ['showSurveyMemos', '調査メモを表示'],
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
      <div ref={mapContainer} style={{ flex: 1, position: 'relative' }} />

      {/* Bottom toolbar — 2 rows */}
      <div style={{
        padding: '8px 10px', background: 'white', borderTop: '1px solid #ddd',
        flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {/* Row 1: GPS actions */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleCurrentLocation} style={tbBtn('#2563eb', 'white')}>
            現在地表示
          </button>
          <button onClick={handlePlaceCpAtLocation} style={tbBtn('#e74c3c', 'white')}>
            現在地へCP設置
          </button>
        </div>
        {/* Row 2: Survey memo */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setModal({ type: 'survey-memo', objectType: 'point', memo: null })}
            style={tbBtn('#f5f5f5', '#444')}>
            ● ポイント追加
          </button>
          <button onClick={() => setModal({ type: 'survey-memo', objectType: 'line', memo: null })}
            style={tbBtn('#f5f5f5', '#444')}>
            ∿ ライン追加
          </button>
          <button onClick={() => setModal({ type: 'survey-memo', objectType: 'area', memo: null })}
            style={tbBtn('#f5f5f5', '#444')}>
            ▭ エリア追加
          </button>
        </div>
      </div>

      {/* Modals */}
      {modal.type === 'cp-edit' && (
        <CPEditModal
          cp={modal.cp}
          candidate={modal.candidate}
          mapCenter={mapCenter}
          mapZoom={mapZoom}
          onSave={handleCpSave}
          onCancel={() => setModal({ type: 'none' })}
          onDelete={handleCpDelete}
        />
      )}

      {modal.type === 'cp-candidate-info' && (
        <CPCandidateInfoModal
          candidate={modal.candidate}
          onClose={() => setModal({ type: 'none' })}
          onPlaceCp={() => handlePlaceCpFromCandidate(modal.candidate)}
        />
      )}

      {modal.type === 'survey-memo' && (
        <SurveyMemoModal
          memo={modal.memo}
          objectType={modal.objectType}
          projectBbox={project.metadata.print?.bbox}
          mapCenter={mapCenter}
          mapZoom={mapZoom}
          existingIds={project.surveyMemos.map(m => m.id)}
          onSave={handleMemoSave}
          onCancel={() => setModal({ type: 'none' })}
          onDelete={modal.memo ? handleMemoDelete : undefined}
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
    flex: 1, padding: '9px 4px', background: bg, color, border: 'none',
    borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
  }
}

function initLayers(map: maplibregl.Map) {
  // print bbox
  map.addSource('print-bbox', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'print-bbox-fill', type: 'fill', source: 'print-bbox',
    paint: { 'fill-color': '#2d6a4f', 'fill-opacity': 0.05 } })
  map.addLayer({ id: 'print-bbox-line', type: 'line', source: 'print-bbox',
    paint: { 'line-color': '#2d6a4f', 'line-width': 2, 'line-dasharray': [4, 2] } })

  // CP lines between placed CPs
  map.addSource('cp-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'cp-lines', type: 'line', source: 'cp-lines',
    paint: { 'line-color': '#c0392b', 'line-width': 1.5, 'line-dasharray': [5, 3], 'line-opacity': 0.7 } })
  map.addSource('cp-dist', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'cp-dist', type: 'symbol', source: 'cp-dist',
    layout: { 'text-field': ['get', 'dist'], 'text-size': 11 },
    paint: { 'text-color': '#c0392b', 'text-halo-color': 'white', 'text-halo-width': 1.5 } })

  // cp candidates
  map.addSource('cp-candidates-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'cp-candidates', type: 'symbol', source: 'cp-candidates-src',
    layout: {
      'icon-image': ['case',
        ['==', ['get', 'usage'], 'start'], 'cpc-start-icon',
        ['==', ['get', 'usage'], 'goal'], 'cpc-finish-icon',
        'cpc-icon',
      ],
      'icon-size': 1, 'icon-allow-overlap': true,
      'text-field': ['case', ['==', ['get', 'usage'], 'cp'], ['to-string', ['get', 'number']], ''],
      'text-size': 10, 'text-offset': [1.3, 0], 'text-anchor': 'left',
    },
    paint: { 'text-color': '#777', 'text-halo-color': 'white', 'text-halo-width': 1 }
  })

  // cps
  map.addSource('cps-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'cps', type: 'symbol', source: 'cps-src',
    layout: {
      'icon-image': ['case',
        ['==', ['get', 'usage'], 'start'], 'cp-start-icon',
        ['==', ['get', 'usage'], 'goal'], 'cp-finish-icon',
        'cp-icon',
      ],
      'icon-size': 1, 'icon-allow-overlap': true,
      'text-field': ['case', ['==', ['get', 'usage'], 'cp'], ['to-string', ['get', 'number']], ''],
      'text-size': 11, 'text-offset': [1.3, 0], 'text-anchor': 'left',
    },
    paint: { 'text-color': '#c0392b', 'text-halo-color': 'white', 'text-halo-width': 1 }
  })

  // survey memos
  map.addSource('survey-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'survey-areas', type: 'fill', source: 'survey-src',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] } })
  map.addLayer({ id: 'survey-areas-selected', type: 'line', source: 'survey-src',
    filter: ['==', ['get', 'id'], ''],
    paint: { 'line-color': '#f59e0b', 'line-width': 3 } })
  map.addLayer({ id: 'survey-lines', type: 'line', source: 'survey-src',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'] } })
  map.addLayer({ id: 'survey-lines-selected', type: 'line', source: 'survey-src',
    filter: ['==', ['get', 'id'], ''],
    paint: { 'line-color': '#fff', 'line-width': 5, 'line-opacity': 0.5 } })
  map.addLayer({ id: 'survey-points', type: 'circle', source: 'survey-src',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['get', 'size'],
      'circle-color': ['get', 'color'],
      'circle-opacity': ['get', 'opacity'],
      'circle-stroke-width': 2, 'circle-stroke-color': 'white',
    } })
  map.addLayer({ id: 'survey-points-selected', type: 'circle', source: 'survey-src',
    filter: ['==', ['get', 'id'], ''],
    paint: {
      'circle-radius': ['+', ['get', 'size'], 4],
      'circle-color': 'transparent',
      'circle-stroke-width': 3, 'circle-stroke-color': '#f59e0b',
    } })
}

function updateLayers(
  map: maplibregl.Map,
  project: ProjectData,
  opts: {
    showCpCandidates: boolean; showCps: boolean; showPrintArea: boolean
    showSurveyMemos: boolean; showCpLines: boolean
  }
) {
  const bbox = project.metadata.print?.bbox
  const bboxFeature = bbox
    ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[bbox[0],bbox[1]],[bbox[2],bbox[1]],[bbox[2],bbox[3]],[bbox[0],bbox[3]],[bbox[0],bbox[1]]]] } }]
    : []
  ;(map.getSource('print-bbox') as maplibregl.GeoJSONSource)?.setData(
    { type: 'FeatureCollection', features: opts.showPrintArea ? bboxFeature : [] } as Parameters<maplibregl.GeoJSONSource['setData']>[0])

  // CP lines / distances
  const sortedCps = sortByOrder(project.cps)
  const cpLineFeatures: object[] = []
  const cpDistFeatures: object[] = []
  if (opts.showCpLines && sortedCps.length >= 2) {
    for (let i = 1; i < sortedCps.length; i++) {
      const a = sortedCps[i - 1]; const b = sortedCps[i]
      cpLineFeatures.push({
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: [a.coordinates, b.coordinates] }
      })
      const dist = haversine(a.coordinates[0], a.coordinates[1], b.coordinates[0], b.coordinates[1])
      const mid: [number, number] = [(a.coordinates[0] + b.coordinates[0]) / 2, (a.coordinates[1] + b.coordinates[1]) / 2]
      cpDistFeatures.push({
        type: 'Feature', properties: { dist: formatDistance(dist) },
        geometry: { type: 'Point', coordinates: mid }
      })
    }
  }
  ;(map.getSource('cp-lines') as maplibregl.GeoJSONSource)?.setData(
    { type: 'FeatureCollection', features: cpLineFeatures } as Parameters<maplibregl.GeoJSONSource['setData']>[0])
  ;(map.getSource('cp-dist') as maplibregl.GeoJSONSource)?.setData(
    { type: 'FeatureCollection', features: cpDistFeatures } as Parameters<maplibregl.GeoJSONSource['setData']>[0])

  // cp candidates
  ;(map.getSource('cp-candidates-src') as maplibregl.GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: opts.showCpCandidates ? project.cpCandidates.map(c => ({
      type: 'Feature' as const,
      properties: { id: c.id, number: c.number, usage: c.usage },
      geometry: { type: 'Point' as const, coordinates: c.coordinates }
    })) : []
  })

  // cps
  ;(map.getSource('cps-src') as maplibregl.GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: opts.showCps ? project.cps.map(c => ({
      type: 'Feature' as const,
      properties: { id: c.id, number: c.number, usage: c.usage },
      geometry: { type: 'Point' as const, coordinates: c.coordinates }
    })) : []
  })

  // survey memos
  const surveyFeatures: object[] = []
  if (opts.showSurveyMemos) {
    for (const m of project.surveyMemos) {
      const style = m.style as Partial<PointStyle & LineStyle & AreaStyle>
      const props = {
        id: m.id, object_type: m.object_type, category: m.category,
        color: style.color ?? '#f59e0b',
        opacity: style.opacity ?? 0.9,
        size: (style as Partial<PointStyle>).size ?? 8,
        width: (style as Partial<LineStyle>).width ?? 3,
      }
      if (m.object_type === 'point') {
        surveyFeatures.push({ type: 'Feature', properties: props,
          geometry: { type: 'Point', coordinates: m.coordinates } })
      } else if (m.object_type === 'line') {
        surveyFeatures.push({ type: 'Feature', properties: props,
          geometry: { type: 'LineString', coordinates: m.coordinates } })
      } else {
        const coords = m.coordinates as [number, number][]
        surveyFeatures.push({ type: 'Feature', properties: props,
          geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] } })
      }
    }
  }
  ;(map.getSource('survey-src') as maplibregl.GeoJSONSource)?.setData(
    { type: 'FeatureCollection', features: surveyFeatures } as Parameters<maplibregl.GeoJSONSource['setData']>[0])
}
