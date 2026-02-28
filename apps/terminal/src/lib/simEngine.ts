import { randomUUID } from 'crypto';
import type {
  ARESGateStatus,
  ARASModuleSignal,
  PillarId,
  PillarSignal,
  PortfolioPosition,
  PortfolioSnapshot,
  Regime,
  Sleeve,
  StressSource,
  SystemSnapshot,
} from './types';

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

type ScenarioId = 'S1' | 'S2' | 'S3';

// NOTE: In the playbook, the core ceiling applies to Eq+Crypto gross; defense sleeve is structural (14%)
// and is exempt from deleveraging. The demo header still shows a single gross number; portfolio panel
// shows the playbook decomposition.
const SPEC_EQCR_CEILINGS: Record<Regime, number> = {
  RISK_ON: 1.0,
  NEUTRAL: 0.70,
  DEFENSIVE: 0.40,
  CRASH: 0.15,
};

// Header ceiling used by the cockpit (kept for now as a single number).
const SPEC_CEILINGS: Record<Regime, number> = {
  RISK_ON: 1.10, // base 100% + synthetic overlay headroom (demo)
  NEUTRAL: 0.70,
  DEFENSIVE: 0.40,
  CRASH: 0.15,
};

const SPEC_SLOF_MAX_BY_REGIME: Record<Regime, number> = {
  RISK_ON: 0.20,
  NEUTRAL: 0.10,
  DEFENSIVE: 0.0,
  CRASH: 0.0,
};

const ARCH_AB_TARGET_SLEEVES = {
  equity: 0.58,
  crypto: 0.20,
  defense: 0.14,
  cashOptions: 0.08,
} as const;

// Minimal, spec-aligned target weights (sums within sleeves; this drives demo positions table).
const TARGET_EQUITY: Array<{ ticker: string; pct: number; conviction?: number; slofEligible?: boolean; tranche?: 1 | 2 | 3 | 4 }> = [
  { ticker: 'TSLA', pct: 0.088, conviction: 10, slofEligible: true, tranche: 1 },
  { ticker: 'NVDA', pct: 0.088, conviction: 10, slofEligible: true, tranche: 1 },
  { ticker: 'AMD', pct: 0.072, conviction: 9, slofEligible: false, tranche: 2 },
  { ticker: 'MU', pct: 0.057, conviction: 8, slofEligible: false, tranche: 2 },
  { ticker: 'PLTR', pct: 0.057, conviction: 8, slofEligible: false, tranche: 2 },
  { ticker: 'ALAB', pct: 0.057, conviction: 8, slofEligible: false, tranche: 2 },
  { ticker: 'MRVL', pct: 0.043, conviction: 7, slofEligible: false, tranche: 3 },
  { ticker: 'ANET', pct: 0.043, conviction: 7, slofEligible: false, tranche: 3 },
  { ticker: 'AVGO', pct: 0.043, conviction: 7, slofEligible: false, tranche: 3 },
  { ticker: 'ARM', pct: 0.032, conviction: 6, slofEligible: false, tranche: 3 },
];

const TARGET_CRYPTO: Array<{ ticker: string; pct: number; tranche?: 1 | 2 | 3 | 4 }> = [
  { ticker: 'IBIT', pct: 0.16, tranche: 1 },
  { ticker: 'BSOL', pct: 0.04, tranche: 3 },
];

const TARGET_DEFENSE: Array<{ ticker: string; pct: number }> = [
  { ticker: 'TLT', pct: 0.07 },
  { ticker: 'SGOL', pct: 0.04 },
  { ticker: 'DBMF', pct: 0.03 },
];

function sumPct(xs: Array<{ pct: number }>) {
  return xs.reduce((a, x) => a + x.pct, 0);
}

function normalizeTo<T extends { pct: number }>(xs: T[], total: number): T[] {
  const s = sumPct(xs) || 1;
  return xs.map((x) => ({ ...(x as object), pct: (x.pct / s) * total }) as T);
}

function bySleeveWeights(regime: Regime, eqCrCeiling: number) {
  const eqShare = ARCH_AB_TARGET_SLEEVES.equity / (ARCH_AB_TARGET_SLEEVES.equity + ARCH_AB_TARGET_SLEEVES.crypto);
  const crShare = 1 - eqShare;
  return {
    equity: eqCrCeiling * eqShare,
    crypto: eqCrCeiling * crShare,
    defense: ARCH_AB_TARGET_SLEEVES.defense,
    cashOptions: Math.max(0, 1 - (eqCrCeiling + ARCH_AB_TARGET_SLEEVES.defense)),
  };
}

function buildPositions(opts: {
  regime: Regime;
  stressSource: StressSource;
  eqCrCeiling: number;
  reentry?: { pmApproved: boolean; tranche: 0 | 1 | 2 | 3 | 4; trancheCeiling: number };
}): PortfolioPosition[] {
  const { regime, stressSource } = opts;

  // Determine current Eq+Cr ceiling for allocation.
  const effEqCr = opts.reentry ? opts.reentry.trancheCeiling : opts.eqCrCeiling;

  // Sleeve weights under the ceiling.
  const sleeves = bySleeveWeights(regime, effEqCr);

  const eqTargets = normalizeTo(TARGET_EQUITY, sleeves.equity);
  const crTargets = normalizeTo(TARGET_CRYPTO, sleeves.crypto);

  // Apply source-targeted cuts during stress (very simplified: reduce only the stressed sleeve).
  const cuts = SPEC_SOURCE_TARGETED_CUTS[stressSource];

  const applyCut = (sleeve: Sleeve, base: number) => {
    if (sleeve === 'CRYPTO') return base * (regime === 'CRASH' || regime === 'DEFENSIVE' ? (1 - cuts.cryptoCut) : 1);
    if (sleeve === 'EQUITY') return base * (regime === 'CRASH' || regime === 'DEFENSIVE' ? (1 - cuts.equityCut) : 1);
    return base;
  };

  // Re-entry tranche gating: positions in later tranches are 0 until tranche reached.
  const tranche = opts.reentry?.tranche ?? 0;
  const trancheAllows = (pTranche?: 1 | 2 | 3 | 4) => {
    if (!pTranche) return true;
    if (!opts.reentry) return true;
    if (!opts.reentry.pmApproved) return false;
    return tranche >= pTranche;
  };

  const eq = eqTargets.map((x) => ({
    ticker: x.ticker,
    sleeve: 'EQUITY' as const,
    conviction: x.conviction,
    slofEligible: x.slofEligible,
    tranche: x.tranche,
    targetPct: x.pct,
    currentPct: trancheAllows(x.tranche) ? applyCut('EQUITY', x.pct) : 0,
    reason: opts.reentry ? 'ARES re-entry' : regime === 'RISK_ON' ? 'Normal allocation' : 'Ceiling + cuts',
  }));

  const cr = crTargets.map((x) => ({
    ticker: x.ticker,
    sleeve: 'CRYPTO' as const,
    tranche: x.tranche,
    targetPct: x.pct,
    currentPct: trancheAllows(x.tranche) ? applyCut('CRYPTO', x.pct) : 0,
    reason: opts.reentry ? 'ARES re-entry' : regime === 'RISK_ON' ? 'Normal allocation' : 'Ceiling + cuts',
  }));

  const def = TARGET_DEFENSE.map((x) => ({
    ticker: x.ticker,
    sleeve: 'DEFENSE' as const,
    targetPct: x.pct,
    currentPct: x.pct, // structural + exempt in demo
    reason: 'Structural defense (exempt)',
  }));

  const cash = [{
    ticker: 'CASH+OPT',
    sleeve: 'CASH_OPTIONS' as const,
    targetPct: ARCH_AB_TARGET_SLEEVES.cashOptions,
    currentPct: bySleeveWeights(regime, effEqCr).cashOptions,
    reason: 'Cash + options sleeve',
  }];

  return [...eq, ...cr, ...def, ...cash].sort((a, b) => b.currentPct - a.currentPct);
}

function buildPortfolioSnapshot(opts: {
  regime: Regime;
  stressSource: StressSource;
  reentry?: { pmApproved: boolean; tranche: 0 | 1 | 2 | 3 | 4; trancheCeiling: number };
}): PortfolioSnapshot {
  const eqCrCeiling = opts.reentry ? opts.reentry.trancheCeiling : SPEC_EQCR_CEILINGS[opts.regime];
  const sleeves = bySleeveWeights(opts.regime, eqCrCeiling);
  return {
    targetSleeves: { ...ARCH_AB_TARGET_SLEEVES },
    sleeves,
    eqCryptoCeiling: eqCrCeiling,
    slofMax: SPEC_SLOF_MAX_BY_REGIME[opts.regime],
    reentry: opts.reentry,
    positions: buildPositions({ regime: opts.regime, stressSource: opts.stressSource, eqCrCeiling, reentry: opts.reentry }),
  };
}

const SPEC_SOURCE_TARGETED_CUTS: Record<StressSource, { cryptoCut: number; equityCut: number; defenseCut: number }> = {
  CRYPTO: { cryptoCut: 0.80, equityCut: 0.40, defenseCut: 0.0 },
  EQUITY: { cryptoCut: 0.30, equityCut: 0.80, defenseCut: 0.0 },
  GENERAL: { cryptoCut: 0.70, equityCut: 0.70, defenseCut: 0.0 },
  CORRELATED: { cryptoCut: 0.80, equityCut: 0.70, defenseCut: 0.0 },
};


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

// Exposure ceilings can exceed 100% gross in RISK_ON due to SLOF synthetic overlay allowance.
// Clamp to a reasonable demo max rather than 1.0.
function clampCeiling(x: number) {
  return Math.max(0, Math.min(1.2, x));
}

function levelFromScore(score: number): PillarSignal['level'] {
  if (score >= 0.7) return 'RISK';
  if (score >= 0.45) return 'WATCH';
  return 'OK';
}

class Engine {
  private snapshot: SystemSnapshot;

  // Legacy phase-driven arc (kept for dev forcing)
  private phase: Phase = 'CALM';
  private phaseT0 = now();

  // Deterministic scenario playback (S1/S2/S3)
  private scenarioId: ScenarioId | null = null;
  private scenarioT0 = now();
  private scenarioLastStep: Phase | null = null;

  // PM approval + tranche deployment (ARES)
  private pmReentryApproved = false;
  private pmReentryApprovedAt: number | null = null;

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

  setScenario(scenarioId: ScenarioId) {
    this.scenarioId = scenarioId;
    this.scenarioT0 = now();
    this.scenarioLastStep = null;

    // Reset PM approval / tranche state on new scenario.
    this.pmReentryApproved = false;
    this.pmReentryApprovedAt = null;

    this.pushAlert('info', `Scenario → ${scenarioId}`, 'Scenario controller', ['system', 'scenario']);
  }

  clearScenario() {
    this.scenarioId = null;
    this.scenarioLastStep = null;
    this.pmReentryApproved = false;
    this.pmReentryApprovedAt = null;
    this.pushAlert('info', 'Scenario cleared', 'Scenario controller', ['system', 'scenario']);
  }

  autoDemo() {
    // Demo mode: start the main scenario (S3 is the most complete story arc for investors).
    this.setScenario('S3');
    this.pushAlert('info', 'AUTO‑DEMO started', 'Scenario controller', ['system', 'scenario']);
  }

  approveReentry() {
    this.pmReentryApproved = true;
    this.pmReentryApprovedAt = now();
    this.pushAlert('watch', 'Re-entry approved (PM)', 'Deployment will occur in tranches per ARES protocol.', [
      'pillar:ARES',
      'pillar:MASTER',
      'scenario',
    ]);
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

    const mk = (name: string, valueText: string, score: number, confidence: number): PillarSignal => ({
      name,
      valueText,
      score: clamp01(score),
      confidence: clamp01(confidence),
      level: levelFromScore(score),
    });

    return {
      ts: t,
      regime: 'RISK_ON',
      exposureCeilingGross: SPEC_CEILINGS.RISK_ON,
      stressSource: 'GENERAL',
      arasModules,
      aresGates,

      macroSignals: [mk('Liquidity ROC', 'flat', 0.22, 0.78), mk('Vol regime', 'low', 0.18, 0.82), mk('Rates impulse', 'benign', 0.16, 0.74)],
      masterSignals: [mk('Execution mode', 'normal', 0.20, 0.84), mk('Slippage est.', '6 bps', 0.18, 0.76), mk('Kill-switch', 'armed', 0.12, 0.92)],
      kevlarSignals: [mk('Concentration caps', 'nominal', 0.18, 0.86), mk('DD guard', 'nominal', 0.16, 0.82), mk('Sector skew', 'ok', 0.20, 0.78)],
      permSignals: [mk('Profit lock', 'inactive', 0.14, 0.80), mk('Trail stops', 'inactive', 0.12, 0.76), mk('TP ladder', 'inactive', 0.10, 0.74)],
      slofSignals: [mk('Overlay eligibility', 'allowed', 0.16, 0.82), mk('Sizing envelope', 'normal', 0.18, 0.78), mk('Blocked reason', '—', 0.05, 0.90)],

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
    this.snapshot.exposureCeilingGross = clampCeiling(ceiling);
    this.snapshot.stressSource = stressSource;
  }

  private updateARASModules(patch: Partial<ARASModuleSignal>[]) {
    if (!this.snapshot.arasModules) return;

    const prev = this.snapshot.arasModules;

    // patch array must be same length/order as existing (spec order 1..6)
    const next = this.snapshot.arasModules.map((m, i) => ({
      ...m,
      ...(patch[i] ?? {}),
    }));

    // Emit events on per-module stress_flag flips and risk thresholds
    for (let i = 0; i < next.length; i++) {
      const p = prev[i];
      const n = next[i];
      if (!p || !n) continue;

      if (p.stress_flag !== n.stress_flag) {
        const sev = n.stress_flag ? 'watch' : 'info';
        const title = `ARAS m${i + 1}: ${n.name} stress_flag → ${n.stress_flag ? 'ON' : 'off'}`;
        const detail = `risk ${n.risk_score.toFixed(2)} · conf ${n.confidence.toFixed(2)} · bucket ${n.source_bucket}`;
        this.pushAlert(sev, title, detail, ['pillar:ARAS', 'module']);
      }

      // risk threshold crossing at 0.65
      const th = 0.65;
      const wasHigh = p.risk_score >= th;
      const isHigh = n.risk_score >= th;
      if (wasHigh !== isHigh) {
        const sev = isHigh ? 'critical' : 'info';
        const title = `ARAS m${i + 1}: ${n.name} risk ${isHigh ? '≥' : '<'} ${th}`;
        const detail = `risk ${p.risk_score.toFixed(2)} → ${n.risk_score.toFixed(2)} · conf ${n.confidence.toFixed(2)}`;
        this.pushAlert(sev, title, detail, ['pillar:ARAS', 'module']);
      }
    }

    this.snapshot.arasModules = next;

    // apply cross-module rules (spec):
    // - stress source detection
    const cryptoIdx = [1, 5]; // modules 2,6
    const equityIdx = [2, 3, 4]; // modules 3,4,5
    const cryptoAvg = cryptoIdx.reduce((a, idx) => a + this.snapshot.arasModules![idx].risk_score, 0) / cryptoIdx.length;
    const equityAvg = equityIdx.reduce((a, idx) => a + this.snapshot.arasModules![idx].risk_score, 0) / equityIdx.length;
    const prevSource = this.snapshot.stressSource;
    if (cryptoAvg > 0.5 && equityAvg > 0.5 && Math.abs(cryptoAvg - equityAvg) <= 0.15) {
      this.snapshot.stressSource = 'CORRELATED';
    } else if (cryptoAvg - equityAvg > 0.15) {
      this.snapshot.stressSource = 'CRYPTO';
    } else if (equityAvg - cryptoAvg > 0.15) {
      this.snapshot.stressSource = 'EQUITY';
    } else {
      this.snapshot.stressSource = 'GENERAL';
    }
    if (prevSource !== this.snapshot.stressSource) {
      this.pushAlert(
        'watch',
        `ARAS: stressSource → ${this.snapshot.stressSource}`,
        `cryptoAvg ${cryptoAvg.toFixed(2)} · equityAvg ${equityAvg.toFixed(2)}`,
        ['pillar:ARAS', 'module']
      );
    }

    // - 3+ stress flags => force CRASH (regime override)
    const stressCount = this.snapshot.arasModules.filter((x) => x.stress_flag).length;
    const prevRegime = this.snapshot.regime;
    const prevCeil = this.snapshot.exposureCeilingGross;
    if (stressCount >= 3) {
      this.snapshot.regime = 'CRASH';
      this.snapshot.exposureCeilingGross = Math.min(this.snapshot.exposureCeilingGross, 0.15);
    }
    if (prevRegime !== this.snapshot.regime || prevCeil !== this.snapshot.exposureCeilingGross) {
      this.pushAlert(
        'critical',
        'ARAS: crash override',
        `stress_flags ${stressCount} · regime ${prevRegime} → ${this.snapshot.regime} · ceiling ${prevCeil.toFixed(2)} → ${this.snapshot.exposureCeilingGross.toFixed(2)}`,
        ['pillar:ARAS', 'module']
      );
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

  private setSignals(
    key: 'macroSignals' | 'masterSignals' | 'kevlarSignals' | 'permSignals' | 'slofSignals',
    signals: Array<Omit<PillarSignal, 'level'> & { level?: PillarSignal['level'] }>
  ) {
    const pillarByKey: Record<typeof key, PillarId> = {
      macroSignals: 'MACRO',
      masterSignals: 'MASTER',
      kevlarSignals: 'KEVLAR',
      permSignals: 'PERM',
      slofSignals: 'SLOF',
    };

    const pillar = pillarByKey[key];
    const prev = (this.snapshot[key] ?? []) as PillarSignal[];

    // Normalize + derive level if omitted
    const next = signals.map((s) => {
      const score = clamp01(s.score);
      const confidence = clamp01(s.confidence);
      return {
        name: s.name,
        valueText: s.valueText,
        score,
        confidence,
        level: s.level ?? levelFromScore(score),
      } satisfies PillarSignal;
    });

    // Emit events when signal level changes (OK ↔ WATCH ↔ RISK)
    for (const s of next) {
      const p = prev.find((x) => x.name === s.name);
      if (!p) continue;
      if (p.level === s.level) continue;

      const sev = s.level === 'RISK' ? 'critical' : s.level === 'WATCH' ? 'watch' : 'info';
      const title = `${pillar}: ${s.name} → ${s.level}`;
      const detail = `${p.level} → ${s.level} · ${s.valueText} · score ${s.score.toFixed(2)} · conf ${s.confidence.toFixed(2)}`;
      this.pushAlert(sev, title, detail, [`pillar:${pillar}`, 'signal']);
    }

    this.snapshot[key] = next;

    // Recompute the pillar summary from its signals (spec-shape: pillar is derived, not scripted)
    const worst = next.reduce<PillarSignal['level']>((acc, s) => {
      if (acc === 'RISK' || s.level === 'RISK') return 'RISK';
      if (acc === 'WATCH' || s.level === 'WATCH') return 'WATCH';
      return 'OK';
    }, 'OK');

    const scoreAgg = next.length ? next.reduce((a, s) => a + s.score * s.confidence, 0) / next.reduce((a, s) => a + s.confidence, 0) : 0;
    const confAgg = next.length ? next.reduce((a, s) => a + s.confidence, 0) / next.length : 0;

    const status = worst === 'RISK' ? 'TRIGGERED' : worst === 'WATCH' ? 'ACTIVE' : 'OK';

    this.setPillar(pillar, {
      status,
      score: clamp01(scoreAgg),
      confidence: clamp01(confAgg),
    });
  }

  private phaseAgeSec() {
    return (now() - this.phaseT0) / 1000;
  }

  private scenarioAgeSec() {
    return (now() - this.scenarioT0) / 1000;
  }

  private forcePhase(phase: Phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.phaseT0 = now();
    // Keep it quiet: we do not emit Phase→ alerts during scenario playback.
  }

  private scenarioPhaseFor(id: ScenarioId, tSec: number): Phase {
    // Deterministic timeline. We can refine durations later.
    const t = tSec;

    if (id === 'S1') {
      if (t < 15) return 'CALM';
      if (t < 45) return 'BUILD_STRESS';
      if (t < 60) return 'DELEVERAGE';
      if (t < 80) return 'STABILIZE';
      if (t < 95) return 'ARES_GATES';
      return 'REENTRY';
    }

    if (id === 'S2') {
      if (t < 12) return 'CALM';
      if (t < 40) return 'BUILD_STRESS';
      if (t < 58) return 'DELEVERAGE';
      if (t < 78) return 'STABILIZE';
      if (t < 92) return 'ARES_GATES';
      return 'REENTRY';
    }

    // S3: correlated crash + circuit break + recovery gates
    if (t < 12) return 'CALM';
    if (t < 34) return 'BUILD_STRESS';
    if (t < 44) return 'CIRCUIT_BREAK';
    if (t < 64) return 'DELEVERAGE';
    if (t < 84) return 'STABILIZE';
    if (t < 104) return 'ARES_GATES';
    return 'REENTRY';
  }

  private tick() {
    const t = now();
    this.snapshot.ts = t;

    // Portfolio/positions are recomputed at end of tick (after regime + re-entry state).
    // Scenario playback overrides the phase timeline (deterministic tapes).
    if (this.scenarioId) {
      const age = this.scenarioAgeSec();
      this.snapshot.scenarioId = this.scenarioId;
      this.snapshot.scenarioT = age;
      this.snapshot.scenarioName =
        this.scenarioId === 'S1'
          ? 'Risk-on → tightening → defensive cut'
          : this.scenarioId === 'S2'
            ? 'Crypto leverage unwind (crypto-dominant)'
            : 'Correlated crash + circuit-break + recovery gates';

      const phase = this.scenarioPhaseFor(this.scenarioId, age);
      this.snapshot.scenarioStep = phase;

      if (this.scenarioLastStep !== phase) {
        this.scenarioLastStep = phase;
        this.pushAlert('info', `Scenario step → ${phase}`, `Scenario ${this.scenarioId} @ ${Math.round(age)}s`, [
          'system',
          'scenario',
        ]);

        // Deterministic story beats for S3 (harmony): circuit breaker → kill-chain → gates → re-entry.
        if (this.scenarioId === 'S3') {
          if (phase === 'CIRCUIT_BREAK') {
            this.pushAlert(
              'critical',
              'Circuit breaker L3: QQQ -8% → CRASH (one-way)',
              'Regime tightened automatically. Circuit breakers can tighten only; relaxation requires 2 daily confirmations + PM approval.',
              ['scenario', 'kill-chain', 'pillar:ARAS', 'pillar:MASTER']
            );
          }

          if (phase === 'DELEVERAGE') {
            const cuts = SPEC_SOURCE_TARGETED_CUTS['CORRELATED'];
            this.pushAlert(
              'critical',
              'Kill-chain executing (target: 30 minutes)',
              `Priority: P1 remove ALL SLOF → P2 sell highest-beta equity → P3 reduce crypto → P4 trim remaining equity → P5 DO NOT TOUCH DAMPENER. Source=CORRELATED cuts: crypto ${(cuts.cryptoCut * 100).toFixed(0)}%, equity ${(cuts.equityCut * 100).toFixed(0)}%, defense exempt.`,
              ['scenario', 'kill-chain', 'pillar:MASTER']
            );
          }

          if (phase === 'ARES_GATES') {
            this.pushAlert('info', 'ARES: begin three-gate confirmation', 'Gate 1 stress normalization → Gate 2 conviction → Gate 3 confirmation. PM approval required for deployment.', [
              'scenario',
              'gate',
              'pillar:ARES',
            ]);
          }

          if (phase === 'REENTRY') {
            this.pushAlert('watch', 'Re-entry ready: PM approval required', 'Gates passed; deployment occurs in tranches over 2–3 trading days per ARES protocol.', [
              'scenario',
              'gate',
              'pillar:ARES',
              'pillar:MASTER',
            ]);
          }
        }
      }

      this.forcePhase(phase);
    } else {
      this.snapshot.scenarioId = undefined;
      this.snapshot.scenarioT = undefined;
      this.snapshot.scenarioName = undefined;
      this.snapshot.scenarioStep = undefined;
    }

    // Default mild drift (kept small so scenario deltas are readable)
    // IMPORTANT: Scenario playback must be deterministic. Disable drift when scenarioId is set.
    if (!this.scenarioId) {
      for (const p of PILLARS) {
        const cur = this.snapshot.pillars[p.id];
        const drift = (Math.random() - 0.5) * 0.01;
        this.setPillar(p.id, {
          score: cur.score == null ? undefined : clamp01(cur.score + drift),
          confidence: cur.confidence == null ? undefined : clamp01(cur.confidence + (Math.random() - 0.5) * 0.01),
        });
      }
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
        this.setRegime('RISK_ON', SPEC_CEILINGS.RISK_ON, 'GENERAL');

        this.updateARASModules([
          { risk_score: 0.18, stress_flag: false, confidence: 0.88 },
          { risk_score: 0.16, stress_flag: false, confidence: 0.86 },
          { risk_score: 0.14, stress_flag: false, confidence: 0.84 },
          { risk_score: 0.15, stress_flag: false, confidence: 0.83 },
          { risk_score: 0.17, stress_flag: false, confidence: 0.82 },
          { risk_score: 0.08, stress_flag: false, confidence: 0.80 },
        ]);

        setGates({ gate1_stress_normalization: 'WAIT', gate2_conviction: 'WAIT', gate3_confirmation: 'WAIT' });

        this.setSignals('macroSignals', [
          { name: 'Liquidity ROC', valueText: 'flat', score: 0.22, confidence: 0.78 },
          { name: 'Vol regime', valueText: 'low', score: 0.18, confidence: 0.82 },
          { name: 'Rates impulse', valueText: 'benign', score: 0.16, confidence: 0.74 },
          { name: 'Cross-asset corr', valueText: 'contained', score: 0.20, confidence: 0.76 },
        ]);
        this.setSignals('masterSignals', [
          { name: 'Execution mode', valueText: 'normal', score: 0.20, confidence: 0.84 },
          { name: 'Queue depth', valueText: 'healthy', score: 0.18, confidence: 0.80 },
          { name: 'Slippage est.', valueText: '6 bps', score: 0.18, confidence: 0.76 },
        ]);
        this.setSignals('kevlarSignals', [
          { name: 'Concentration caps', valueText: 'nominal', score: 0.18, confidence: 0.86 },
          { name: 'DD guard', valueText: 'nominal', score: 0.16, confidence: 0.82 },
          { name: 'Sector skew', valueText: 'ok', score: 0.20, confidence: 0.78 },
        ]);
        this.setSignals('permSignals', [
          { name: 'Profit lock', valueText: 'inactive', score: 0.14, confidence: 0.80 },
          { name: 'Trail stops', valueText: 'inactive', score: 0.12, confidence: 0.76 },
          { name: 'TP ladder', valueText: 'inactive', score: 0.10, confidence: 0.74 },
        ]);
        this.setSignals('slofSignals', [
          { name: 'Overlay eligibility', valueText: `allowed (≤ ${(SPEC_SLOF_MAX_BY_REGIME[this.snapshot.regime] * 100).toFixed(0)}%)`, score: 0.16, confidence: 0.82 },
          { name: 'Sizing envelope', valueText: 'normal', score: 0.18, confidence: 0.78 },
          { name: 'Blocked reason', valueText: '—', score: 0.05, confidence: 0.90 },
        ]);

        this.setPillar('ARAS', { status: 'OK', headline: `Risk-on; ceiling ${(SPEC_CEILINGS.RISK_ON * 100).toFixed(0)}%` });
        this.setPillar('MACRO', { headline: 'Liquidity stable' });
        this.setPillar('MASTER', { headline: 'Execution normal' });
        this.setPillar('KEVLAR', { headline: 'Caps nominal' });
        this.setPillar('PERM', { headline: 'Profit protection idle' });
        this.setPillar('SLOF', { headline: 'Overlay permitted (bounded)' });
        this.setPillar('ARES', { status: 'SUSPENDED', headline: 'Suspended (not in re-entry window)' });

        if (!this.scenarioId && age > 18) this.setPhase('BUILD_STRESS');
        break;
      }

      case 'BUILD_STRESS': {
        this.setRegime('NEUTRAL', SPEC_CEILINGS.NEUTRAL, this.scenarioId === 'S3' ? 'CORRELATED' : 'CORRELATED');

        this.updateARASModules([
          { risk_score: 0.46, stress_flag: false, confidence: 0.86 },
          { risk_score: 0.56, stress_flag: true, confidence: 0.83 },
          { risk_score: 0.54, stress_flag: true, confidence: 0.78 },
          { risk_score: 0.51, stress_flag: true, confidence: 0.77 },
          { risk_score: 0.49, stress_flag: false, confidence: 0.79 },
          { risk_score: 0.53, stress_flag: true, confidence: 0.76 },
        ]);

        this.setSignals('macroSignals', [
          { name: 'Liquidity ROC', valueText: 'down', score: 0.62, confidence: 0.76 },
          { name: 'Vol regime', valueText: 'rising', score: 0.55, confidence: 0.74 },
          { name: 'Rates impulse', valueText: 'tightening', score: 0.48, confidence: 0.70 },
          { name: 'Cross-asset corr', valueText: 'high', score: 0.64, confidence: 0.72 },
        ]);
        this.setSignals('masterSignals', [
          { name: 'Execution mode', valueText: 'defensive', score: 0.46, confidence: 0.78 },
          { name: 'Queue depth', valueText: 'thinning', score: 0.52, confidence: 0.72 },
          { name: 'Slippage est.', valueText: '18 bps', score: 0.56, confidence: 0.70 },
        ]);
        this.setSignals('kevlarSignals', [
          { name: 'Concentration caps', valueText: 'tightening', score: 0.52, confidence: 0.80 },
          { name: 'DD guard', valueText: 'watch', score: 0.48, confidence: 0.76 },
          { name: 'Sector skew', valueText: 'elevated', score: 0.50, confidence: 0.72 },
        ]);
        this.setSignals('permSignals', [
          { name: 'Profit lock', valueText: 'armed', score: 0.40, confidence: 0.78 },
          { name: 'Trail stops', valueText: 'armed', score: 0.38, confidence: 0.74 },
          { name: 'TP ladder', valueText: 'armed', score: 0.34, confidence: 0.72 },
        ]);
        this.setSignals('slofSignals', [
          { name: 'Overlay eligibility', valueText: `restricted (≤ ${(SPEC_SLOF_MAX_BY_REGIME[this.snapshot.regime] * 100).toFixed(0)}%)`, score: 0.52, confidence: 0.76 },
          { name: 'Sizing envelope', valueText: 'tight', score: 0.56, confidence: 0.74 },
          { name: 'Blocked reason', valueText: 'vol regime', score: 0.30, confidence: 0.82 },
        ]);

        // gates still waiting during stress build
        setGates({ gate1_stress_normalization: 'WAIT', gate2_conviction: 'WAIT', gate3_confirmation: 'WAIT' });

        this.setPillar('ARAS', { status: 'ACTIVE', headline: 'Stress building (correlated)' });
        this.setPillar('MACRO', { headline: 'Liquidity ROC deteriorating' });
        this.setPillar('MASTER', { headline: 'Execution defensive' });
        this.setPillar('KEVLAR', { headline: 'Caps tightening' });
        this.setPillar('PERM', { headline: 'Profit protection arming' });
        this.setPillar('SLOF', { headline: 'Overlay restricted' });

        if (!this.scenarioId && Math.random() < 0.12)
          this.pushAlert(
            'watch',
            'ARAS: correlated stress rising',
            'Crypto + equity modules elevated within 0.15 → CORRELATED.',
            ['pillar:ARAS', 'scenario']
          );
        if (!this.scenarioId && Math.random() < 0.10)
          this.pushAlert('watch', 'MACRO: liquidity deteriorating', 'Liquidity ROC down; cross-asset corr rising.', [
            'pillar:MACRO',
            'scenario',
          ]);

        if (!this.scenarioId && age > 25) this.setPhase('CIRCUIT_BREAK');
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

        this.setSignals('macroSignals', [
          { name: 'Liquidity ROC', valueText: 'breakdown', score: 0.82, confidence: 0.74 },
          { name: 'Vol regime', valueText: 'spike', score: 0.86, confidence: 0.72 },
          { name: 'Rates impulse', valueText: 'risk-off', score: 0.70, confidence: 0.66 },
          { name: 'Cross-asset corr', valueText: '1.0', score: 0.88, confidence: 0.70 },
        ]);
        this.setSignals('masterSignals', [
          { name: 'Execution mode', valueText: 'liquidate', score: 0.78, confidence: 0.80 },
          { name: 'Queue depth', valueText: 'thin', score: 0.74, confidence: 0.72 },
          { name: 'Slippage est.', valueText: '55 bps', score: 0.82, confidence: 0.68 },
        ]);
        this.setSignals('kevlarSignals', [
          { name: 'Concentration caps', valueText: 'hard', score: 0.76, confidence: 0.86 },
          { name: 'DD guard', valueText: 'active', score: 0.80, confidence: 0.82 },
          { name: 'Sector skew', valueText: 'forced unwind', score: 0.70, confidence: 0.70 },
        ]);
        this.setSignals('permSignals', [
          { name: 'Profit lock', valueText: 'engaged', score: 0.74, confidence: 0.78 },
          { name: 'Trail stops', valueText: 'active', score: 0.72, confidence: 0.74 },
          { name: 'TP ladder', valueText: 'disabled', score: 0.55, confidence: 0.70 },
        ]);
        this.setSignals('slofSignals', [
          { name: 'Overlay eligibility', valueText: `blocked (≤ ${(SPEC_SLOF_MAX_BY_REGIME[this.snapshot.regime] * 100).toFixed(0)}%)`, score: 0.86, confidence: 0.84 },
          { name: 'Sizing envelope', valueText: '0', score: 0.90, confidence: 0.86 },
          { name: 'Blocked reason', valueText: 'circuit breaker', score: 0.70, confidence: 0.92 },
        ]);

        // In circuit break, spec ceilings apply. For S3 we demonstrate a CRASH-level circuit-break tightening.
        if (this.scenarioId === 'S3') {
          this.setRegime('CRASH', SPEC_CEILINGS.CRASH, 'CORRELATED');
        } else {
          this.setRegime('DEFENSIVE', Math.min(this.snapshot.exposureCeilingGross, SPEC_CEILINGS.DEFENSIVE), this.snapshot.stressSource);
        }

        this.setPillar('ARAS', { status: 'TRIGGERED', headline: 'Circuit breaker fired (one-way)' });
        this.setPillar('MACRO', { headline: 'Macro shock (corr=1)' });
        this.setPillar('MASTER', { headline: 'Pre-calculated orderbook executing' });
        this.setPillar('KEVLAR', { headline: 'Hard caps engaged' });
        this.setPillar('PERM', { headline: 'Profit protection engaged' });
        this.setPillar('SLOF', { headline: 'Overlay blocked' });

        // Avoid duplicate circuit-breaker alerts during deterministic scenario playback (we emit story beats above).
        if (!this.scenarioId) {
          this.pushAlert(
            'critical',
            'Circuit breaker: intraday deleverage',
            'Auto-trigger tightened regime. Relaxation requires 2 daily confirmations + PM approval.',
            ['pillar:ARAS', 'pillar:MASTER', 'scenario']
          );
        }

        if (this.scenarioId) this.forcePhase('DELEVERAGE');
        else this.setPhase('DELEVERAGE');
        break;
      }

      case 'DELEVERAGE': {
        this.setRegime(this.scenarioId === 'S3' ? 'CRASH' : 'DEFENSIVE', this.scenarioId === 'S3' ? SPEC_CEILINGS.CRASH : 0.35, this.snapshot.stressSource);

        // stress still high, but tapering
        this.updateARASModules([
          { risk_score: 0.58, stress_flag: true, confidence: 0.80 },
          { risk_score: 0.62, stress_flag: true, confidence: 0.77 },
          { risk_score: 0.60, stress_flag: true, confidence: 0.74 },
          { risk_score: 0.57, stress_flag: true, confidence: 0.73 },
          { risk_score: 0.52, stress_flag: false, confidence: 0.76 },
          { risk_score: 0.55, stress_flag: true, confidence: 0.72 },
        ]);

        this.setSignals('macroSignals', [
          { name: 'Liquidity ROC', valueText: 'stressed', score: 0.64, confidence: 0.74 },
          { name: 'Vol regime', valueText: 'high', score: 0.70, confidence: 0.72 },
          { name: 'Rates impulse', valueText: 'risk-off', score: 0.56, confidence: 0.68 },
          { name: 'Cross-asset corr', valueText: 'elevated', score: 0.66, confidence: 0.70 },
        ]);
        this.setSignals('masterSignals', [
          { name: 'Execution mode', valueText: 'delever', score: 0.66, confidence: 0.82 },
          { name: 'Queue depth', valueText: 'recovering', score: 0.54, confidence: 0.74 },
          { name: 'Slippage est.', valueText: '28 bps', score: 0.60, confidence: 0.72 },
        ]);
        this.setSignals('kevlarSignals', [
          { name: 'Concentration caps', valueText: 'enforced', score: 0.62, confidence: 0.86 },
          { name: 'DD guard', valueText: 'active', score: 0.58, confidence: 0.82 },
          { name: 'Sector skew', valueText: 'reducing', score: 0.50, confidence: 0.74 },
        ]);
        this.setSignals('permSignals', [
          { name: 'Profit lock', valueText: 'active', score: 0.54, confidence: 0.80 },
          { name: 'Trail stops', valueText: 'active', score: 0.50, confidence: 0.76 },
          { name: 'TP ladder', valueText: 'paused', score: 0.38, confidence: 0.74 },
        ]);
        this.setSignals('slofSignals', [
          { name: 'Overlay eligibility', valueText: `blocked (≤ ${(SPEC_SLOF_MAX_BY_REGIME[this.snapshot.regime] * 100).toFixed(0)}%)`, score: 0.70, confidence: 0.86 },
          { name: 'Sizing envelope', valueText: 'tight', score: 0.60, confidence: 0.78 },
          { name: 'Blocked reason', valueText: 'defensive', score: 0.42, confidence: 0.84 },
        ]);

        this.setPillar('MACRO', { headline: 'Macro still stressed' });
        this.setPillar('MASTER', { headline: 'Deleveraging execution' });
        this.setPillar('KEVLAR', { headline: 'Concentration caps enforced' });
        this.setPillar('PERM', { headline: 'Profit protection active' });
        this.setPillar('SLOF', { headline: 'Overlay suspended (defensive)' });

        if (!this.scenarioId && Math.random() < 0.08)
          this.pushAlert('info', 'KEVLAR: caps enforced', 'Concentration + exposure caps actively constraining sizing.', [
            'pillar:KEVLAR',
            'scenario',
          ]);

        if (!this.scenarioId && age > 18) this.setPhase('STABILIZE');
        break;
      }

      case 'STABILIZE': {
        this.setRegime(this.scenarioId === 'S3' ? 'DEFENSIVE' : 'NEUTRAL', this.scenarioId === 'S3' ? SPEC_CEILINGS.DEFENSIVE : 0.55, 'GENERAL');

        this.updateARASModules([
          { risk_score: 0.34, stress_flag: false, confidence: 0.86 },
          { risk_score: 0.33, stress_flag: false, confidence: 0.85 },
          { risk_score: 0.31, stress_flag: false, confidence: 0.83 },
          { risk_score: 0.30, stress_flag: false, confidence: 0.82 },
          { risk_score: 0.29, stress_flag: false, confidence: 0.83 },
          { risk_score: 0.28, stress_flag: false, confidence: 0.82 },
        ]);

        this.setSignals('macroSignals', [
          { name: 'Liquidity ROC', valueText: 'flattening', score: 0.48, confidence: 0.78 },
          { name: 'Vol regime', valueText: 'falling', score: 0.40, confidence: 0.76 },
          { name: 'Rates impulse', valueText: 'neutral', score: 0.30, confidence: 0.72 },
          { name: 'Cross-asset corr', valueText: 'cooling', score: 0.38, confidence: 0.74 },
        ]);
        this.setSignals('masterSignals', [
          { name: 'Execution mode', valueText: 'normalize', score: 0.36, confidence: 0.82 },
          { name: 'Queue depth', valueText: 'improving', score: 0.34, confidence: 0.76 },
          { name: 'Slippage est.', valueText: '12 bps', score: 0.38, confidence: 0.74 },
        ]);
        this.setSignals('kevlarSignals', [
          { name: 'Concentration caps', valueText: 'active', score: 0.40, confidence: 0.84 },
          { name: 'DD guard', valueText: 'active', score: 0.36, confidence: 0.80 },
          { name: 'Sector skew', valueText: 'reducing', score: 0.32, confidence: 0.76 },
        ]);
        this.setSignals('permSignals', [
          { name: 'Profit lock', valueText: 'active', score: 0.34, confidence: 0.78 },
          { name: 'Trail stops', valueText: 'active', score: 0.30, confidence: 0.76 },
          { name: 'TP ladder', valueText: 'rebuilding', score: 0.26, confidence: 0.72 },
        ]);
        this.setSignals('slofSignals', [
          { name: 'Overlay eligibility', valueText: 'restricted', score: 0.40, confidence: 0.78 },
          { name: 'Sizing envelope', valueText: 'tight', score: 0.42, confidence: 0.76 },
          { name: 'Blocked reason', valueText: 'cooldown', score: 0.22, confidence: 0.82 },
        ]);

        this.setPillar('ARAS', { status: 'ACTIVE', headline: 'Stabilizing; waiting confirmations' });
        this.setPillar('MACRO', { headline: 'Liquidity ROC flattening' });
        this.setPillar('MASTER', { headline: 'Execution normalizing' });
        this.setPillar('KEVLAR', { headline: 'Caps remain active' });
        this.setPillar('PERM', { headline: 'Profit protection cooling' });
        this.setPillar('SLOF', { headline: 'Overlay cooldown' });

        // Gate 1 begins to flip as stress normalizes
        setGates({ gate1_stress_normalization: age > 10 ? 'PASS' : 'WAIT', gate2_conviction: 'WAIT', gate3_confirmation: 'WAIT' });

        if (!this.scenarioId && age > 20) this.setPhase('ARES_GATES');
        break;
      }

      case 'ARES_GATES': {
        this.setRegime('NEUTRAL', this.scenarioId === 'S3' ? SPEC_CEILINGS.NEUTRAL : 0.6, 'GENERAL');

        // ARAS calm enough to allow gates to proceed
        this.updateARASModules([
          { risk_score: 0.26, stress_flag: false, confidence: 0.88 },
          { risk_score: 0.25, stress_flag: false, confidence: 0.87 },
          { risk_score: 0.22, stress_flag: false, confidence: 0.85 },
          { risk_score: 0.23, stress_flag: false, confidence: 0.84 },
          { risk_score: 0.24, stress_flag: false, confidence: 0.84 },
          { risk_score: 0.20, stress_flag: false, confidence: 0.83 },
        ]);

        this.setSignals('macroSignals', [
          { name: 'Liquidity ROC', valueText: 'stable', score: 0.30, confidence: 0.82 },
          { name: 'Vol regime', valueText: 'normal', score: 0.26, confidence: 0.80 },
          { name: 'Rates impulse', valueText: 'neutral', score: 0.24, confidence: 0.76 },
          { name: 'Cross-asset corr', valueText: 'normal', score: 0.28, confidence: 0.78 },
        ]);
        this.setSignals('masterSignals', [
          { name: 'Execution mode', valueText: 'ready', score: 0.28, confidence: 0.84 },
          { name: 'Queue depth', valueText: 'healthy', score: 0.24, confidence: 0.80 },
          { name: 'Slippage est.', valueText: '10 bps', score: 0.28, confidence: 0.78 },
        ]);
        this.setSignals('kevlarSignals', [
          { name: 'Concentration caps', valueText: 'soft', score: 0.30, confidence: 0.84 },
          { name: 'DD guard', valueText: 'soft', score: 0.28, confidence: 0.82 },
          { name: 'Sector skew', valueText: 'ok', score: 0.24, confidence: 0.78 },
        ]);
        this.setSignals('permSignals', [
          { name: 'Profit lock', valueText: 'standby', score: 0.24, confidence: 0.78 },
          { name: 'Trail stops', valueText: 'standby', score: 0.22, confidence: 0.76 },
          { name: 'TP ladder', valueText: 'standby', score: 0.20, confidence: 0.74 },
        ]);
        this.setSignals('slofSignals', [
          { name: 'Overlay eligibility', valueText: `allowed (≤ ${(SPEC_SLOF_MAX_BY_REGIME[this.snapshot.regime] * 100).toFixed(0)}%)`, score: 0.22, confidence: 0.84 },
          { name: 'Sizing envelope', valueText: 'bounded', score: 0.26, confidence: 0.78 },
          { name: 'Blocked reason', valueText: '—', score: 0.05, confidence: 0.90 },
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

        this.setPillar('MACRO', { headline: 'Macro normalized (gate check)' });
        this.setPillar('MASTER', { headline: 'Execution ready' });
        this.setPillar('KEVLAR', { headline: 'Guards soft' });
        this.setPillar('PERM', { headline: 'Protection standby' });
        this.setPillar('SLOF', { headline: 'Overlay allowed (bounded)' });

        if (!this.scenarioId && Math.random() < 0.10)
          this.pushAlert('info', 'ARES gate update', 'Stress normalization passing; awaiting conviction/confirmation.', [
            'pillar:ARES',
            'scenario',
          ]);

        if (!this.scenarioId && age > 25) this.setPhase('REENTRY');
        break;
      }

      case 'REENTRY': {
        // Spec (PM Playbook §4): re-entry requires explicit PM approval and staged deployment (2–3 days).
        // ARES Spec: tranche ceilings 25/50/75/100 as confidence improves. In demo time we compress.

        if (this.scenarioId === 'S3' && !this.pmReentryApproved) {
          this.setRegime('NEUTRAL', SPEC_CEILINGS.NEUTRAL, 'GENERAL');
          this.setPillar('ARES', { status: 'TRIGGERED', headline: 'Re-entry ready — PM approval required' });
        } else if (this.scenarioId === 'S3' && this.pmReentryApproved) {
          const dt = this.pmReentryApprovedAt ? (now() - this.pmReentryApprovedAt) / 1000 : 0;
          // Compressed tranche schedule for demo: 0-10s=25%, 10-20s=50%, 20-30s=75%, 30s+=100%
          const tranche = dt < 10 ? 1 : dt < 20 ? 2 : dt < 30 ? 3 : 4;
          const ceiling = tranche === 1 ? 0.25 : tranche === 2 ? 0.5 : tranche === 3 ? 0.75 : 1.0;
          // Once we reach full re-entry (100%), we can return to RISK_ON + SLOF allowance.
          if (tranche < 4) {
            this.setRegime('NEUTRAL', ceiling, 'GENERAL');
            this.setPillar('ARES', { status: 'ACTIVE', headline: `Deploying tranches (T${tranche}/4) · ceiling ${Math.round(ceiling * 100)}%` });
          } else {
            this.setRegime('RISK_ON', SPEC_CEILINGS.RISK_ON, 'GENERAL');
            this.setPillar('ARES', { status: 'TRIGGERED', headline: 'Full re-entry (T4/4) — restored' });
          }
        } else {
          // Non-S3 paths keep legacy behavior.
          this.setRegime('RISK_ON', this.scenarioId === 'S3' ? SPEC_CEILINGS.RISK_ON : 0.85, 'GENERAL');
        }

        setGates({ gate1_stress_normalization: 'PASS', gate2_conviction: 'PASS', gate3_confirmation: 'PASS' });

        this.setSignals('macroSignals', [
          { name: 'Liquidity ROC', valueText: 'good', score: 0.22, confidence: 0.84 },
          { name: 'Vol regime', valueText: 'normal', score: 0.20, confidence: 0.82 },
          { name: 'Rates impulse', valueText: 'benign', score: 0.18, confidence: 0.78 },
          { name: 'Cross-asset corr', valueText: 'contained', score: 0.22, confidence: 0.80 },
        ]);
        this.setSignals('masterSignals', [
          { name: 'Execution mode', valueText: 'attack-ready', score: 0.26, confidence: 0.86 },
          { name: 'Queue depth', valueText: 'healthy', score: 0.22, confidence: 0.82 },
          { name: 'Slippage est.', valueText: '9 bps', score: 0.24, confidence: 0.80 },
        ]);
        this.setSignals('kevlarSignals', [
          { name: 'Concentration caps', valueText: 'soft', score: 0.24, confidence: 0.86 },
          { name: 'DD guard', valueText: 'soft', score: 0.22, confidence: 0.84 },
          { name: 'Sector skew', valueText: 'ok', score: 0.20, confidence: 0.78 },
        ]);
        this.setSignals('permSignals', [
          { name: 'Profit lock', valueText: 'standby', score: 0.20, confidence: 0.80 },
          { name: 'Trail stops', valueText: 'standby', score: 0.18, confidence: 0.78 },
          { name: 'TP ladder', valueText: 'standby', score: 0.16, confidence: 0.76 },
        ]);
        this.setSignals('slofSignals', [
          { name: 'Overlay eligibility', valueText: `allowed (≤ ${(SPEC_SLOF_MAX_BY_REGIME[this.snapshot.regime] * 100).toFixed(0)}%)`, score: 0.18, confidence: 0.86 },
          { name: 'Sizing envelope', valueText: 'bounded', score: 0.22, confidence: 0.80 },
          { name: 'Blocked reason', valueText: '—', score: 0.05, confidence: 0.90 },
        ]);

        // ARES pillar headline is managed above for S3 (PM approval + tranches).
        if (!(this.scenarioId === 'S3')) {
          this.setPillar('ARES', { status: 'TRIGGERED', headline: 'Re-entry window confirmed (3/3)' });
        }
        this.setPillar('SLOF', { headline: 'Overlay permitted (bounded)' });
        this.setPillar('MACRO', { headline: 'Macro risk contained' });
        this.setPillar('MASTER', { headline: 'Execution normal' });
        this.setPillar('KEVLAR', { headline: 'Guards soft' });
        this.setPillar('PERM', { headline: 'Protection standby' });

        if (!this.scenarioId && Math.random() < 0.08)
          this.pushAlert(
            'watch',
            'Re-entry authorized (PM)',
            'Offensive actions require human authority; system prepared targets.',
            ['pillar:ARES', 'pillar:SLOF', 'scenario']
          );

        if (!this.scenarioId && age > 25) this.setPhase('CALM');
        break;
      }
    }

    // Compute portfolio snapshot (positions / sleeves) from current regime + ARES re-entry state.
    const reentry =
      this.scenarioId === 'S3'
        ? {
            pmApproved: this.pmReentryApproved,
            tranche: (this.pmReentryApproved ? (this.snapshot.regime === 'RISK_ON' ? 4 : this.snapshot.exposureCeilingGross <= 0.26 ? 1 : this.snapshot.exposureCeilingGross <= 0.51 ? 2 : this.snapshot.exposureCeilingGross <= 0.76 ? 3 : 4) : 0) as 0 | 1 | 2 | 3 | 4,
            trancheCeiling: this.pmReentryApproved
              ? // If approved, use the current ceiling as tranche ceiling during compressed deployment.
                Math.min(1.0, Math.max(0.25, this.snapshot.exposureCeilingGross))
              : SPEC_EQCR_CEILINGS.NEUTRAL,
          }
        : undefined;

    this.snapshot.portfolio = buildPortfolioSnapshot({
      regime: this.snapshot.regime,
      stressSource: this.snapshot.stressSource,
      reentry,
    });
  }
}

export const demoEngine = new Engine();
