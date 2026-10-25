import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './store/theme'
import { ToastProvider } from './store/toast'
import { AuthProvider } from './store/auth'
import { BookProvider } from './store/book'
import { UiProvider } from './store/ui'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BookProvider>
            <UiProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </UiProvider>
          </BookProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
