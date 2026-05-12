export interface PrintInfo {
  scale: string
  size: string
  orientation: 'portrait' | 'landscape'
  bbox: [number, number, number, number]
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

export interface PointStyle { size: number; color: string; opacity: number }
export interface LineStyle  { width: number; color: string; opacity: number }
export interface AreaStyle  { color: string; opacity: number }
export type SurveyMemoStyle = PointStyle | LineStyle | AreaStyle

export interface SurveyMemo {
  id: string
  type: 'survey_memo'
  object_type: SurveyMemoObjectType
  category: MemoCategory
  memo: string
  photos: string[]
  // point: [lng, lat] / line・area: [[lng, lat], ...]
  coordinates: [number, number] | [number, number][]
  style: SurveyMemoStyle
}

export interface ProjectData {
  metadata: S1Metadata
  cpCandidates: CpCandidate[]
  cps: Cp[]
  surveyMemos: SurveyMemo[]
  photos: Record<string, string>
}

export type HistoryAction =
  | { type: 'ADD_CP'; cp: Cp }
  | { type: 'UPDATE_CP'; prev: Cp; next: Cp }
  | { type: 'DELETE_CP'; cp: Cp }
  | { type: 'ADD_MEMO'; memo: SurveyMemo }
  | { type: 'UPDATE_MEMO'; prev: SurveyMemo; next: SurveyMemo }
  | { type: 'DELETE_MEMO'; memo: SurveyMemo }
