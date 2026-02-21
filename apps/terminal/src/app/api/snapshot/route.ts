import { NextResponse } from 'next/server';
import { demoEngine } from '@/lib/simEngine';

export const runtime = 'nodejs';

export async function GET() {
  demoEngine.start();
  return NextResponse.json(demoEngine.getSnapshot(), {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
