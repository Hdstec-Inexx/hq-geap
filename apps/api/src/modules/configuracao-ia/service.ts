import {
  configuracaoIaSchema,
  type ConfiguracaoIa
} from '@hq-geap/contracts/configuracao-ia';
import type { ConfiguracaoIaRow } from './repository.js';

export function toConfiguracaoIa(row: ConfiguracaoIaRow): ConfiguracaoIa {
  return configuracaoIaSchema.parse({
    ...row,
    temperature: Number(row.temperature),
    createdAt: row.createdAt.toISOString()
  });
}
