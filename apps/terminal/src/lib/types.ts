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

export interface SystemSnapshot {
  ts: number;
  regime: Regime;
  exposureCeilingGross: number; // 0..1
  stressSource: StressSource;
  pillars: Record<PillarId, PillarSummary>;
  alerts: AlertEvent[];
}
