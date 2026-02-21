import { demoEngine } from '@/lib/simEngine';

export const runtime = 'nodejs';

export async function GET() {
  demoEngine.start();

  const encoder = new TextEncoder();

  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Initial full snapshot
      send('snapshot', demoEngine.getSnapshot());

      const interval = setInterval(() => {
        if (closed) return;
        send('snapshot', demoEngine.getSnapshot());
      }, 500);

      return () => clearInterval(interval);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Connection: 'keep-alive',
    },
  });
}
