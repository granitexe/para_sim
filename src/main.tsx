import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'

declare global {
  interface Window {
    CESIUM_BASE_URL: string
  }
}

window.CESIUM_BASE_URL = new URL('./cesium/', document.baseURI).href

const rootElement = document.getElementById('root')
if (rootElement === null) throw new Error('Missing #root application element')

void import('./app/App').then(({ App }) => {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
