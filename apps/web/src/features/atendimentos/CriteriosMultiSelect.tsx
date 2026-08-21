import { reguaAvaliacaoSchema } from '@hq-geap/contracts/criterios';
import { useEffect, useId, useRef, useState } from 'react';
import { useAuthenticatedResource } from './api';
import {
  formatSelectedCriteriaLabel,
  type CriterioOption
} from './criterios-filtro-logic';

export type CriteriosMultiSelectProps = {
  id?: string;
  name?: string;
  placeholder?: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  criterios?: CriterioOption[];
};

export function CriteriosMultiSelect({
  id,
  name,
  placeholder = 'Todos os critérios',
  value,
  onChange,
  disabled = false,
  criterios: initialCriterios
}: CriteriosMultiSelectProps) {
  const generatedId = useId();
  const selectId = id ?? `criterios-multiselect-${generatedId}`;
  const listboxId = `criterios-listbox-${generatedId}`;
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const reguaState = useAuthenticatedResource(
    '/criterios',
    reguaAvaliacaoSchema
  );
  const availableCriterios: CriterioOption[] =
    initialCriterios ??
    (reguaState.status === 'ready' ? reguaState.data.criterios : []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  function handleTriggerClick() {
    if (disabled) return;
    setIsOpen((prev) => !prev);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (disabled) return;
    if (event.key === 'Escape') {
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  }

  function handleOptionKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    index: number
  ) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const checkboxes = containerRef.current?.querySelectorAll<HTMLInputElement>(
        '.criterios-multiselect-checkbox'
      );
      if (checkboxes && checkboxes.length > 0) {
        const nextIndex = (index + 1) % checkboxes.length;
        checkboxes[nextIndex]?.focus();
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const checkboxes = containerRef.current?.querySelectorAll<HTMLInputElement>(
        '.criterios-multiselect-checkbox'
      );
      if (checkboxes && checkboxes.length > 0) {
        const prevIndex = (index - 1 + checkboxes.length) % checkboxes.length;
        checkboxes[prevIndex]?.focus();
      }
    }
  }

  function toggleCriterion(criterionId: string) {
    if (value.includes(criterionId)) {
      onChange(value.filter((id) => id !== criterionId));
    } else {
      onChange([...value, criterionId]);
    }
  }

  function handleSelectAll() {
    const allIds = availableCriterios
      .map((c) => c.id)
      .filter((id): id is string => Boolean(id));
    onChange(allIds);
  }

  function handleClearAll(event?: React.MouseEvent) {
    event?.stopPropagation();
    onChange([]);
  }

  const displayLabel = formatSelectedCriteriaLabel(
    value,
    availableCriterios,
    placeholder
  );

  return (
    <div
      className="criterios-multiselect-wrapper"
      onKeyDown={handleKeyDown}
      ref={containerRef}
    >
      <div className="criterios-multiselect-trigger-container">
        <button
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          className={`criterios-multiselect-trigger ${value.length > 0 ? 'has-selection' : ''}`}
          disabled={disabled}
          id={selectId}
          name={name}
          onClick={handleTriggerClick}
          ref={triggerRef}
          type="button"
        >
          <span className="criterios-multiselect-label">{displayLabel}</span>
          <span aria-hidden="true" className="criterios-multiselect-chevron">
            ▾
          </span>
        </button>
        {value.length > 0 ? (
          <button
            aria-label="Limpar seleção de critérios"
            className="criterios-multiselect-clear"
            onClick={handleClearAll}
            type="button"
          >
            ×
          </button>
        ) : null}
      </div>

      {isOpen ? (
        <div
          aria-multiselectable="true"
          className="criterios-multiselect-popover"
          id={listboxId}
          role="listbox"
        >
          <div className="criterios-multiselect-actions">
            <button
              className="criterios-multiselect-action-btn"
              onClick={handleSelectAll}
              type="button"
            >
              Selecionar todos
            </button>
            <button
              className="criterios-multiselect-action-btn"
              disabled={value.length === 0}
              onClick={handleClearAll}
              type="button"
            >
              Limpar
            </button>
          </div>

          <div className="criterios-multiselect-options" role="group">
            {availableCriterios.map((criterio, index) => {
              const criterioId = criterio.id;
              if (!criterioId) return null;
              const isChecked = value.includes(criterioId);
              return (
                <label
                  aria-selected={isChecked}
                  className={`criterios-multiselect-option ${isChecked ? 'is-selected' : ''}`}
                  key={criterioId}
                >
                  <input
                    checked={isChecked}
                    className="criterios-multiselect-checkbox"
                    onChange={() => toggleCriterion(criterioId)}
                    onKeyDown={(e) => handleOptionKeyDown(e, index)}
                    type="checkbox"
                  />
                  <span className="criterios-multiselect-option-name">
                    {criterio.nome}
                  </span>
                  {criterio.critico ? (
                    <span className="criterio-critico-tag">CRÍTICO</span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
