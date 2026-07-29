import { Navigate, createBrowserRouter } from 'react-router-dom';
import { Shell } from './shell';
import { HealthPage } from '../features/health/routes';

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Navigate replace to="/health" /> },
      { path: '/health', element: <HealthPage /> }
    ]
  }
]);
