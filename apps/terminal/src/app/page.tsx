'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';
import type { PillarId, Severity, SystemSnapshot } from '@/lib/types';

type DrawerTab = 'overview' | 'logic' | 'history' | 'events';

function badgeClass(sev: Severity) {
  if (sev === 'critical') return `${styles.badge} ${styles.badgeCritical}`;
  if (sev === 'watch') return `${styles.badge} ${styles.badgeWatch}`;
  return styles.badge;
}

function fmtPct(x: number) {
  return `${Math.round(x * 100)}%`;
}

export default function Home() {
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [history, setHistory] = useState<SystemSnapshot[]>([]);
  const [selected, setSelected] = useState<PillarId | null>(null);
  const [tab, setTab] = useState<DrawerTab>('overview');
  const drawerOpen = selected != null;

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.addEventListener('snapshot', (evt) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = JSON.parse((evt as any).data) as SystemSnapshot;
        setSnap(data);
        setHistory((h) => {
          const next = [...h, data];
          return next.length > 140 ? next.slice(next.length - 140) : next;
        });
      } catch {
        // ignore
      }
    });
    return () => es.close();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pillarList = useMemo(() => {
    if (!snap) return [] as Array<SystemSnapshot['pillars'][PillarId]>;
    return Object.values(snap.pillars).sort((a, b) => a.name.localeCompare(b.name));
  }, [snap]);

  const selectedPillar = selected && snap ? snap.pillars[selected] : null;

  const pillarHistory = useMemo(() => {
    if (!selected) return [] as Array<{ ts: number; score: number | null; confidence: number | null }>;
    return history
      .map((s) => {
        const p = s.pillars?.[selected];
        return {
          ts: s.ts,
          score: typeof p?.score === 'number' ? p.score : null,
          confidence: typeof p?.confidence === 'number' ? p.confidence : null,
        };
      })
      .slice(-80);
  }, [history, selected]);

  const selectedEvents = useMemo(() => {
    if (!snap || !selected) return [];
    const tag = `pillar:${selected}`;
    return (snap.alerts ?? []).filter((a) => (a.tags ?? []).includes(tag)).slice(0, 80);
  }, [snap, selected]);

  const onAutoDemo = async () => {
    await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'autoDemo' }),
    });
  };

  const onSetPhase = async (phase: string) => {
    await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setPhase', phase }),
    });
  };

  return (
    <div className={`${styles.page} hudGrid`}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.title}>ACHELION · COCKPIT</div>
          <div className={styles.subtitle}>
            {snap
              ? `Regime ${snap.regime} · Ceiling ${fmtPct(snap.exposureCeilingGross)} · Source ${snap.stressSource}`
              : 'Connecting…'}
          </div>
        </div>
        <div className={styles.actions}>
          <button className={styles.button} onClick={onAutoDemo}>
            AUTO‑DEMO
          </button>
          <button
            className={styles.button}
            onClick={() => {
              setSelected('ARAS');
              setTab('overview');
            }}
          >
            OPEN ARAS
          </button>
        </div>
      </div>

      <div className={styles.shell}>
        <div className={`${styles.cockpit} ${drawerOpen ? styles.cockpitDimmed : ''}`}>
          <div className={styles.grid}>
            <div className={`${styles.panel} ${styles.hero}`}>
              <div className={styles.h1}>System State</div>
              <div className={styles.kpis}>
                <div className={styles.kpi}>
                  <div className={styles.kpiLabel}>Regime</div>
                  <div className={`${styles.kpiValue} ${styles.kpiValueTeal}`}>{snap?.regime ?? '—'}</div>
                </div>
                <div className={styles.kpi}>
                  <div className={styles.kpiLabel}>Exposure ceiling (gross)</div>
                  <div className={`${styles.kpiValue} ${styles.kpiValueAmber}`}>
                    {snap ? fmtPct(snap.exposureCeilingGross) : '—'}
                  </div>
                </div>
                <div className={styles.kpi}>
                  <div className={styles.kpiLabel}>Stress source</div>
                  <div className={`${styles.kpiValue} ${styles.kpiValueRed}`}>{snap?.stressSource ?? '—'}</div>
                </div>
              </div>
              <div style={{ padding: '0 16px 16px' }} className={styles.small}>
                Live demo cockpit. Click any pillar to open detail drawer. (Esc closes.)
              </div>
            </div>

            <div className={`${styles.panel} ${styles.side}`}>
              <div className={styles.h1}>Scenario Control</div>
              <div style={{ padding: '0 16px 16px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {['CALM', 'BUILD_STRESS', 'CIRCUIT_BREAK', 'DELEVERAGE', 'STABILIZE', 'ARES_GATES', 'REENTRY'].map(
                  (p) => (
                    <button key={p} className={styles.tab} onClick={() => onSetPhase(p)}>
                      {p.replace('_', ' ')}
                    </button>
                  )
                )}
              </div>
              <div style={{ padding: '0 16px 16px' }} className={styles.small}>
                These buttons force phases for presentation. AUTO‑DEMO cycles automatically.
              </div>
            </div>

            <div className={styles.pillars}>
              {pillarList.map((p) => (
                <div
                  key={p.id}
                  className={styles.pillarCard}
                  onClick={() => {
                    setSelected(p.id);
                    setTab('overview');
                  }}
                >
                  <div className={styles.pillarHeader}>
                    <div>
                      <div className={styles.pillarName}>{p.name}</div>
                      <div className={styles.pillarMeta}>{p.type} · {p.status}</div>
                    </div>
                    <div className={styles.badge}>{p.id}</div>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: 'rgba(230,246,255,0.9)', lineHeight: 1.35 }}>
                    {p.headline}
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 14, alignItems: 'baseline' }}>
                    <div>
                      <div className={styles.kpiLabel}>score</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'rgba(23,182,214,0.9)' }}>
                        {p.score == null ? '—' : p.score.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className={styles.kpiLabel}>conf</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'rgba(230,246,255,0.85)' }}>
                        {p.confidence == null ? '—' : p.confidence.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className={`${styles.panel} ${styles.alerts}`}>
              <div className={styles.h1}>Alerts & Events</div>
              <div className={styles.alertList}>
                {(snap?.alerts ?? []).slice(0, 40).map((a) => (
                  <div key={a.id} className={styles.alertItem}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <div className={styles.alertTitle}>{a.title}</div>
                      <div className={badgeClass(a.severity)}>{a.severity}</div>
                    </div>
                    {a.detail ? <div className={styles.alertDetail}>{a.detail}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div
          className={`${styles.scrim} ${drawerOpen ? styles.scrimOpen : ''}`}
          onClick={() => setSelected(null)}
        />

        <div className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ''}`}>
          <div className={styles.drawerHeader}>
            <div className={styles.drawerTitle}>{selectedPillar ? `${selectedPillar.name} · Detail` : 'Detail'}</div>
            <button className={styles.drawerClose} onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <div className={styles.tabs}>
            {(['overview', 'logic', 'history', 'events'] as DrawerTab[]).map((t) => (
              <button
                key={t}
                className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className={styles.drawerBody}>
            {!selectedPillar ? (
              <div className={styles.small}>Select a pillar.</div>
            ) : tab === 'overview' ? (
              <>
                <div className={styles.kv}>
                  <div className={styles.kvKey}>ID</div>
                  <div className={styles.kvVal}>{selectedPillar.id}</div>

                  <div className={styles.kvKey}>Type</div>
                  <div className={styles.kvVal}>{selectedPillar.type}</div>

                  <div className={styles.kvKey}>Status</div>
                  <div className={styles.kvVal}>{selectedPillar.status}</div>

                  <div className={styles.kvKey}>Headline</div>
                  <div className={styles.kvVal}>{selectedPillar.headline}</div>

                  <div className={styles.kvKey}>Score</div>
                  <div className={styles.kvVal}>{selectedPillar.score == null ? '—' : selectedPillar.score.toFixed(3)}</div>

                  <div className={styles.kvKey}>Confidence</div>
                  <div className={styles.kvVal}>
                    {selectedPillar.confidence == null ? '—' : selectedPillar.confidence.toFixed(3)}
                  </div>
                </div>

                {selectedPillar.id === 'ARAS' ? (
                  <>
                    <div style={{ marginTop: 16, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                      ARAS modules (1–6)
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {(snap?.arasModules ?? []).map((m, i) => (
                        <div
                          key={`${m.name}-${i}`}
                          className={styles.alertItem}
                          style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}
                        >
                          <div>
                            <div className={styles.alertTitle}>
                              {i + 1}. {m.name}
                            </div>
                            <div className={styles.alertDetail}>
                              bucket {m.source_bucket} · conf {m.confidence.toFixed(2)} · stress {m.stress_flag ? 'YES' : 'no'}
                            </div>
                          </div>
                          <div
                            style={{
                              fontWeight: 800,
                              color: m.risk_score >= 0.65 ? 'rgba(255,77,77,0.95)' : 'rgba(23,182,214,0.95)',
                            }}
                          >
                            {m.risk_score.toFixed(2)}
                          </div>
                        </div>
                      ))}
                      {!snap?.arasModules?.length ? <div className={styles.small}>No ARAS module data.</div> : null}
                    </div>
                  </>
                ) : null}

                {selectedPillar.id === 'ARES' ? (
                  <>
                    <div style={{ marginTop: 16, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                      ARES gates
                    </div>
                    <div style={{ marginTop: 10 }} className={styles.kv}>
                      <div className={styles.kvKey}>Gate 1</div>
                      <div className={styles.kvVal}>{snap?.aresGates?.gate1_stress_normalization ?? '—'}</div>

                      <div className={styles.kvKey}>Gate 2</div>
                      <div className={styles.kvVal}>{snap?.aresGates?.gate2_conviction ?? '—'}</div>

                      <div className={styles.kvKey}>Gate 3</div>
                      <div className={styles.kvVal}>{snap?.aresGates?.gate3_confirmation ?? '—'}</div>
                    </div>
                  </>
                ) : null}

                <div style={{ marginTop: 14 }} className={styles.small}>
                  Spec-shaped drilldowns are live: ARAS module decomposition + ARES gate status.
                </div>
              </>
            ) : tab === 'logic' ? (
              selectedPillar.id === 'ARAS' ? (
                <div className={styles.small}>
                  <div style={{ fontWeight: 800, color: 'rgba(230,246,255,0.92)' }}>ARAS logic (demo rules)</div>
                  <ul>
                    <li>stressSource compares crypto (modules 2,6) vs equity (3,4,5) averages.</li>
                    <li>If both &gt; 0.5 and within 0.15 → CORRELATED.</li>
                    <li>If ≥3 stress flags → regime forced to CRASH + ceiling capped at 15%.</li>
                    <li>ARAS pillar score is a confidence-weighted composite (stress flags upweight risk).</li>
                  </ul>
                </div>
              ) : selectedPillar.id === 'ARES' ? (
                <div className={styles.small}>
                  <div style={{ fontWeight: 800, color: 'rgba(230,246,255,0.92)' }}>ARES logic (demo rules)</div>
                  <ul>
                    <li>3 gates: stress normalization → conviction → confirmation.</li>
                    <li>Pillar status becomes TRIGGERED when all 3 are PASS.</li>
                    <li>In the demo scenario, gates advance deterministically over the phase window.</li>
                  </ul>
                </div>
              ) : (
                <div className={styles.small}>Logic view not yet implemented for this pillar.</div>
              )
            ) : tab === 'history' ? (
              <>
                <div className={styles.small} style={{ marginBottom: 10 }}>
                  Rolling local buffer (last {pillarHistory.length} points). This is client-side only in the demo.
                </div>

                {pillarHistory.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <div className={styles.kpiLabel}>Score</div>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 44 }}>
                        {pillarHistory.map((pt) => (
                          <div
                            key={pt.ts}
                            title={pt.score == null ? '—' : pt.score.toFixed(3)}
                            style={{
                              width: 4,
                              height: `${Math.max(2, Math.round((pt.score ?? 0) * 44))}px`,
                              background: 'rgba(23,182,214,0.75)',
                              borderRadius: 2,
                              opacity: pt.score == null ? 0.25 : 1,
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className={styles.kpiLabel}>Confidence</div>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 44 }}>
                        {pillarHistory.map((pt) => (
                          <div
                            key={pt.ts + 1}
                            title={pt.confidence == null ? '—' : pt.confidence.toFixed(3)}
                            style={{
                              width: 4,
                              height: `${Math.max(2, Math.round((pt.confidence ?? 0) * 44))}px`,
                              background: 'rgba(230,246,255,0.55)',
                              borderRadius: 2,
                              opacity: pt.confidence == null ? 0.25 : 1,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={styles.small}>No history yet — wait a second for snapshots.</div>
                )}
              </>
            ) : (
              <>
                <div className={styles.small} style={{ marginBottom: 10 }}>
                  Events tagged to this pillar.
                </div>
                {selectedEvents.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {selectedEvents.map((a) => (
                      <div key={a.id} className={styles.alertItem}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                          <div className={styles.alertTitle}>{a.title}</div>
                          <div className={badgeClass(a.severity)}>{a.severity}</div>
                        </div>
                        {a.detail ? <div className={styles.alertDetail}>{a.detail}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.small}>No pillar-tagged events yet. (Try forcing phases.)</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
