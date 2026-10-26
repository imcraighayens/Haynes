import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './store/theme'
import { ToastProvider } from './store/toast'
import { AuthProvider } from './store/auth'
import { BookProvider } from './store/book'
import { UiProvider } from './store/ui'
import './styles/index.css'

// Preview builds (claude.ai Artifact) can't serve deep links, so they route by hash.
const Router = import.meta.env.VITE_HASH_ROUTER === '1' ? HashRouter : BrowserRouter

// Inside a frame (e.g. a claude.ai preview on a phone) the window often can't scroll,
// so the app becomes its own scroll container there.
try {
  if (window.self !== window.top) document.documentElement.classList.add('embedded')
} catch {
  document.documentElement.classList.add('embedded')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BookProvider>
            <UiProvider>
              <Router>
                <App />
              </Router>
            </UiProvider>
          </BookProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
