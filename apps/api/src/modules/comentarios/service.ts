import type {
  Comentario,
  ComentarioFila
} from '@hq-geap/contracts/comentarios';
import type { ComentarioFilaRow, ComentarioRow } from './repository.js';

export function toComentario(row: ComentarioRow): Comentario {
  return {
    id: row.id,
    atendimentoId: row.atendimentoId,
    texto: row.texto,
    status: row.status,
    autor: {
      id: row.autorId,
      nome: row.autorNome
    },
    resolucao:
      row.resolvidoPorId && row.resolvidoPorNome && row.resolvidoEm
        ? {
            responsavel: {
              id: row.resolvidoPorId,
              nome: row.resolvidoPorNome
            },
            resolvidoEm: row.resolvidoEm.toISOString()
          }
        : null,
    criadoEm: row.criadoEm.toISOString()
  };
}

export function toComentarioFila(row: ComentarioFilaRow): ComentarioFila {
  return {
    ...toComentario(row),
    atendimento: {
      id: row.atendimentoId,
      conversationId: row.conversationId,
      agenteVozNome: row.agenteVozNome
    }
  };
}
