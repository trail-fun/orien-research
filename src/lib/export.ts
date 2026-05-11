import JSZip from 'jszip'
import { buildS2GeoJSON } from './geojson'
import type { ProjectData } from '../types'

export async function exportZip(project: ProjectData, filename: string): Promise<void> {
  const zip = new JSZip()
  const geojson = buildS2GeoJSON(project)
  zip.file('survey.geojson', JSON.stringify(geojson, null, 2))

  const photosFolder = zip.folder('photos')!
  for (const [name, dataUrl] of Object.entries(project.photos)) {
    const base64 = dataUrl.split(',')[1]
    photosFolder.file(name, base64, { base64: true })
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
