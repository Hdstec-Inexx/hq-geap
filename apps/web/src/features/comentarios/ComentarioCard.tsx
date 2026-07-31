import type { Comentario } from '@hq-geap/contracts/comentarios';
import type { ReactNode } from 'react';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short'
});

export function ComentarioCard({
  comentario,
  className = 'comentario-item',
  cabecalho,
  children
}: {
  comentario: Comentario;
  className?: string;
  cabecalho?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className={className}>
      {cabecalho}
      <div className="comentario-meta">
        <strong>{comentario.autor.nome}</strong>
        <span>{dateTime.format(new Date(comentario.criadoEm))}</span>
        <span className={`comentario-status status-${comentario.status}`}>
          {comentario.status === 'pendente' ? 'Pendente' : 'Resolvido'}
        </span>
      </div>
      <p>{comentario.texto}</p>
      {comentario.resolucao ? (
        <small>
          Resolvido por {comentario.resolucao.responsavel.nome} em{' '}
          {dateTime.format(new Date(comentario.resolucao.resolvidoEm))}
        </small>
      ) : null}
      {children}
    </article>
  );
}
