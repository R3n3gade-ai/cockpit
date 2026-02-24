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

export interface SystemSnapshot {
  ts: number;

  // Scenario playback (demo)
  scenarioId?: 'S1' | 'S2' | 'S3';
  scenarioName?: string;
  scenarioT?: number; // seconds since scenario start
  scenarioStep?: string;

  regime: Regime;
  exposureCeilingGross: number; // 0..1
  stressSource: StressSource;

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
