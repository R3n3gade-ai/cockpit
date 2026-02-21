import { randomUUID } from 'crypto';
import type { ARESGateStatus, ARASModuleSignal, PillarId, Regime, StressSource, SystemSnapshot } from './types';

// In-memory singleton demo engine.
// Designed to be replaced later by real computation + adapters.

type Phase =
  | 'CALM'
  | 'BUILD_STRESS'
  | 'CIRCUIT_BREAK'
  | 'DELEVERAGE'
  | 'STABILIZE'
  | 'ARES_GATES'
  | 'REENTRY';

const PILLARS: Array<{ id: PillarId; name: string; type: 'defensive' | 'offensive' | 'context' | 'execution' }> = [
  { id: 'ARAS', name: 'ARAS', type: 'defensive' },
  { id: 'MACRO', name: 'Macro Compass', type: 'context' },
  { id: 'MASTER', name: 'Master Engine', type: 'execution' },
  { id: 'KEVLAR', name: 'Kevlar', type: 'defensive' },
  { id: 'PERM', name: 'PERM', type: 'defensive' },
  { id: 'SLOF', name: 'SLOF', type: 'offensive' },
  { id: 'ARES', name: 'ARES', type: 'offensive' },
];

const now = () => Date.now();

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

class Engine {
  private snapshot: SystemSnapshot;
  private phase: Phase = 'CALM';
  private phaseT0 = now();
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.snapshot = this.makeInitial();
  }

  getSnapshot() {
    return this.snapshot;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 400); // ~2.5 Hz
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setPhase(phase: Phase) {
    this.phase = phase;
    this.phaseT0 = now();
    this.pushAlert('info', `Phase → ${phase}`, 'Scenario controller');
  }

  autoDemo() {
    // deterministic story arc (~3–5 min total)
    this.setPhase('CALM');
  }

  private makeInitial(): SystemSnapshot {
    const t = now();
    const pillars = Object.fromEntries(
      PILLARS.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          type: p.type,
          status: 'OK' as const,
          score: p.id === 'ARAS' ? 0.18 : 0.2,
          confidence: 0.82,
          headline: 'Nominal',
          updatedAt: t,
        },
      ])
    ) as SystemSnapshot['pillars'];

    const arasModules: ARASModuleSignal[] = [
      { name: 'Deleveraging Risk', risk_score: 0.18, stress_flag: false, confidence: 0.88, source_bucket: 'MIXED' },
      { name: 'Crypto Microstructure', risk_score: 0.16, stress_flag: false, confidence: 0.86, source_bucket: 'CRYPTO' },
      { name: 'Margin Stress', risk_score: 0.14, stress_flag: false, confidence: 0.84, source_bucket: 'EQUITY' },
      { name: 'Dealer Gamma', risk_score: 0.15, stress_flag: false, confidence: 0.83, source_bucket: 'EQUITY' },
      { name: 'PCR Regime', risk_score: 0.17, stress_flag: false, confidence: 0.82, source_bucket: 'EQUITY' },
      { name: 'Shutdown Risk', risk_score: 0.08, stress_flag: false, confidence: 0.80, source_bucket: 'CRYPTO' },
    ];

    const aresGates: ARESGateStatus = {
      gate1_stress_normalization: 'WAIT',
      gate2_conviction: 'WAIT',
      gate3_confirmation: 'WAIT',
    };

    return {
      ts: t,
      regime: 'RISK_ON',
      exposureCeilingGross: 0.9,
      stressSource: 'GENERAL',
      arasModules,
      aresGates,
      pillars,
      alerts: [
        {
          id: randomUUID(),
          ts: t,
          severity: 'info',
          title: 'Engine initialized',
          detail: 'Demo scenario engine online.',
          tags: ['system'],
        },
      ],
    };
  }

  private pushAlert(severity: 'info' | 'watch' | 'critical', title: string, detail?: string) {
    this.snapshot.alerts = [
      {
        id: randomUUID(),
        ts: now(),
        severity,
        title,
        detail,
      },
      ...this.snapshot.alerts,
    ].slice(0, 200);
  }

  private setRegime(regime: Regime, ceiling: number, stressSource: StressSource) {
    this.snapshot.regime = regime;
    this.snapshot.exposureCeilingGross = clamp01(ceiling);
    this.snapshot.stressSource = stressSource;
  }

  private setPillar(id: PillarId, patch: Partial<SystemSnapshot['pillars'][PillarId]>) {
    this.snapshot.pillars[id] = {
      ...this.snapshot.pillars[id],
      ...patch,
      updatedAt: now(),
    };
  }

  private phaseAgeSec() {
    return (now() - this.phaseT0) / 1000;
  }

  private tick() {
    const t = now();
    this.snapshot.ts = t;

    // Default mild drift
    for (const p of PILLARS) {
      const cur = this.snapshot.pillars[p.id];
      const drift = (Math.random() - 0.5) * 0.01;
      this.setPillar(p.id, {
        score: cur.score == null ? undefined : clamp01(cur.score + drift),
        confidence: cur.confidence == null ? undefined : clamp01(cur.confidence + (Math.random() - 0.5) * 0.01),
      });
    }

    // Scenario state machine
    const age = this.phaseAgeSec();
    switch (this.phase) {
      case 'CALM': {
        this.setRegime('RISK_ON', 0.9, 'GENERAL');
        this.setPillar('ARAS', { status: 'OK', headline: 'Risk-on; ceiling 90%', score: 0.18, confidence: 0.86 });
        this.setPillar('ARES', { status: 'SUSPENDED', headline: 'Monitoring (no re-entry needed)' });
        this.setPillar('SLOF', { status: 'ACTIVE', headline: 'Overlay permitted (bounded)' });
        if (age > 18) this.setPhase('BUILD_STRESS');
        break;
      }
      case 'BUILD_STRESS': {
        this.setRegime('NEUTRAL', 0.65, 'CORRELATED');
        this.setPillar('ARAS', { status: 'ACTIVE', headline: 'Stress building (correlated)', score: 0.55, confidence: 0.78 });
        this.setPillar('MACRO', { status: 'ACTIVE', headline: 'Liquidity ROC deteriorating', score: 0.62 });
        if (Math.random() < 0.08) this.pushAlert('watch', 'ARAS: correlated stress rising', 'Crypto + equity modules elevated within 0.15 → CORRELATED.');
        if (age > 25) this.setPhase('CIRCUIT_BREAK');
        break;
      }
      case 'CIRCUIT_BREAK': {
        this.setRegime('DEFENSIVE', 0.4, 'CORRELATED');
        this.setPillar('ARAS', { status: 'TRIGGERED', headline: 'Circuit breaker fired (one-way)', score: 0.78, confidence: 0.72 });
        this.setPillar('MASTER', { status: 'ACTIVE', headline: 'Pre-calculated orderbook executing' });
        this.pushAlert('critical', 'Circuit breaker: intraday deleverage', 'Auto-trigger tightened regime. Relaxation requires 2 daily confirmations + PM approval.');
        this.setPhase('DELEVERAGE');
        break;
      }
      case 'DELEVERAGE': {
        this.setRegime('DEFENSIVE', 0.35, 'CORRELATED');
        this.setPillar('KEVLAR', { status: 'ACTIVE', headline: 'Concentration caps enforced' });
        this.setPillar('PERM', { status: 'ACTIVE', headline: 'Profit protection active' });
        this.setPillar('SLOF', { status: 'SUSPENDED', headline: 'Overlay suspended (defensive)' });
        if (age > 18) this.setPhase('STABILIZE');
        break;
      }
      case 'STABILIZE': {
        this.setRegime('NEUTRAL', 0.55, 'GENERAL');
        this.setPillar('ARAS', { status: 'ACTIVE', headline: 'Stabilizing; waiting confirmations', score: 0.49, confidence: 0.81 });
        this.setPillar('MACRO', { status: 'ACTIVE', headline: 'Liquidity ROC flattening', score: 0.48 });
        if (age > 20) this.setPhase('ARES_GATES');
        break;
      }
      case 'ARES_GATES': {
        this.setRegime('NEUTRAL', 0.6, 'GENERAL');
        this.setPillar('ARES', { status: 'ACTIVE', headline: 'Gate checks in progress (1/3 → 2/3)' });
        if (Math.random() < 0.10) this.pushAlert('info', 'ARES gate update', 'Stress normalization passing; awaiting conviction gate.');
        if (age > 25) this.setPhase('REENTRY');
        break;
      }
      case 'REENTRY': {
        this.setRegime('RISK_ON', 0.85, 'GENERAL');
        this.setPillar('ARES', { status: 'TRIGGERED', headline: 'Re-entry window confirmed (3/3)' });
        this.setPillar('SLOF', { status: 'ACTIVE', headline: 'Overlay permitted (bounded)' });
        if (Math.random() < 0.08) this.pushAlert('watch', 'Re-entry authorized (PM)', 'Offensive actions require human authority; system prepared targets.');
        if (age > 25) this.setPhase('CALM');
        break;
      }
    }
  }
}

export const demoEngine = new Engine();
