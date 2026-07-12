import { createBrowserRouter } from 'react-router'
import { LandingPage } from './pages/LandingPage'
import { EditProfilePage } from './pages/EditProfilePage'
import { PublicCardPage } from './pages/PublicCardPage'
import { ConnectionsPage } from './pages/ConnectionsPage'
import { AboutPage } from './pages/AboutPage'

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
    path: '/connections',
    element: <ConnectionsPage />,
  },
  {
    path: '/p/:id',
    element: <PublicCardPage />,
  },
  {
    path: '/about',
    element: <AboutPage />,
  },
])
