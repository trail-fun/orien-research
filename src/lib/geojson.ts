import JSZip from 'jszip'
import type {
  ProjectData, Cp, CpCandidate, S1Metadata, PrintInfo,
  SurveyMemo, SurveyMemoObjectType, MemoCategory,
  PointStyle, LineStyle, AreaStyle, SurveyMemoStyle,
} from '../types'

// ---- helpers ----

function toUsage(type: string, usage: string | null): CpCandidate['usage'] {
  if (type === 'start') return 'start'
  if (type === 'finish') return 'goal'
  if (usage === 'start') return 'start'
  if (usage === 'goal') return 'goal'
  if (usage === 'both') return 'both'
  return 'cp'
}

function calcBbox(features: Array<{ geometry: { coordinates: unknown } }>): [number, number, number, number] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates as [number, number]
    if (lng < minLng) minLng = lng
    if (lat < minLat) minLat = lat
    if (lng > maxLng) maxLng = lng
    if (lat > maxLat) maxLat = lat
  }
  const pad = 0.003
  return [minLng - pad, minLat - pad, maxLng + pad, maxLat + pad]
}

export function defaultStyle(objectType: SurveyMemoObjectType): SurveyMemoStyle {
  if (objectType === 'point') return { size: 10, color: '#f59e0b', opacity: 0.9 } as PointStyle
  if (objectType === 'line') return { width: 3, color: '#f59e0b', opacity: 0.9 } as LineStyle
  return { color: '#f59e0b', opacity: 0.35 } as AreaStyle
}

/** Haversine distance in meters */
export function haversine(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`
}

/** Sort CP candidates / CPs: start → cp (by order, then number) → goal */
export function sortByOrder<T extends { number: number; usage: string; order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const pri = (u: string) => u === 'start' ? 0 : u === 'goal' ? 2 : 1
    const d = pri(a.usage) - pri(b.usage)
    if (d !== 0) return d
    if (a.order !== b.order) return a.order - b.order
    return a.number - b.number
  })
}

// ---- S1 GeoJSON parser ----

export function parseS1GeoJSON(raw: unknown): ProjectData {
  const geojson = raw as {
    metadata: Record<string, unknown>
    features: Array<{
      type: string
      properties: Record<string, unknown>
      geometry: { type: string; coordinates: unknown }
    }>
  }

  const features = geojson.features ?? []
  const meta = geojson.metadata ?? {}
  const printFromMeta = meta.print as Record<string, unknown> | undefined

  const print: PrintInfo = {
    scale: (printFromMeta?.scale ?? meta.scale ?? '1:10000') as string,
    size: (printFromMeta?.size ?? meta.output_size ?? meta.size ?? 'A4') as string,
    orientation: ((printFromMeta?.orientation ?? meta.orientation ?? 'portrait') as string) as 'portrait' | 'landscape',
    bbox: (printFromMeta?.bbox as [number, number, number, number]) ??
          calcBbox(features.filter(f => f.geometry.type === 'Point')),
  }

  const metadata: S1Metadata = {
    version: (meta.version as string) ?? '1.0',
    schema: (meta.schema as string) ?? 'orienteering-base-v1',
    created_at: (meta.created_at as string) ?? new Date().toISOString(),
    area_name: (meta.area_name as string) ?? '',
    memo: (meta.memo as string) ?? '',
    print,
  }

  const cpCandidates: CpCandidate[] = []
  let counter = 1

  for (const f of features) {
    if (f.geometry.type !== 'Point') continue
    const p = f.properties
    const featureType = p.type as string

    if (featureType === 'cp_candidate') {
      cpCandidates.push({
        id: (p.id as string) ?? `cpc_${String(counter).padStart(3, '0')}`,
        type: 'cp_candidate',
        number: (p.number as number) ?? counter,
        usage: (p.usage as CpCandidate['usage']) ?? 'cp',
        order: (p.order as number) ?? counter,
        score: (p.score as number) ?? 10,
        memo: (p.memo as string) ?? '',
        source: 's1',
        coordinates: f.geometry.coordinates as [number, number],
      })
      counter++
      continue
    }

    if (['start', 'cp', 'finish'].includes(featureType)) {
      const num = featureType === 'start' ? 0 : featureType === 'finish' ? 999 : (p.number as number) ?? counter
      cpCandidates.push({
        id: `cpc_${String(counter).padStart(3, '0')}`,
        type: 'cp_candidate',
        number: num,
        usage: toUsage(featureType, p.usage as string | null),
        order: (p.order as number) ?? counter,
        score: (p.score as number) ?? 10,
        memo: (p.memo as string) ?? '',
        source: 's1',
        coordinates: f.geometry.coordinates as [number, number],
      })
      counter++
    }
  }

  return { metadata, cpCandidates, cps: [], surveyMemos: [], photos: {} }
}

// ---- S2 ZIP parser ----

export async function parseS2Zip(file: File): Promise<ProjectData> {
  const zip = await JSZip.loadAsync(file)
  const geojsonFile = zip.file('survey.geojson')
  if (!geojsonFile) throw new Error('survey.geojson が見つかりません')

  const geojsonText = await geojsonFile.async('text')
  const geojson = JSON.parse(geojsonText) as {
    metadata: Record<string, unknown>
    features: Array<{
      type: string
      properties: Record<string, unknown>
      geometry: { type: string; coordinates: unknown }
    }>
  }

  const meta = geojson.metadata ?? {}
  const printRaw = meta.print as Record<string, unknown> | undefined
  const print: PrintInfo = {
    scale: (printRaw?.scale ?? '1:10000') as string,
    size: (printRaw?.size ?? 'A4') as string,
    orientation: ((printRaw?.orientation ?? 'portrait') as string) as 'portrait' | 'landscape',
    bbox: (printRaw?.bbox as [number, number, number, number]) ?? [135, 34, 136, 35],
  }
  const metadata: S1Metadata = {
    version: (meta.version as string) ?? '1.0',
    schema: (meta.schema as string) ?? 'orienteering-survey-v1',
    created_at: (meta.created_at as string) ?? new Date().toISOString(),
    area_name: (meta.area_name as string) ?? '',
    memo: (meta.memo as string) ?? '',
    print,
  }

  const cpCandidates: CpCandidate[] = []
  const cps: Cp[] = []
  const surveyMemos: SurveyMemo[] = []

  for (const f of geojson.features ?? []) {
    const p = f.properties
    switch (p.type as string) {
      case 'cp_candidate':
        cpCandidates.push({
          id: p.id as string, type: 'cp_candidate',
          number: p.number as number, usage: p.usage as CpCandidate['usage'],
          order: (p.order as number) ?? 0, score: (p.score as number) ?? 10,
          memo: (p.memo as string) ?? '', source: 's1',
          coordinates: f.geometry.coordinates as [number, number],
        })
        break
      case 'cp':
        cps.push({
          id: p.id as string, type: 'cp',
          number: p.number as number, usage: p.usage as CpCandidate['usage'],
          order: (p.order as number) ?? 0, score: (p.score as number) ?? 10,
          acquired_lat: p.acquired_lat as number, acquired_lng: p.acquired_lng as number,
          acquired_at: p.acquired_at as string,
          description: (p.description as string) ?? '', memo: (p.memo as string) ?? '',
          photos: (p.photos as string[]) ?? [],
          source_candidate_id: p.source_candidate_id as string | undefined,
          coordinates: f.geometry.coordinates as [number, number],
        })
        break
      case 'survey_memo': {
        const objType = p.object_type as SurveyMemoObjectType
        let coordinates: [number, number] | [number, number][]
        if (objType === 'point') {
          coordinates = f.geometry.coordinates as [number, number]
        } else if (objType === 'line') {
          coordinates = f.geometry.coordinates as [number, number][]
        } else {
          // Polygon outer ring, remove closing point
          const ring = (f.geometry.coordinates as [number, number][][])[0]
          coordinates = ring.slice(0, -1) as [number, number][]
        }
        const rawStyle = p.style as Record<string, unknown> | undefined
        const style: SurveyMemoStyle = rawStyle
          ? rawStyle as unknown as SurveyMemoStyle
          : defaultStyle(objType)
        surveyMemos.push({
          id: p.id as string, type: 'survey_memo', object_type: objType,
          category: p.category as MemoCategory,
          memo: (p.memo as string) ?? '', photos: (p.photos as string[]) ?? [],
          coordinates, style,
        })
        break
      }
    }
  }

  // Read photos
  const photos: Record<string, string> = {}
  const photosFolder = zip.folder('photos')
  if (photosFolder) {
    const entries = photosFolder.filter((_rel, file) => !file.dir)
    for (const entry of entries) {
      const base64 = await entry.async('base64')
      const name = entry.name.split('/').pop()!
      const ext = name.split('.').pop()?.toLowerCase() ?? 'jpg'
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
      photos[name] = `data:${mime};base64,${base64}`
    }
  }

  return { metadata, cpCandidates, cps, surveyMemos, photos }
}

// ---- S2 GeoJSON builder ----

export function buildS2GeoJSON(project: ProjectData): object {
  const features: object[] = []

  for (const cpc of project.cpCandidates) {
    features.push({
      type: 'Feature',
      properties: { id: cpc.id, type: 'cp_candidate', number: cpc.number,
        usage: cpc.usage, order: cpc.order, score: cpc.score, memo: cpc.memo, source: cpc.source ?? 's1' },
      geometry: { type: 'Point', coordinates: cpc.coordinates },
    })
  }

  for (const cp of project.cps) {
    features.push({
      type: 'Feature',
      properties: { id: cp.id, type: 'cp', number: cp.number, usage: cp.usage,
        order: cp.order, score: cp.score, acquired_lat: cp.acquired_lat,
        acquired_lng: cp.acquired_lng, acquired_at: cp.acquired_at,
        description: cp.description, memo: cp.memo, photos: cp.photos,
        source_candidate_id: cp.source_candidate_id },
      geometry: { type: 'Point', coordinates: cp.coordinates },
    })
  }

  for (const sm of project.surveyMemos) {
    let geometry: object
    if (sm.object_type === 'point') {
      geometry = { type: 'Point', coordinates: sm.coordinates }
    } else if (sm.object_type === 'line') {
      geometry = { type: 'LineString', coordinates: sm.coordinates }
    } else {
      const coords = sm.coordinates as [number, number][]
      geometry = { type: 'Polygon', coordinates: [[...coords, coords[0]]] }
    }
    features.push({
      type: 'Feature',
      properties: { id: sm.id, type: 'survey_memo', object_type: sm.object_type,
        category: sm.category, memo: sm.memo, photos: sm.photos, style: sm.style },
      geometry,
    })
  }

  return {
    type: 'FeatureCollection',
    metadata: {
      version: '1.0', schema: 'orienteering-survey-v1',
      created_at: project.metadata.created_at, updated_at: new Date().toISOString(),
      area_name: project.metadata.area_name, memo: project.metadata.memo,
      source_s1: { filename: '', version: project.metadata.version },
      print: project.metadata.print,
    },
    features,
  }
}

export function generateId(prefix: string, existing: string[]): string {
  const nums = existing
    .filter(id => id.startsWith(prefix))
    .map(id => parseInt(id.replace(prefix, ''), 10))
    .filter(n => !isNaN(n))
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
  return `${prefix}${String(next).padStart(3, '0')}`
}
