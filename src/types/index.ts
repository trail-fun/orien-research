export interface PrintInfo {
  scale: string
  size: string
  orientation: 'portrait' | 'landscape'
  bbox: [number, number, number, number] // [west, south, east, north]
}

export interface S1Metadata {
  version: string
  schema: string
  created_at: string
  area_name: string
  memo: string
  print: PrintInfo
}

export interface CpCandidate {
  id: string
  type: 'cp_candidate'
  number: number
  usage: 'start' | 'goal' | 'cp' | 'both'
  order: number
  score: number
  memo: string
  source?: 's1'
  coordinates: [number, number]
}

export interface Cp {
  id: string
  type: 'cp'
  number: number
  usage: 'start' | 'goal' | 'cp' | 'both'
  order: number
  score: number
  acquired_lat: number
  acquired_lng: number
  acquired_at: string
  description: string
  memo: string
  photos: string[]
  source_candidate_id?: string
  coordinates: [number, number]
}

export type SurveyMemoObjectType = 'point' | 'line' | 'area'

export type PointCategory = '岩' | '崖' | '通行止め' | '水場' | 'その他'
export type LineCategory = 'トレイル' | 'フェンス' | '崖（線状）' | 'その他'
export type AreaCategory = '立入禁止区域' | '藪' | 'その他'
export type MemoCategory = PointCategory | LineCategory | AreaCategory

export interface SurveyMemo {
  id: string
  type: 'survey_memo'
  object_type: SurveyMemoObjectType
  category: MemoCategory
  memo: string
  photos: string[]
  coordinates: [number, number] | [number, number][] | [number, number][][]
}

export interface ProjectData {
  metadata: S1Metadata
  cpCandidates: CpCandidate[]
  cps: Cp[]
  surveyMemos: SurveyMemo[]
  photos: Record<string, string> // filename -> dataURL
}

export interface AppState {
  screen: 'prepare' | 'map'
  project: ProjectData | null
  drawingMode: 'none' | 'point' | 'line' | 'area'
  mapDisplayOptions: {
    showCpCandidates: boolean
    showCps: boolean
    showPrintArea: boolean
    showSurveyMemos: boolean
    showCurrentLocation: boolean
    locationTrackingMode: 'continuous' | 'manual'
  }
}

export interface GpsFallbackType {
  type: 'retry' | 'manual-input' | 'map-select'
}

export type HistoryAction =
  | { type: 'ADD_CP'; cp: Cp }
  | { type: 'UPDATE_CP'; prev: Cp; next: Cp }
  | { type: 'DELETE_CP'; cp: Cp }
  | { type: 'ADD_MEMO'; memo: SurveyMemo }
  | { type: 'UPDATE_MEMO'; prev: SurveyMemo; next: SurveyMemo }
  | { type: 'DELETE_MEMO'; memo: SurveyMemo }
