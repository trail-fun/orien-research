import { openDB, IDBPDatabase } from 'idb'
import type { ProjectData } from '../types'

const DB_NAME = 'orien-research'
const DB_VERSION = 1
const STORE_PROJECT = 'project'
const STORE_PHOTOS = 'photos'

let db: IDBPDatabase | null = null

async function getDb(): Promise<IDBPDatabase> {
  if (db) return db
  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE_PROJECT)) {
        database.createObjectStore(STORE_PROJECT)
      }
      if (!database.objectStoreNames.contains(STORE_PHOTOS)) {
        database.createObjectStore(STORE_PHOTOS)
      }
    },
  })
  return db
}

export async function saveProject(project: ProjectData): Promise<void> {
  const database = await getDb()
  // Save without photos (stored separately)
  const { photos, ...projectWithoutPhotos } = project
  await database.put(STORE_PROJECT, projectWithoutPhotos, 'current')
  // Save photos separately
  for (const [filename, dataUrl] of Object.entries(photos)) {
    await database.put(STORE_PHOTOS, dataUrl, filename)
  }
}

export async function loadProject(): Promise<ProjectData | null> {
  const database = await getDb()
  const project = await database.get(STORE_PROJECT, 'current')
  if (!project) return null
  const photos: Record<string, string> = {}
  const photoKeys = await database.getAllKeys(STORE_PHOTOS)
  for (const key of photoKeys) {
    const val = await database.get(STORE_PHOTOS, key)
    if (val) photos[key as string] = val
  }
  return { ...project, photos }
}

export async function savePhoto(filename: string, dataUrl: string): Promise<void> {
  const database = await getDb()
  await database.put(STORE_PHOTOS, dataUrl, filename)
}

export async function clearAll(): Promise<void> {
  const database = await getDb()
  await database.clear(STORE_PROJECT)
  await database.clear(STORE_PHOTOS)
}
