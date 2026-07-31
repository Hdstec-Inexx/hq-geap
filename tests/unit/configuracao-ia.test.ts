import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishConfiguracaoIaSchema } from '../../packages/contracts/src/configuracao-ia.js';

const validConfiguration = {
  prompt: 'Avalie o Atendimento.',
  provider: 'openrouter',
  model: 'google/gemini-2.5-flash',
  temperature: 0.2
};

test('accepts supported configuration identifiers and temperature precision', () => {
  assert.equal(publishConfiguracaoIaSchema.safeParse(validConfiguration).success, true);
});

test('rejects temperature that PostgreSQL would round', () => {
  assert.equal(
    publishConfiguracaoIaSchema.safeParse({
      ...validConfiguration,
      temperature: 0.25
    }).success,
    false
  );
});

test('rejects provider and model identifiers containing whitespace', () => {
  assert.equal(
    publishConfiguracaoIaSchema.safeParse({
      ...validConfiguration,
      provider: 'open router'
    }).success,
    false
  );
  assert.equal(
    publishConfiguracaoIaSchema.safeParse({
      ...validConfiguration,
      model: 'google/gemini flash'
    }).success,
    false
  );
});
