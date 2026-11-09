import { proxyToApi } from '@/lib/api-proxy';

// Every request is forwarded at request time; nothing here is cached or prerendered.
export const dynamic = 'force-dynamic';

interface Context {
  readonly params: Promise<{ path: string[] }>;
}

async function handle(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  return proxyToApi(request, path);
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST };
