import { createBrowserRouter } from 'react-router'
import { LandingPage } from './pages/LandingPage'
import { EditProfilePage } from './pages/EditProfilePage'
import { PublicCardPage } from './pages/PublicCardPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <LandingPage />,
  },
  {
    path: '/edit',
    element: <EditProfilePage />,
  },
  {
    path: '/p/:id',
    element: <PublicCardPage />,
  },
])
