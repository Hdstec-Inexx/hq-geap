import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { apiUrl, getSession } from '../auth/session';

type ResourceState<T> =
  | { path: string; status: 'loading' }
  | { path: string; status: 'error' }
  | { path: string; status: 'ready'; data: T };

export function useAuthenticatedResource<T>(path: string, schema: z.ZodType<T>) {
  const [state, setState] = useState<ResourceState<T>>({ path, status: 'loading' });

  useEffect(() => {
    const session = getSession();
    const controller = new AbortController();
    setState({ path, status: 'loading' });
    if (!session) {
      setState({ path, status: 'error' });
      return () => controller.abort();
    }

    fetch(`${apiUrl}${path}`, {
      headers: { authorization: `Bearer ${session.token}` },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }
        return schema.parse(await response.json());
      })
      .then((data) => setState({ path, status: 'ready', data }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ path, status: 'error' });
        }
      });

    return () => controller.abort();
  }, [path, schema]);

  return state;
}

export function formatDuration(seconds: number | null) {
  if (seconds === null) {
    return 'Não disponível';
  }
  return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}
