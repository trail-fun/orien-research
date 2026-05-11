import type { ProjectData, CpCandidate, S1Metadata } from '../types'

export function parseS1GeoJSON(raw: unknown): ProjectData {
  const geojson = raw as {
    metadata: S1Metadata
    features: Array<{
      type: string
      properties: Record<string, unknown>
      geometry: { type: string; coordinates: unknown }
    }>
  }

  const cpCandidates: CpCandidate[] = []

  for (const f of geojson.features ?? []) {
    if (f.properties.type === 'cp_candidate') {
      const coords = f.geometry.coordinates as [number, number]
      cpCandidates.push({
        id: f.properties.id as string,
        type: 'cp_candidate',
        number: f.properties.number as number,
        usage: f.properties.usage as CpCandidate['usage'],
        order: f.properties.order as number,
        score: f.properties.score as number,
        memo: (f.properties.memo as string) ?? '',
        source: 's1',
        coordinates: coords,
      })
    }
  }

  return {
    metadata: geojson.metadata,
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
