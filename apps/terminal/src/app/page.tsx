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
  const [selected, setSelected] = useState<PillarId | null>(null);
  const [tab, setTab] = useState<DrawerTab>('overview');
  const drawerOpen = selected != null;

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.addEventListener('snapshot', (evt) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = JSON.parse((evt as any).data);
        setSnap(data);
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
                <div style={{ marginTop: 14 }} className={styles.small}>
                  Next: we’ll replace demo fields with real spec-driven metrics per pillar (ARAS modules, ARES gates, hedges, caps, overlays).
                </div>
              </>
            ) : tab === 'logic' ? (
              <div className={styles.small}>
                Logic view placeholder. For ARAS, we’ll show module scores, confidence calculation, stress_source logic (including CORRELATED) and regime thresholds.
              </div>
            ) : tab === 'history' ? (
              <div className={styles.small}>
                History view placeholder. In demo we can show last N snapshots and sparklines. In production: full time-series + replay.
              </div>
            ) : (
              <div className={styles.small}>
                Events view placeholder. This will filter the event log to only events tagged with this pillar.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
