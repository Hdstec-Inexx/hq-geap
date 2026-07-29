import { Navigate, createBrowserRouter } from 'react-router-dom';
import { Shell } from './shell';
import { LoginPage } from '../features/auth/LoginPage';
import { HomePage, RequireRole, RequireSession } from '../features/auth/routes';
import { HealthPage } from '../features/health/routes';

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/health', element: <HealthPage /> },
      {
        element: <RequireSession />,
        children: [
          { index: true, element: <HomePage /> },
          { path: '/app', element: <Navigate replace to="/" /> },
          {
            element: <RequireRole roles={['admin']} />,
            children: [{ path: '/admin', element: <HomePage /> }]
          },
          {
            element: <RequireRole roles={['gestao']} />,
            children: [{ path: '/gestao', element: <HomePage /> }]
          },
          {
            element: <RequireRole roles={['curador']} />,
            children: [{ path: '/curadoria', element: <HomePage /> }]
          }
        ]
      }
    ]
  }
]);
