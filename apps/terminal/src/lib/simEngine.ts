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
    this.pushAlert('info', `Phase → ${phase}`, 'Scenario controller', ['system', 'scenario']);
  }

  autoDemo() {
    // Story arc is driven by the phase state machine in tick().
    // Reset to CALM and let it progress naturally.
    this.setPhase('CALM');
    this.pushAlert('info', 'AUTO‑DEMO started', 'Scenario controller', ['system', 'scenario']);
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

  private pushAlert(
    severity: 'info' | 'watch' | 'critical',
    title: string,
    detail?: string,
    tags?: string[]
  ) {
    this.snapshot.alerts = [
      {
        id: randomUUID(),
        ts: now(),
        severity,
        title,
        detail,
        tags,
      },
      ...this.snapshot.alerts,
    ].slice(0, 200);
  }

  private setRegime(regime: Regime, ceiling: number, stressSource: StressSource) {
    this.snapshot.regime = regime;
    this.snapshot.exposureCeilingGross = clamp01(ceiling);
    this.snapshot.stressSource = stressSource;
  }

  private updateARASModules(patch: Partial<ARASModuleSignal>[]) {
    if (!this.snapshot.arasModules) return;
    // patch array must be same length/order as existing (spec order 1..6)
    this.snapshot.arasModules = this.snapshot.arasModules.map((m, i) => ({
      ...m,
      ...(patch[i] ?? {}),
    }));

    // apply cross-module rules (spec):
    // - stress source detection
    const cryptoIdx = [1, 5]; // modules 2,6
    const equityIdx = [2, 3, 4]; // modules 3,4,5
    const cryptoAvg = cryptoIdx.reduce((a, idx) => a + this.snapshot.arasModules![idx].risk_score, 0) / cryptoIdx.length;
    const equityAvg = equityIdx.reduce((a, idx) => a + this.snapshot.arasModules![idx].risk_score, 0) / equityIdx.length;
    if (cryptoAvg > 0.5 && equityAvg > 0.5 && Math.abs(cryptoAvg - equityAvg) <= 0.15) {
      this.snapshot.stressSource = 'CORRELATED';
    } else if (cryptoAvg - equityAvg > 0.15) {
      this.snapshot.stressSource = 'CRYPTO';
    } else if (equityAvg - cryptoAvg > 0.15) {
      this.snapshot.stressSource = 'EQUITY';
    } else {
      this.snapshot.stressSource = 'GENERAL';
    }

    // - 3+ stress flags => force CRASH (regime override)
    const stressCount = this.snapshot.arasModules.filter((x) => x.stress_flag).length;
    if (stressCount >= 3) {
      this.snapshot.regime = 'CRASH';
      this.snapshot.exposureCeilingGross = Math.min(this.snapshot.exposureCeilingGross, 0.15);
    }

    // Keep ARAS pillar summary consistent
    const aras = this.snapshot.pillars.ARAS;
    const composite = clamp01(
      this.snapshot.arasModules.reduce((a, m) => a + m.risk_score * m.confidence * (m.stress_flag ? 1.5 : 1.0), 0) /
        this.snapshot.arasModules.reduce((a, m) => a + m.confidence, 0)
    );
    this.snapshot.pillars.ARAS = {
      ...aras,
      score: composite,
      confidence: clamp01(this.snapshot.arasModules.reduce((a, m) => a + m.confidence, 0) / this.snapshot.arasModules.length),
    };
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

    // Default mild drift (kept small so scenario deltas are readable)
    for (const p of PILLARS) {
      const cur = this.snapshot.pillars[p.id];
      const drift = (Math.random() - 0.5) * 0.01;
      this.setPillar(p.id, {
        score: cur.score == null ? undefined : clamp01(cur.score + drift),
        confidence: cur.confidence == null ? undefined : clamp01(cur.confidence + (Math.random() - 0.5) * 0.01),
      });
    }

    const setGates = (g: Partial<ARESGateStatus>) => {
      this.snapshot.aresGates = {
        ...(this.snapshot.aresGates ?? {
          gate1_stress_normalization: 'WAIT',
          gate2_conviction: 'WAIT',
          gate3_confirmation: 'WAIT',
        }),
        ...g,
      };
    };

    // Scenario state machine
    const age = this.phaseAgeSec();
    switch (this.phase) {
      case 'CALM': {
        this.setRegime('RISK_ON', 0.9, 'GENERAL');

        this.updateARASModules([
          { risk_score: 0.18, stress_flag: false, confidence: 0.88 },
          { risk_score: 0.16, stress_flag: false, confidence: 0.86 },
          { risk_score: 0.14, stress_flag: false, confidence: 0.84 },
          { risk_score: 0.15, stress_flag: false, confidence: 0.83 },
          { risk_score: 0.17, stress_flag: false, confidence: 0.82 },
          { risk_score: 0.08, stress_flag: false, confidence: 0.80 },
        ]);

        setGates({ gate1_stress_normalization: 'WAIT', gate2_conviction: 'WAIT', gate3_confirmation: 'WAIT' });

        this.setPillar('ARAS', { status: 'OK', headline: 'Risk-on; ceiling 90%' });
        this.setPillar('ARES', { status: 'SUSPENDED', headline: 'Monitoring (no re-entry needed)' });
        this.setPillar('SLOF', { status: 'ACTIVE', headline: 'Overlay permitted (bounded)' });

        if (age > 18) this.setPhase('BUILD_STRESS');
        break;
      }

      case 'BUILD_STRESS': {
        this.setRegime('NEUTRAL', 0.65, 'CORRELATED');

        this.updateARASModules([
          { risk_score: 0.46, stress_flag: false, confidence: 0.86 },
          { risk_score: 0.56, stress_flag: true, confidence: 0.83 },
          { risk_score: 0.54, stress_flag: true, confidence: 0.78 },
          { risk_score: 0.51, stress_flag: true, confidence: 0.77 },
          { risk_score: 0.49, stress_flag: false, confidence: 0.79 },
          { risk_score: 0.53, stress_flag: true, confidence: 0.76 },
        ]);

        // gates still waiting during stress build
        setGates({ gate1_stress_normalization: 'WAIT', gate2_conviction: 'WAIT', gate3_confirmation: 'WAIT' });

        this.setPillar('ARAS', { status: 'ACTIVE', headline: 'Stress building (correlated)' });
        this.setPillar('MACRO', { status: 'ACTIVE', headline: 'Liquidity ROC deteriorating', score: 0.62 });

        if (Math.random() < 0.12)
          this.pushAlert(
            'watch',
            'ARAS: correlated stress rising',
            'Crypto + equity modules elevated within 0.15 → CORRELATED.',
            ['pillar:ARAS', 'scenario']
          );

        if (age > 25) this.setPhase('CIRCUIT_BREAK');
        break;
      }

      case 'CIRCUIT_BREAK': {
        // updateARASModules will enforce CRASH/ceiling if 3+ stress flags
        this.updateARASModules([
          { risk_score: 0.72, stress_flag: true, confidence: 0.78 },
          { risk_score: 0.79, stress_flag: true, confidence: 0.74 },
          { risk_score: 0.82, stress_flag: true, confidence: 0.70 },
          { risk_score: 0.76, stress_flag: true, confidence: 0.69 },
          { risk_score: 0.74, stress_flag: true, confidence: 0.71 },
          { risk_score: 0.68, stress_flag: true, confidence: 0.68 },
        ]);

        // In circuit break we hard-cap regardless
        this.setRegime('DEFENSIVE', Math.min(this.snapshot.exposureCeilingGross, 0.4), this.snapshot.stressSource);

        this.setPillar('ARAS', { status: 'TRIGGERED', headline: 'Circuit breaker fired (one-way)' });
        this.setPillar('MASTER', { status: 'ACTIVE', headline: 'Pre-calculated orderbook executing' });

        this.pushAlert(
          'critical',
          'Circuit breaker: intraday deleverage',
          'Auto-trigger tightened regime. Relaxation requires 2 daily confirmations + PM approval.',
          ['pillar:ARAS', 'pillar:MASTER', 'scenario']
        );

        this.setPhase('DELEVERAGE');
        break;
      }

      case 'DELEVERAGE': {
        this.setRegime('DEFENSIVE', 0.35, this.snapshot.stressSource);

        // stress still high, but tapering
        this.updateARASModules([
          { risk_score: 0.58, stress_flag: true, confidence: 0.80 },
          { risk_score: 0.62, stress_flag: true, confidence: 0.77 },
          { risk_score: 0.60, stress_flag: true, confidence: 0.74 },
          { risk_score: 0.57, stress_flag: true, confidence: 0.73 },
          { risk_score: 0.52, stress_flag: false, confidence: 0.76 },
          { risk_score: 0.55, stress_flag: true, confidence: 0.72 },
        ]);

        this.setPillar('KEVLAR', { status: 'ACTIVE', headline: 'Concentration caps enforced' });
        this.setPillar('PERM', { status: 'ACTIVE', headline: 'Profit protection active' });
        this.setPillar('SLOF', { status: 'SUSPENDED', headline: 'Overlay suspended (defensive)' });

        if (age > 18) this.setPhase('STABILIZE');
        break;
      }

      case 'STABILIZE': {
        this.setRegime('NEUTRAL', 0.55, 'GENERAL');

        this.updateARASModules([
          { risk_score: 0.34, stress_flag: false, confidence: 0.86 },
          { risk_score: 0.33, stress_flag: false, confidence: 0.85 },
          { risk_score: 0.31, stress_flag: false, confidence: 0.83 },
          { risk_score: 0.30, stress_flag: false, confidence: 0.82 },
          { risk_score: 0.29, stress_flag: false, confidence: 0.83 },
          { risk_score: 0.28, stress_flag: false, confidence: 0.82 },
        ]);

        this.setPillar('ARAS', { status: 'ACTIVE', headline: 'Stabilizing; waiting confirmations' });
        this.setPillar('MACRO', { status: 'ACTIVE', headline: 'Liquidity ROC flattening', score: 0.48 });

        // Gate 1 begins to flip as stress normalizes
        setGates({ gate1_stress_normalization: age > 10 ? 'PASS' : 'WAIT', gate2_conviction: 'WAIT', gate3_confirmation: 'WAIT' });

        if (age > 20) this.setPhase('ARES_GATES');
        break;
      }

      case 'ARES_GATES': {
        this.setRegime('NEUTRAL', 0.6, 'GENERAL');

        // ARAS calm enough to allow gates to proceed
        this.updateARASModules([
          { risk_score: 0.26, stress_flag: false, confidence: 0.88 },
          { risk_score: 0.25, stress_flag: false, confidence: 0.87 },
          { risk_score: 0.22, stress_flag: false, confidence: 0.85 },
          { risk_score: 0.23, stress_flag: false, confidence: 0.84 },
          { risk_score: 0.24, stress_flag: false, confidence: 0.84 },
          { risk_score: 0.20, stress_flag: false, confidence: 0.83 },
        ]);

        // Gate progression for demo (timed, deterministic)
        setGates({
          gate1_stress_normalization: 'PASS',
          gate2_conviction: age > 10 ? 'PASS' : 'WAIT',
          gate3_confirmation: age > 18 ? 'PASS' : 'WAIT',
        });

        const passCount = Object.values(this.snapshot.aresGates ?? {}).filter((x) => x === 'PASS').length;
        this.setPillar('ARES', {
          status: passCount >= 3 ? 'TRIGGERED' : 'ACTIVE',
          headline: passCount >= 3 ? 'Gates passed (3/3) — ready' : `Gate checks in progress (${passCount}/3)`,
        });

        if (Math.random() < 0.10)
          this.pushAlert('info', 'ARES gate update', 'Stress normalization passing; awaiting conviction/confirmation.', [
            'pillar:ARES',
            'scenario',
          ]);

        if (age > 25) this.setPhase('REENTRY');
        break;
      }

      case 'REENTRY': {
        this.setRegime('RISK_ON', 0.85, 'GENERAL');

        setGates({ gate1_stress_normalization: 'PASS', gate2_conviction: 'PASS', gate3_confirmation: 'PASS' });

        this.setPillar('ARES', { status: 'TRIGGERED', headline: 'Re-entry window confirmed (3/3)' });
        this.setPillar('SLOF', { status: 'ACTIVE', headline: 'Overlay permitted (bounded)' });

        if (Math.random() < 0.08)
          this.pushAlert(
            'watch',
            'Re-entry authorized (PM)',
            'Offensive actions require human authority; system prepared targets.',
            ['pillar:ARES', 'pillar:SLOF', 'scenario']
          );

        if (age > 25) this.setPhase('CALM');
        break;
      }
    }
  }
}

export const demoEngine = new Engine();
