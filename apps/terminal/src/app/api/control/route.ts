import { NextResponse } from 'next/server';
import { demoEngine } from '@/lib/simEngine';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  demoEngine.start();
  const body = await req.json().catch(() => ({}));
  const { action, phase, scenarioId } = body ?? {};

  if (action === 'setPhase' && typeof phase === 'string') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    demoEngine.setPhase(phase as any);
    return NextResponse.json({ ok: true });
  }

  if (action === 'setScenario' && typeof scenarioId === 'string') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    demoEngine.setScenario(scenarioId as any);
    return NextResponse.json({ ok: true });
  }

  if (action === 'autoDemo') {
    demoEngine.autoDemo();
    return NextResponse.json({ ok: true });
  }

  if (action === 'approveReentry') {
    demoEngine.approveReentry();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
}
