import { getServerBaseUrl } from '@/lib/serverApi';

export const maxDuration = 30;
export async function POST(req: Request) {
  // Next 现在只保留一层很薄的转发，让浏览器继续访问相同的 `/api/chat`，
  // 而真正的 LLM 编排逻辑收口到 Python 后端。
  const response = await fetch(`${getServerBaseUrl()}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: await req.text(),
    cache: 'no-store',
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      'Content-Type': response.headers.get('content-type') ?? 'text/event-stream',
      'Cache-Control': response.headers.get('cache-control') ?? 'no-cache',
      'x-vercel-ai-ui-message-stream':
        response.headers.get('x-vercel-ai-ui-message-stream') ?? 'v1',
    },
  });
}
