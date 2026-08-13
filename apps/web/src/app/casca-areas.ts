import type { UserRole } from '@hq-geap/contracts/auth';

export type AreaCasca = {
  to: string;
  label: string;
};

/** Áreas liberadas ao papel na casca autenticada (mesmas da Home antiga). */
export function areasPorPapel(role: UserRole): AreaCasca[] {
  const areas: AreaCasca[] = [];

  if (role !== 'curador') {
    areas.push({ to: '/dashboard', label: 'Abrir Dashboard da Gestão' });
  }

  areas.push(
    { to: '/atendimentos', label: 'Consultar Atendimentos' },
    { to: '/monitoramento', label: 'Monitoramento ao Vivo' },
    {
      to: '/curadoria',
      label:
        role === 'gestao' ? 'Consultar Fila de Curadoria' : 'Abrir Fila de Curadoria'
    }
  );

  if (role === 'admin') {
    areas.push(
      { to: '/admin/comentarios', label: 'Trabalhar fila de manutenção' },
      { to: '/admin/usuarios', label: 'Administrar usuários' },
      { to: '/admin/configuracao-ia', label: 'Configurar IA Avaliadora' },
      { to: '/admin/criterios', label: 'Consultar Régua de Avaliação' }
    );
  }

  return areas;
}
