import { Navigate, createBrowserRouter } from 'react-router-dom';
import { AuthenticatedShell, Shell } from './shell';
import { LoginPage } from '../features/auth/LoginPage';
import { HomePage, RequireRole, RequireSession } from '../features/auth/routes';
import { HealthPage } from '../features/health/routes';
import { ConfiguracaoIaRoute } from '../features/admin/configuracao-ia/routes';
import { CriteriosRoute } from '../features/admin/criterios/routes';
import { UsuariosRoute } from '../features/admin/usuarios/routes';
import { ComentariosPendentesRoute } from '../features/admin/comentarios/routes';
import { AtendimentoPage } from '../features/atendimentos/AtendimentoPage';
import { AtendimentosPage } from '../features/atendimentos/AtendimentosPage';
import {
  CuradoriaReviewRoute,
  CuradoriasRealizadasRoute,
  FilaCuradoriaRoute,
  MinhasCuradoriasRoute
} from '../features/curadoria/routes';
import { DashboardRoute } from '../features/dashboards/routes';
import {
  MonitoramentoLiveRoute,
  MonitoramentoRoute
} from '../features/monitoramento/routes';

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/health', element: <HealthPage /> },
      {
        element: <RequireSession />,
        children: [
          {
            element: <AuthenticatedShell />,
            children: [
              { index: true, element: <HomePage /> },
              { path: '/app', element: <Navigate replace to="/" /> },
              { path: '/atendimentos', element: <AtendimentosPage /> },
              {
                path: '/atendimentos/:atendimentoId',
                element: <AtendimentoPage />
              },
              { path: '/monitoramento', element: MonitoramentoRoute },
              {
                path: '/monitoramento/:conversationId',
                element: MonitoramentoLiveRoute
              },
              { path: '/admin/criterios', element: <CriteriosRoute /> },
              {
                element: <RequireRole roles={['curador']} />,
                children: [
                  { path: '/minhas-curadorias', element: MinhasCuradoriasRoute }
                ]
              },
              {
                element: <RequireRole roles={['admin']} />,
                children: [
                  { path: '/admin', element: <HomePage /> },
                  {
                    path: '/admin/comentarios',
                    element: <ComentariosPendentesRoute />
                  },
                  { path: '/admin/usuarios', element: <UsuariosRoute /> },
                  {
                    path: '/admin/configuracao-ia',
                    element: <ConfiguracaoIaRoute />
                  }
                ]
              },
              {
                element: <RequireRole roles={['gestao']} />,
                children: [
                  { path: '/dashboard', element: DashboardRoute },
                  { path: '/gestao', element: <HomePage /> },
                  { path: '/gestao/dashboard', element: DashboardRoute },
                  {
                    path: '/curadorias-realizadas',
                    element: CuradoriasRealizadasRoute
                  }
                ]
              },
              {
                element: <RequireRole roles={['curador', 'gestao']} />,
                children: [
                  { path: '/curadoria', element: FilaCuradoriaRoute },
                  {
                    path: '/curadoria/:atendimentoId',
                    element: CuradoriaReviewRoute
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
]);

