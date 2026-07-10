import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { AuthProvider } from './auth'
import { loadRuntimeConfig } from './config/runtimeConfig'
import { router } from './router'
import './index.css'

async function main() {
  // Load runtime config (Cognito User Pool ID, etc.) before rendering,
  // so auth calls have valid configuration from the first render.
  await loadRuntimeConfig()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </StrictMode>,
  )
}

main()
