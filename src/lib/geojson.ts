import type { ProjectData, CpCandidate, S1Metadata, PrintInfo } from '../types'

// S1のフィーチャーtypeをcp_candidateのusageに変換
function toUsage(type: string, usage: string | null): CpCandidate['usage'] {
  if (type === 'start') return 'start'
  if (type === 'finish') return 'goal'
  if (usage === 'start') return 'start'
  if (usage === 'goal') return 'goal'
  if (usage === 'both') return 'both'
  return 'cp'
}

// フィーチャー群からbboxを計算
function calcBbox(features: Array<{ geometry: { coordinates: unknown } }>): [number, number, number, number] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates as [number, number]
    if (lng < minLng) minLng = lng
    if (lat < minLat) minLat = lat
    if (lng > maxLng) maxLng = lng
    if (lat > maxLat) maxLat = lat
  }
  const pad = 0.002
  return [minLng - pad, minLat - pad, maxLng + pad, maxLat + pad]
}

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

  // --- メタデータ正規化（仕様書フォーマット / 実S1出力の両方に対応）---
  const printFromMeta = meta.print as Record<string, unknown> | undefined
  const print: PrintInfo = {
    scale: (printFromMeta?.scale ?? meta.scale ?? '1:10000') as string,
    size: (printFromMeta?.size ?? meta.output_size ?? meta.size ?? 'A4') as string,
    orientation: ((printFromMeta?.orientation ?? meta.orientation ?? 'portrait') as string) as 'portrait' | 'landscape',
    bbox: (printFromMeta?.bbox as [number, number, number, number]) ?? calcBbox(features),
  }

  const metadata: S1Metadata = {
    version: (meta.version as string) ?? '1.0',
    schema: (meta.schema as string) ?? 'orienteering-base-v1',
    created_at: (meta.created_at as string) ?? new Date().toISOString(),
    area_name: (meta.area_name as string) ?? '',
    memo: (meta.memo as string) ?? '',
    print,
  }

  // --- フィーチャー解析（cp_candidate 形式 / start・cp・finish 形式の両方に対応）---
  const cpCandidates: CpCandidate[] = []
  let counter = 1

  for (const f of features) {
    if (f.geometry.type !== 'Point') continue
    const p = f.properties
    const featureType = p.type as string

    // 仕様書フォーマット（cp_candidate）
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

    // 実S1出力フォーマット（start / cp / finish）
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

  return {
    metadata,
    cpCandidates,
    cps: [],
    surveyMemos: [],
    photos: {},
  }
}

export function buildS2GeoJSON(project: ProjectData): object {
  const features: object[] = []

  for (const cpc of project.cpCandidates) {
    features.push({
      type: 'Feature',
      properties: {
        id: cpc.id,
        type: 'cp_candidate',
        number: cpc.number,
        usage: cpc.usage,
        order: cpc.order,
        score: cpc.score,
        memo: cpc.memo,
        source: cpc.source ?? 's1',
      },
      geometry: { type: 'Point', coordinates: cpc.coordinates },
    })
  }

  for (const cp of project.cps) {
    features.push({
      type: 'Feature',
      properties: {
        id: cp.id,
        type: 'cp',
        number: cp.number,
        usage: cp.usage,
        order: cp.order,
        score: cp.score,
        acquired_lat: cp.acquired_lat,
        acquired_lng: cp.acquired_lng,
        acquired_at: cp.acquired_at,
        description: cp.description,
        memo: cp.memo,
        photos: cp.photos,
        source_candidate_id: cp.source_candidate_id,
      },
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
      properties: {
        id: sm.id,
        type: 'survey_memo',
        object_type: sm.object_type,
        category: sm.category,
        memo: sm.memo,
        photos: sm.photos,
      },
      geometry,
    })
  }

  return {
    type: 'FeatureCollection',
    metadata: {
      version: '1.0',
      schema: 'orienteering-survey-v1',
      created_at: project.metadata.created_at,
      updated_at: new Date().toISOString(),
      area_name: project.metadata.area_name,
      memo: project.metadata.memo,
      source_s1: {
        filename: '',
        version: project.metadata.version,
      },
      print: project.metadata.print,
    },
    features,
  }
}

export function generateId(prefix: string, existing: string[]): string {
  const nums = existing
    .filter((id) => id.startsWith(prefix))
    .map((id) => parseInt(id.replace(prefix, ''), 10))
    .filter((n) => !isNaN(n))
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
  return `${prefix}${String(next).padStart(3, '0')}`
}
