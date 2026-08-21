import fp from 'fastify-plugin';
import pg from 'pg';

const { Pool } = pg;

declare module 'fastify' {
  interface FastifyInstance {
    db: pg.Pool;
  }
}

export default fp(
  async (app) => {
    const pool = new Pool({ connectionString: app.config.DATABASE_URL });
    pool.on('error', (error) => {
      app.log.error(error, 'Unexpected PostgreSQL idle client error');
    });
    app.decorate('db', pool);
    app.addHook('onClose', async () => {
      await pool.end();
    });
  },
  { name: 'database', dependencies: ['config'] }
);
