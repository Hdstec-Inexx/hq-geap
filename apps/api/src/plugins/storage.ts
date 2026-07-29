import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    storage: {
      resolveAudioUrl(reference: string | null): string | null;
    };
  }
}

export default fp(
  async (app) => {
    app.decorate('storage', {
      resolveAudioUrl(reference: string | null) {
        return reference;
      }
    });
  },
  { name: 'storage' }
);
