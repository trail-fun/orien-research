import { useRef, useState, useEffect, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { parseS1GeoJSON } from '../../lib/geojson'
import type { ProjectData, PrintInfo } from '../../types'

interface Props {
  onReady: (project: ProjectData) => void
  existingProject: ProjectData | null
}

const GSI_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'

export function PrepareScreen({ onReady, existingProject }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const bboxLayerAdded = useRef(false)
  const [project, setProject] = useState<ProjectData | null>(existingProject)
  const [cacheStatus, setCacheStatus] = useState<'idle' | 'caching' | 'done'>('idle')
  const [cacheProgress, setCacheProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [cacheBbox, setCacheBbox] = useState<[number, number, number, number] | null>(null)

  useEffect(() => {
    if (!mapContainer.current) return
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          gsi: {
            type: 'raster',
            tiles: [GSI_TILE_URL],
            tileSize: 256,
            attribution: '© 国土地理院',
          },
        },
        layers: [{ id: 'gsi-layer', type: 'raster', source: 'gsi' }],
      },
      center: [136.0, 36.0],
      zoom: 10,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      bboxLayerAdded.current = false
    }
  }, [])

  const showPrintArea = useCallback((print: PrintInfo) => {
    const map = mapRef.current
    if (!map) return
    const [west, south, east, north] = print.bbox

    const addBboxLayer = () => {
      if (map.getSource('print-bbox')) {
        (map.getSource('print-bbox') as maplibregl.GeoJSONSource).setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [[[west,south],[east,south],[east,north],[west,north],[west,south]]]
            }
          }]
        })
        return
      }
      map.addSource('print-bbox', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [[[west,south],[east,south],[east,north],[west,north],[west,south]]]
            }
          }]
        }
      })
      map.addLayer({ id: 'print-bbox-fill', type: 'fill', source: 'print-bbox',
        paint: { 'fill-color': '#2d6a4f', 'fill-opacity': 0.1 } })
      map.addLayer({ id: 'print-bbox-line', type: 'line', source: 'print-bbox',
        paint: { 'line-color': '#2d6a4f', 'line-width': 2, 'line-dasharray': [4,2] } })
      bboxLayerAdded.current = true
    }

    if (map.isStyleLoaded()) {
      addBboxLayer()
    } else {
      map.once('load', addBboxLayer)
    }

    map.fitBounds([[west, south], [east, north]], { padding: 40 })
    setCacheBbox([west, south, east, north])
  }, [])

  useEffect(() => {
    if (existingProject?.metadata.print) {
      showPrintArea(existingProject.metadata.print)
    }
  }, [existingProject, showPrintArea])

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const parsed = parseS1GeoJSON(json)
      setProject(parsed)
      showPrintArea(parsed.metadata.print)
    } catch {
      setError('GeoJSONの読み込みに失敗しました。ファイルを確認してください。')
    }
    e.target.value = ''
  }

  const estimateCacheSize = (bbox: [number, number, number, number]) => {
    const [west, south, east, north] = bbox
    const latRange = north - south
    const lngRange = east - west
    const area = latRange * lngRange
    // rough estimate: ~50KB per tile, ~4 tiles per zoom level per area unit
    const tiles = Math.round(area * 40000)
    return Math.min(Math.round(tiles * 0.05), 500)
  }

  const handleCacheMap = async () => {
    if (!cacheBbox) return
    setCacheStatus('caching')
    setCacheProgress(0)

    // Trigger tile prefetch via Service Worker message
    const [west, south, east, north] = cacheBbox
    const minZoom = 10
    const maxZoom = 16
    let count = 0
    const total = (maxZoom - minZoom + 1) * 10

    for (let z = minZoom; z <= maxZoom; z++) {
      // Convert bbox to tile coords
      const minX = Math.floor(((west + 180) / 360) * Math.pow(2, z))
      const maxX = Math.floor(((east + 180) / 360) * Math.pow(2, z))
      const sinSouth = Math.sin((south * Math.PI) / 180)
      const sinNorth = Math.sin((north * Math.PI) / 180)
      const minY = Math.floor(((1 - Math.log((sinNorth + 1) / (1 - sinNorth)) / (2 * Math.PI)) / 2) * Math.pow(2, z))
      const maxY = Math.floor(((1 - Math.log((sinSouth + 1) / (1 - sinSouth)) / (2 * Math.PI)) / 2) * Math.pow(2, z))

      const fetchPromises: Promise<void>[] = []
      for (let x = minX; x <= Math.min(maxX, minX + 20); x++) {
        for (let y = minY; y <= Math.min(maxY, minY + 20); y++) {
          const url = GSI_TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
          fetchPromises.push(
            fetch(url).then(() => {}).catch(() => {})
          )
        }
      }
      await Promise.all(fetchPromises)
      count++
      setCacheProgress(Math.round((count / total) * 100))
    }

    setCacheStatus('done')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 16px', background: '#2d6a4f', color: 'white' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 'bold' }}>下見支援アプリ — 事前準備</h1>
      </div>

      <div style={{ padding: '12px 16px', background: '#f0faf4', borderBottom: '1px solid #c3e8d0' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', background: '#2d6a4f', color: 'white',
            borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600
          }}>
            <span>📂</span> GeoJSONを読み込む
            <input type="file" accept=".geojson,.json" onChange={handleFileImport}
              style={{ display: 'none' }} />
          </label>

          {project && (
            <div style={{ fontSize: 13, color: '#2d6a4f', fontWeight: 600 }}>
              ✓ {project.metadata.area_name} — CP候補 {project.cpCandidates.length}件
            </div>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 8, padding: '8px 12px', background: '#ffeaea', color: '#c0392b',
            borderRadius: 6, fontSize: 13 }}>
            {error}
          </div>
        )}

        {project && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: '#555' }}>
              縮尺: {project.metadata.print.scale} / サイズ: {project.metadata.print.size}
              {cacheBbox && ` / 保存目安: ~${estimateCacheSize(cacheBbox)}MB`}
            </div>
            {cacheStatus === 'idle' && (
              <button onClick={handleCacheMap} style={{
                padding: '7px 14px', background: '#1a4731', color: 'white',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13
              }}>
                🗺️ 地図をキャッシュ（オフライン保存）
              </button>
            )}
            {cacheStatus === 'caching' && (
              <div style={{ fontSize: 13, color: '#2d6a4f' }}>
                キャッシュ中… {cacheProgress}%
                <div style={{ width: 160, height: 6, background: '#c3e8d0', borderRadius: 3, marginTop: 4 }}>
                  <div style={{ width: `${cacheProgress}%`, height: '100%', background: '#2d6a4f', borderRadius: 3 }} />
                </div>
              </div>
            )}
            {cacheStatus === 'done' && (
              <div style={{ fontSize: 13, color: '#2d6a4f', fontWeight: 600 }}>✓ キャッシュ完了</div>
            )}
          </div>
        )}
      </div>

      <div ref={mapContainer} style={{ flex: 1 }} />

      {project && (
        <div style={{ padding: 12, background: '#f0faf4', borderTop: '1px solid #c3e8d0', textAlign: 'center' }}>
          <button
            onClick={() => onReady(project)}
            style={{
              padding: '10px 32px', background: '#2d6a4f', color: 'white',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 700
            }}
          >
            現地作業を開始 →
          </button>
        </div>
      )}
    </div>
  )
}
