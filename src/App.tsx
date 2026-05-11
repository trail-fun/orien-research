import { useState, useEffect, useCallback } from 'react'
import { PrepareScreen } from './components/screens/PrepareScreen'
import { MapScreen } from './components/screens/MapScreen'
import { saveProject, loadProject } from './lib/db'
import type { ProjectData } from './types'

type Screen = 'prepare' | 'map'

export function App() {
  const [screen, setScreen] = useState<Screen>('prepare')
  const [project, setProject] = useState<ProjectData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadProject()
      .then(p => {
        if (p) setProject(p)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleProjectChange = useCallback(async (p: ProjectData) => {
    setProject(p)
    try {
      await saveProject(p)
    } catch (e) {
      console.error('Failed to save project', e)
    }
  }, [])

  const handleReady = useCallback(async (p: ProjectData) => {
    await handleProjectChange(p)
    setScreen('map')
  }, [handleProjectChange])

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100dvh', background: '#f0faf4', color: '#2d6a4f', fontSize: 16
      }}>
        読み込み中...
      </div>
    )
  }

  if (screen === 'map' && project) {
    return (
      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <MapScreen
          project={project}
          onProjectChange={handleProjectChange}
          onBackToPrepare={() => setScreen('prepare')}
        />
      </div>
    )
  }

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PrepareScreen
        onReady={handleReady}
        existingProject={project}
      />
    </div>
  )
}
