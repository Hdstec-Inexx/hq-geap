import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ensureMinioTestAudio } from './audio-fixture.js';
import { authUsers } from './auth-fixtures.js';

const { Client } = pg;
const rootDirectory = fileURLToPath(new URL('../..', import.meta.url));

async function runSqlDirectory(client: pg.Client, directory: string) {
  const dirPath = path.join(rootDirectory, 'db', directory);
  const files = (await readdir(dirPath))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    await client.query(await readFile(path.join(dirPath, file), 'utf8'));
  }
}

export const TEST_DATABASE_CONNECTION_STRING =
  process.env.TEST_DATABASE_URL ??
  'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap_test';

process.env.DATABASE_URL = TEST_DATABASE_CONNECTION_STRING;

export const TEST_DATABASE_ADVISORY_LOCK_ID = 888999;

export async function createConnectedClient(): Promise<pg.Client> {
  const client = new Client({ connectionString: TEST_DATABASE_CONNECTION_STRING });
  await client.connect();
  return client;
}

export async function insertSnapshotAvaliacaoIa(
  client: pg.Client,
  atendimentoId: string,
  nota = 9.5,
  resumo = 'Resumo da avaliação da IA para o atendimento'
): Promise<void> {
  await client.query(
    `
    insert into avaliacoes (
      atendimento_id, autor, prompt_id, nota, nota_qualidade, resumo_atendimento,
      saudacao_e_intencao, solicitou_cpf, informou_protocolo_email,
      resolveu_solicitacao, validou_email_por_extenso, sem_diminutivos,
      encerramento_geap, uso_correto_ferramentas, falhas_identificadas, atendimento_aprovado
    )
    select $1, 'ia', p.id, $2, $2, $3,
      true, true, true, true, true, false, true, true,
      '["Utilizou diminutivo no atendimento"]'::jsonb, true
    from prompts_ia_avaliadora p
    where p.ativo
    limit 1
  `,
    [atendimentoId, nota, resumo]
  );
}

export async function withTestDatabaseLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockClient = new Client({ connectionString: TEST_DATABASE_CONNECTION_STRING });
  await lockClient.connect();
  await lockClient.query('select pg_advisory_lock($1)', [TEST_DATABASE_ADVISORY_LOCK_ID]);
  try {
    return await fn();
  } finally {
    try {
      await lockClient.query('select pg_advisory_unlock($1)', [TEST_DATABASE_ADVISORY_LOCK_ID]);
    } catch {
      // ignora se a conexao ja encerrou
    }
    await lockClient.end();
  }
}

export async function withPreparedTestDatabase<T>(fn: () => Promise<T>): Promise<T> {
  return withTestDatabaseLock(async () => {
    await prepareTestDatabase();
    return fn();
  });
}

export default async function prepareTestDatabase() {
  await ensureMinioTestAudio().catch(() => {});
  const client = new Client({ connectionString: TEST_DATABASE_CONNECTION_STRING });
  await client.connect();

  try {
    const result = await client.query<{ name: string }>(
      'select current_database() as name'
    );
    if (!result.rows[0]?.name.endsWith('_test')) {
      throw new Error('Refusing to reset a database whose name does not end in _test');
    }

    await client.query('drop extension if exists "pgcrypto" cascade');
    await client.query('drop schema if exists public cascade');
    await client.query('create schema public');
    await client.query('create extension if not exists "pgcrypto"');
    await client.query('set search_path to public');
    await runSqlDirectory(client, 'migrations');
    await runSqlDirectory(client, 'seeds');
    for (const user of authUsers) {
      await client.query(
        `insert into usuarios (nome, email, senha_hash, papel)
         values ($1, $2, crypt($3, gen_salt('bf')), $4)`,
        [user.name, user.email, user.password, user.role]
      );
    }
  } finally {
    await client.end();
  }
}
