import { motivosAtendimentosSchema } from '@hq-geap/contracts/atendimentos';
import { useEffect, useId, useRef, useState } from 'react';
import { useAuthenticatedResource } from './api';

export type MotivoComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
};

export function MotivoCombobox({
  value,
  onChange,
  id,
  name,
  placeholder = 'Selecione ou digite um motivo',
  disabled = false
}: MotivoComboboxProps) {
  const generatedId = useId();
  const inputId = id ?? `motivo-combobox-${generatedId}`;
  const listboxId = `motivo-listbox-${generatedId}`;
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const state = useAuthenticatedResource(
    '/atendimentos/motivos',
    motivosAtendimentosSchema
  );
  const distinctMotivos = state.status === 'ready' ? state.data : [];

  const filteredOptions = distinctMotivos.filter((option) =>
    option.toLowerCase().includes(value.toLowerCase())
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(filteredOptions.length > 0 ? 0 : -1);
      } else if (filteredOptions.length > 0) {
        setHighlightedIndex((prev) =>
          prev < filteredOptions.length - 1 ? prev + 1 : 0
        );
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(
          filteredOptions.length > 0 ? filteredOptions.length - 1 : -1
        );
      } else if (filteredOptions.length > 0) {
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredOptions.length - 1
        );
      }
    } else if (event.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        event.preventDefault();
        const selected = filteredOptions[highlightedIndex]!;
        onChange(selected);
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    } else if (event.key === 'Escape') {
      setIsOpen(false);
      setHighlightedIndex(-1);
    } else if (event.key === 'Tab') {
      setIsOpen(false);
      setHighlightedIndex(-1);
    }
  }

  function handleOptionSelect(option: string) {
    onChange(option);
    setIsOpen(false);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
  }

  const activeDescendantId =
    isOpen && highlightedIndex >= 0
      ? `motivo-opt-${generatedId}-${highlightedIndex}`
      : undefined;

  return (
    <div className="motivo-combobox-wrapper" ref={containerRef}>
      <input
        aria-activedescendant={activeDescendantId}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={isOpen}
        autoComplete="off"
        className="motivo-combobox-input"
        disabled={disabled}
        id={inputId}
        name={name}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
          setHighlightedIndex(0);
        }}
        onFocus={() => {
          if (distinctMotivos.length > 0) {
            setIsOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={inputRef}
        role="combobox"
        type="text"
        value={value}
      />
      {value ? (
        <button
          aria-label="Limpar motivo"
          className="motivo-combobox-clear"
          disabled={disabled}
          onClick={() => {
            onChange('');
            setIsOpen(false);
            setHighlightedIndex(-1);
            inputRef.current?.focus();
          }}
          tabIndex={-1}
          type="button"
        >
          ×
        </button>
      ) : null}
      {isOpen && filteredOptions.length > 0 ? (
        <ul
          aria-label="Sugestões de Motivo de Contato"
          className="motivo-combobox-listbox"
          id={listboxId}
          role="listbox"
        >
          {filteredOptions.map((option, index) => (
            <li
              aria-selected={option === value || index === highlightedIndex}
              className={`motivo-combobox-option ${
                index === highlightedIndex ? 'is-highlighted' : ''
              } ${option === value ? 'is-selected' : ''}`}
              id={`motivo-opt-${generatedId}-${index}`}
              key={option}
              onMouseDown={(event) => {
                event.preventDefault(); // prevents blur before click
                handleOptionSelect(option);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
              role="option"
            >
              {option}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
