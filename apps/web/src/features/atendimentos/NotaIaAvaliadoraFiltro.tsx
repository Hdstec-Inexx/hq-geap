import { useId } from 'react';
import { formatNotaMinDisplay } from './nota-ia-filtro-logic';

export type NotaIaAvaliadoraFiltroProps = {
  id?: string;
  name?: string;
  value: number;
  onChange: (value: number) => void;
};

export function NotaIaAvaliadoraFiltro({
  id,
  name = 'notaMin',
  value,
  onChange
}: NotaIaAvaliadoraFiltroProps) {
  const generatedId = useId();
  const inputId = id ?? `nota-ia-avaliadora-filtro-${generatedId}`;

  return (
    <label>
      Nota da IA Avaliadora
      <span className="nota-ia-filtro">
        <input
          id={inputId}
          max={10}
          min={0}
          name={name}
          onChange={(event) => onChange(Number(event.target.value))}
          step={0.5}
          type="range"
          value={value}
        />
        <output htmlFor={inputId}>{formatNotaMinDisplay(value)}</output>
      </span>
    </label>
  );
}
