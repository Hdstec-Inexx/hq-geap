import type { EstadoCriterio } from '@hq-geap/contracts/avaliacoes';

export function derivarAprovacao(
  nota: number,
  criterios: Array<{ critico: boolean; estado: EstadoCriterio }>
) {
  const temFalhaCritica = criterios.some(
    (criterio) => criterio.critico && criterio.estado === 'nao_atendido'
  );
  return nota >= 7 && !temFalhaCritica ? 'aprovado' : 'reprovado';
}
