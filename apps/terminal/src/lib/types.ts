export type Severity = 'info' | 'watch' | 'critical';

export type PillarId =
  | 'ARAS'
  | 'MACRO'
  | 'MASTER'
  | 'KEVLAR'
  | 'PERM'
  | 'SLOF'
  | 'ARES';

export type Regime = 'RISK_ON' | 'NEUTRAL' | 'DEFENSIVE' | 'CRASH';
export type StressSource = 'CRYPTO' | 'EQUITY' | 'GENERAL' | 'CORRELATED';

export interface PillarSummary {
  id: PillarId;
  name: string;
  type: 'defensive' | 'offensive' | 'context' | 'execution';
  status: 'OK' | 'ACTIVE' | 'SUSPENDED' | 'TRIGGERED' | 'DEGRADED';
  score?: number; // 0..1 (risk / intensity)
  confidence?: number; // 0..1
  headline: string;
  updatedAt: number; // epoch ms
}

export interface AlertEvent {
  id: string;
  ts: number;
  severity: Severity;
  title: string;
  detail?: string;
  tags?: string[];
}

export interface ARASModuleSignal {
  name: string;
  risk_score: number; // 0..1
  stress_flag: boolean;
  confidence: number; // 0.5..0.95 in spec
  source_bucket: 'CRYPTO' | 'EQUITY' | 'MIXED';
}

export interface ARESGateStatus {
  gate1_stress_normalization: 'PASS' | 'FAIL' | 'WAIT';
  gate2_conviction: 'PASS' | 'FAIL' | 'WAIT';
  gate3_confirmation: 'PASS' | 'FAIL' | 'WAIT';
}

export type PillarSignalLevel = 'OK' | 'WATCH' | 'RISK';

export interface PillarSignal {
  name: string;
  valueText: string;
  score: number; // 0..1 intensity/risk
  confidence: number; // 0..1
  level: PillarSignalLevel;
}

export type Sleeve = 'EQUITY' | 'CRYPTO' | 'DEFENSE' | 'CASH_OPTIONS';

export interface PortfolioPosition {
  ticker: string;
  sleeve: Sleeve;
  conviction?: number;
  slofEligible?: boolean;
  tranche?: 1 | 2 | 3 | 4;
  currentPct: number; // 0..1 (as % NAV)
  targetPct: number; // 0..1 (as % NAV)
  reason?: string;
}

export interface PortfolioSnapshot {
  // Architecture AB (targets)
  targetSleeves: { equity: number; crypto: number; defense: number; cashOptions: number };

  // Current sleeve weights (demo)
  sleeves: { equity: number; crypto: number; defense: number; cashOptions: number };

  // Key ceilings per playbook (Eq+Cr ceiling; defense is structural and shown separately)
  eqCryptoCeiling: number;
  slofMax: number;

  // ARES re-entry status (demo)
  reentry?: {
    pmApproved: boolean;
    tranche: 0 | 1 | 2 | 3 | 4;
    trancheCeiling: number; // 0..1 (Eq+Cr ceiling during re-entry)
  };

  positions: PortfolioPosition[];
}

export interface SystemSnapshot {
  ts: number;

  // Scenario playback (demo)
  scenarioId?: 'S1' | 'S2' | 'S3';
  scenarioName?: string;
  scenarioT?: number; // seconds since scenario start
  scenarioStep?: string;

  regime: Regime;
  exposureCeilingGross: number; // 0..1.2 (100% physical + up to 10% SLOF synthetic; keep headroom)
  stressSource: StressSource;

  // Portfolio / positions (demo)
  portfolio?: PortfolioSnapshot;

  // Decompositions for drilldowns
  arasModules?: ARASModuleSignal[];
  aresGates?: ARESGateStatus;

  macroSignals?: PillarSignal[];
  masterSignals?: PillarSignal[];
  kevlarSignals?: PillarSignal[];
  permSignals?: PillarSignal[];
  slofSignals?: PillarSignal[];

  pillars: Record<PillarId, PillarSummary>;
  alerts: AlertEvent[];
}
