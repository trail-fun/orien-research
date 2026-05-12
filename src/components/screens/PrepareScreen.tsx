import { useRef, useState, useEffect, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { parseS1GeoJSON, parseS2Zip, haversine, formatDistance, sortByOrder } from '../../lib/geojson'
import type { ProjectData, PrintInfo } from '../../types'

interface Props {
  onReady: (project: ProjectData) => void
  existingProject: ProjectData | null
}

const GSI_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'


export function PrepareScreen({ onReady, existingProject }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [project, setProject] = useState<ProjectData | null>(existingProject)
  const projectRef = useRef(project)
  projectRef.current = project
  const [cacheStatus, setCacheStatus] = useState<'idle' | 'caching' | 'done'>('idle')
  const [cacheProgress, setCacheProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [cacheBbox, setCacheBbox] = useState<[number, number, number, number] | null>(null)

  // ---- map init ----
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

    map.on('load', () => {
      initPrepareLayerSources(map)
      updatePrepareLayerSources(map, projectRef.current)
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ---- resize when footer appears ----
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const id = requestAnimationFrame(() => map.resize())
    return () => cancelAnimationFrame(id)
  }, [project])

  // ---- update layers when project changes (map must already be loaded) ----
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    updatePrepareLayerSources(map, project)
  }, [project])

  const showPrintArea = useCallback((print: PrintInfo) => {
    const map = mapRef.current
    if (!map || !print?.bbox) return
    const [west, south, east, north] = print.bbox

    const addBboxLayer = () => {
      const geojsonData = {
        type: 'FeatureCollection' as const,
        features: [{
          type: 'Feature' as const, properties: {},
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]]
          }
        }]
      }
      if (map.getSource('print-bbox')) {
        (map.getSource('print-bbox') as maplibregl.GeoJSONSource).setData(geojsonData)
      } else {
        map.addSource('print-bbox', { type: 'geojson', data: geojsonData })
        map.addLayer({ id: 'print-bbox-fill', type: 'fill', source: 'print-bbox',
          paint: { 'fill-color': '#2d6a4f', 'fill-opacity': 0.1 } })
        map.addLayer({ id: 'print-bbox-line', type: 'line', source: 'print-bbox',
          paint: { 'line-color': '#2d6a4f', 'line-width': 2, 'line-dasharray': [4, 2] } })
      }
    }

    if (map.isStyleLoaded()) addBboxLayer()
    else map.once('load', addBboxLayer)

    map.fitBounds([[west, south], [east, north]], { padding: 40 })
    setCacheBbox([west, south, east, north])
  }, [])

  useEffect(() => {
    if (existingProject?.metadata?.print) {
      showPrintArea(existingProject.metadata.print)
    }
  }, [existingProject, showPrintArea])

  const applyProject = (parsed: ProjectData) => {
    setProject(parsed)
    showPrintArea(parsed.metadata.print)
  }

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      if (file.name.endsWith('.zip')) {
        const parsed = await parseS2Zip(file)
        applyProject(parsed)
      } else {
        const text = await file.text()
        const json = JSON.parse(text) as unknown
        const parsed = parseS1GeoJSON(json)
        applyProject(parsed)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`読み込みエラー: ${msg}`)
    }
    e.target.value = ''
  }

  const estimateCacheSize = (bbox: [number, number, number, number]) => {
    const [west, south, east, north] = bbox
    const area = (north - south) * (east - west)
    const tiles = Math.round(area * 40000)
    return Math.max(1, Math.min(Math.round(tiles * 0.05), 500))
  }

  const handleCacheMap = async () => {
    if (!cacheBbox) return
    setCacheStatus('caching')
    setCacheProgress(0)

    const [west, south, east, north] = cacheBbox
    const minZoom = 10
    const maxZoom = 16
    let count = 0
    const total = maxZoom - minZoom + 1

    for (let z = minZoom; z <= maxZoom; z++) {
      const minX = Math.floor(((west + 180) / 360) * Math.pow(2, z))
      const maxX = Math.floor(((east + 180) / 360) * Math.pow(2, z))
      const sinSouth = Math.sin((south * Math.PI) / 180)
      const sinNorth = Math.sin((north * Math.PI) / 180)
      const minY = Math.floor(((1 - Math.log((sinNorth + 1) / (1 - sinNorth)) / (2 * Math.PI)) / 2) * Math.pow(2, z))
      const maxY = Math.floor(((1 - Math.log((sinSouth + 1) / (1 - sinSouth)) / (2 * Math.PI)) / 2) * Math.pow(2, z))

      const fetchPromises: Promise<void>[] = []
      for (let x = minX; x <= Math.min(maxX, minX + 20); x++) {
        for (let y = minY; y <= Math.min(maxY, minY + 20); y++) {
          const url = GSI_TILE_URL
            .replace('{z}', String(z))
            .replace('{x}', String(x))
            .replace('{y}', String(y))
          fetchPromises.push(fetch(url).then(() => {}).catch(() => {}))
        }
      }
      await Promise.all(fetchPromises)
      count++
      setCacheProgress(Math.round((count / total) * 100))
    }

    setCacheStatus('done')
  }

  const printInfo = project?.metadata?.print

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', background: '#2d6a4f', color: 'white', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 'bold' }}>オリエン調査アプリ — 事前準備</h1>
      </div>

      {/* Controls */}
      <div style={{ padding: '12px 16px', background: '#f0faf4', borderBottom: '1px solid #c3e8d0', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', background: '#2d6a4f', color: 'white',
            borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600
          }}>
            📂 ファイルを読み込む
            <input type="file" accept=".geojson,.json,.zip" onChange={handleFileImport}
              style={{ display: 'none' }} />
          </label>

          {project && (
            <div style={{ fontSize: 13, color: '#2d6a4f', fontWeight: 600 }}>
              ✓ {project.metadata.area_name || '（エリア名なし）'} — CP候補 {project.cpCandidates.length}件
            </div>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 8, padding: '8px 12px', background: '#ffeaea', color: '#c0392b',
            borderRadius: 6, fontSize: 13, wordBreak: 'break-all' }}>
            {error}
          </div>
        )}

        {printInfo && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: '#555' }}>
              縮尺: {printInfo.scale} / サイズ: {printInfo.size}
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

      {/* Map */}
      <div ref={mapContainer} style={{ flex: 1, minHeight: 0 }} />

      {/* Start button */}
      {project && (
        <div style={{ padding: 12, background: '#f0faf4', borderTop: '1px solid #c3e8d0', textAlign: 'center', flexShrink: 0 }}>
          <button
            onClick={() => onReady(project)}
            style={{
              padding: '10px 32px', background: '#2d6a4f', color: 'white',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 700
            }}
          >
            調査開始 →
          </button>
        </div>
      )}
    </div>
  )
}

function initPrepareLayerSources(map: maplibregl.Map) {
  map.addSource('prep-cp-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'prep-cp-lines', type: 'line', source: 'prep-cp-lines',
    paint: { 'line-color': '#888', 'line-width': 1.5, 'line-dasharray': [4, 3], 'line-opacity': 0.7 } })

  map.addSource('prep-cp-dist', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'prep-cp-dist', type: 'symbol', source: 'prep-cp-dist',
    layout: { 'text-field': ['get', 'dist'], 'text-size': 11, 'text-offset': [0, -0.6] },
    paint: { 'text-color': '#555', 'text-halo-color': 'white', 'text-halo-width': 1.5 } })

  map.addSource('prep-candidates', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  // outer ring (all candidates)
  map.addLayer({ id: 'prep-candidates', type: 'circle', source: 'prep-candidates',
    paint: {
      'circle-radius': 11,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': '#666',
      'circle-stroke-width': 2,
    }
  })
  // inner ring for finish (double circle)
  map.addLayer({ id: 'prep-candidates-inner', type: 'circle', source: 'prep-candidates',
    filter: ['any', ['==', ['get', 'usage'], 'goal'], ['==', ['get', 'usage'], 'both']],
    paint: { 'circle-radius': 6, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#666', 'circle-stroke-width': 1.5 }
  })
  // center dot (regular CPs and start)
  map.addLayer({ id: 'prep-candidates-dot', type: 'circle', source: 'prep-candidates',
    filter: ['!', ['any', ['==', ['get', 'usage'], 'goal'], ['==', ['get', 'usage'], 'both']]],
    paint: { 'circle-radius': 2.5, 'circle-color': '#666' }
  })
}

function updatePrepareLayerSources(map: maplibregl.Map, project: ProjectData | null) {
  const cpLinesSrc = map.getSource('prep-cp-lines') as maplibregl.GeoJSONSource | undefined
  const cpDistSrc = map.getSource('prep-cp-dist') as maplibregl.GeoJSONSource | undefined
  const candidatesSrc = map.getSource('prep-candidates') as maplibregl.GeoJSONSource | undefined
  if (!cpLinesSrc || !cpDistSrc || !candidatesSrc) return

  if (!project) {
    const empty = { type: 'FeatureCollection' as const, features: [] }
    cpLinesSrc.setData(empty); cpDistSrc.setData(empty); candidatesSrc.setData(empty)
    return
  }

  const sorted = sortByOrder(project.cpCandidates)

  const lineFeatures: object[] = []
  const distFeatures: object[] = []
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]; const b = sorted[i]
    lineFeatures.push({
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [a.coordinates, b.coordinates] }
    })
    const dist = haversine(a.coordinates[0], a.coordinates[1], b.coordinates[0], b.coordinates[1])
    const mid: [number, number] = [
      (a.coordinates[0] + b.coordinates[0]) / 2,
      (a.coordinates[1] + b.coordinates[1]) / 2,
    ]
    distFeatures.push({
      type: 'Feature', properties: { dist: formatDistance(dist) },
      geometry: { type: 'Point', coordinates: mid }
    })
  }

  cpLinesSrc.setData({ type: 'FeatureCollection', features: lineFeatures } as Parameters<typeof cpLinesSrc.setData>[0])
  cpDistSrc.setData({ type: 'FeatureCollection', features: distFeatures } as Parameters<typeof cpDistSrc.setData>[0])

  candidatesSrc.setData({
    type: 'FeatureCollection',
    features: project.cpCandidates.map(c => ({
      type: 'Feature', properties: { id: c.id, number: c.number, usage: c.usage },
      geometry: { type: 'Point', coordinates: c.coordinates }
    }))
  })
}
