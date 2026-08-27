import { useState } from 'react';

export function CriterionTooltip({
  chave,
  nome,
  descricao
}: {
  chave: string;
  nome: string;
  descricao?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = `tooltip-${chave}`;

  if (!descricao) {
    return <span className="criterion-title-text">{nome}</span>;
  }

  return (
    <span
      className="criterion-tooltip-wrapper"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <span
        className="criterion-tooltip-trigger"
        tabIndex={0}
        aria-describedby={isOpen ? tooltipId : undefined}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setIsOpen(false);
        }}
      >
        {nome}
      </span>
      {isOpen ? (
        <span
          id={tooltipId}
          role="tooltip"
          className="criterion-tooltip"
        >
          <span className="criterion-tooltip-arrow" aria-hidden="true" />
          {descricao}
        </span>
      ) : null}
    </span>
  );
}
