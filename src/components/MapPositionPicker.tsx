import { useRef, useEffect, useState } from 'react'
import maplibregl from 'maplibre-gl'

const GSI_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'

interface Props {
  mode: 'point' | 'line' | 'area'
  initialCoords: [number, number][]       // existing points (empty = new)
  initialCenter: [number, number]         // [lng, lat]
  initialZoom: number
  onConfirm: (coords: [number, number][]) => void
  onCancel: () => void
}

export function MapPositionPicker({ mode, initialCoords, initialCenter, initialZoom, onConfirm, onCancel }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [coords, setCoords] = useState<[number, number][]>(initialCoords)
  const coordsRef = useRef(coords)
  coordsRef.current = coords

  // ---- map init ----
  useEffect(() => {
    if (!mapContainer.current) return
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: { gsi: { type: 'raster', tiles: [GSI_TILE_URL], tileSize: 256, attribution: '© 国土地理院' } },
        layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }],
      },
      center: initialCenter,
      zoom: initialZoom,
    })
    mapRef.current = map

    map.on('load', () => {
      // preview source for line/area
      map.addSource('preview', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      if (mode === 'area') {
        map.addLayer({ id: 'preview-fill', type: 'fill', source: 'preview',
          paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.3 } })
      }
      map.addLayer({ id: 'preview-line', type: 'line', source: 'preview',
        paint: { 'line-color': '#f59e0b', 'line-width': 3 } })
      map.addLayer({ id: 'preview-points', type: 'circle', source: 'preview',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 6, 'circle-color': '#f59e0b', 'circle-stroke-color': 'white', 'circle-stroke-width': 2 } })

      // draw initial coords if any
      updatePreview(map, coordsRef.current, mode)
    })

    return () => { map.remove(); mapRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // update preview when coords change
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    updatePreview(map, coords, mode)
  }, [coords, mode])

  const handleAddPoint = () => {
    const map = mapRef.current
    if (!map) return
    const c = map.getCenter()
    setCoords(prev => [...prev, [c.lng, c.lat]])
  }

  const handleDeleteLast = () => setCoords(prev => prev.slice(0, -1))

  const handleCurrentLocation = () => {
    const map = mapRef.current
    if (!map) return
    navigator.geolocation.getCurrentPosition(
      pos => map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16 }),
      () => alert('GPS信号を取得できませんでした'),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const handleConfirmPoint = () => {
    const map = mapRef.current
    if (!map) return
    const c = map.getCenter()
    onConfirm([[c.lng, c.lat]])
  }

  const canFinish = mode === 'line' ? coords.length >= 2 : mode === 'area' ? coords.length >= 3 : false

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
      {/* header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', background: '#1a4731', color: 'white', flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>
          {mode === 'point' ? '位置を指定' : mode === 'line' ? 'ライン作成' : 'エリア作成'}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleCurrentLocation} style={hdrBtn}>現在地</button>
          <button onClick={onCancel} style={{ ...hdrBtn, background: 'rgba(255,255,255,0.15)' }}>キャンセル</button>
        </div>
      </div>

      {/* map */}
      <div style={{ flex: 1, position: 'relative' }}>
        <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
        {/* crosshair */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none', zIndex: 10,
        }}>
          <svg width="32" height="32" viewBox="0 0 32 32">
            <line x1="16" y1="2" x2="16" y2="30" stroke="#e74c3c" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="2" y1="16" x2="30" y2="16" stroke="#e74c3c" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* bottom toolbar */}
      <div style={{
        padding: '10px 12px', background: 'white', borderTop: '1px solid #ddd',
        display: 'flex', gap: 8, flexShrink: 0,
      }}>
        {mode === 'point' && (
          <button onClick={handleConfirmPoint} style={confirmBtn}>設置</button>
        )}
        {(mode === 'line' || mode === 'area') && (<>
          <button onClick={handleAddPoint} style={confirmBtn}>ポイント追加</button>
          <button onClick={handleDeleteLast} disabled={coords.length === 0}
            style={{ ...secondaryBtn, opacity: coords.length === 0 ? 0.4 : 1 }}>削除</button>
          <button onClick={() => onConfirm(coords)} disabled={!canFinish}
            style={{ ...confirmBtn, opacity: canFinish ? 1 : 0.4 }}>終了</button>
          <span style={{ fontSize: 12, color: '#888', alignSelf: 'center', marginLeft: 4 }}>
            {coords.length}点
          </span>
        </>)}
      </div>
    </div>
  )
}

function updatePreview(map: maplibregl.Map, coords: [number, number][], mode: 'point' | 'line' | 'area') {
  const src = map.getSource('preview') as maplibregl.GeoJSONSource | undefined
  if (!src) return

  const features: object[] = coords.map(c => ({
    type: 'Feature', properties: {},
    geometry: { type: 'Point', coordinates: c },
  }))

  if (mode === 'line' && coords.length >= 2) {
    features.push({
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    })
  }
  if (mode === 'area' && coords.length >= 2) {
    const ring = coords.length >= 3 ? [...coords, coords[0]] : coords
    features.push({
      type: 'Feature', properties: {},
      geometry: { type: mode === 'area' && coords.length >= 3 ? 'Polygon' : 'LineString',
        coordinates: mode === 'area' && coords.length >= 3 ? [ring] : coords },
    })
  }

  src.setData({ type: 'FeatureCollection', features } as Parameters<typeof src.setData>[0])
}

const hdrBtn: React.CSSProperties = {
  padding: '4px 12px', background: 'rgba(255,255,255,0.25)', border: 'none',
  color: 'white', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
}
const confirmBtn: React.CSSProperties = {
  flex: 1, padding: '10px', background: '#2d6a4f', color: 'white',
  border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700,
}
const secondaryBtn: React.CSSProperties = {
  flex: 1, padding: '10px', background: '#f5f5f5', color: '#444',
  border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14,
}
