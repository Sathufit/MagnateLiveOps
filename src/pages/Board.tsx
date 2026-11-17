import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { PORTS, ROLE_LABEL, ROLE_SEES } from '../../shared/domain.ts';
import { DelayTable, DeliveryList, DocumentList, EtaPanel, FeedList, LT, PartiesList, PhaseTrack, ReadinessList, StatusStrip, opSubtitle } from '../components/board.tsx';
import { FullMessage, Icon, LiveBadge, Panel, ThemeToggle, Wordmark } from '../components/ui.tsx';
import { ApiError, api } from '../lib/api.ts';
import type { LiveView } from '../lib/api.ts';
import { useLiveSync, useNow } from '../lib/hooks.ts';

/** Loads a share link's view and keeps it current. */
export function useLiveView(token: string | undefined) {
  const [view, setView] = useState<LiveView | null>(null);
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState(false);
  const version = useRef<number | undefined>(undefined);

  const check = useCallback(
    async (initial: boolean) => {
      if (!token) return false;
      try {
        const result = await api.live(token, initial, version.current);
        if (!('unchanged' in result)) {
          version.current = result.op.version;
          setView(result);
        }
        setFailed(false);
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setGone(true);
          return true;
        }
        setFailed(true);
        return false;
      }
    },
    [token],
  );

  const stream = useLiveSync(check, view?.channel, !!token && !gone);
  return { view, gone, failed, stream };
}

export function LinkGone() {
  return (
    <FullMessage title="This link is no longer active">
      <p>The operation may have been closed or the link replaced. Please ask the Magnate operations desk for a current link.</p>
    </FullMessage>
  );
}

export default function Board() {
  const { token } = useParams();
  const { view, gone, failed, stream } = useLiveView(token);
  const now = useNow();

  useEffect(() => {
    if (view) document.title = `${view.op.vessel.name} · Magnate LiveOps`;
  }, [view]);

  if (gone) return <LinkGone />;
  if (!view) {
    return failed ? (
      <FullMessage title="The board could not be loaded">
        <p>Check your connection. This page will keep trying.</p>
      </FullMessage>
    ) : (
      <div className="loading" role="status">Loading live board</div>
    );
  }

  const { op, modules, viewer } = view;
  const has = (m: (typeof modules)[number]) => modules.includes(m);
  const port = PORTS.find((p) => p.name === op.port)!;

  return (
    <div className="board">
      <header className="topbar">
        <div className="topbar-inner">
          <Wordmark />
          <div className="topbar-right">
            <LiveBadge state={stream} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="page">
        <section className="op-head">
          <div className="op-head-main">
            <p className="op-ref">
              <span>{op.ref}</span>
              <span>Bunker delivery</span>
              {op.demo && <span className="sample-tag">Sample operation</span>}
            </p>
            <h1>{op.vessel.name}</h1>
            <p className="op-meta">
              <b>
                {op.port}
                {op.location && `, ${op.location}`}
              </b>
              <span className="coords">{port.pos}</span>
              <span>{opSubtitle(op)}</span>
            </p>
          </div>
          <div className="op-head-side">
            {viewer !== 'magnate' && (
              <p className="viewer-note" title={ROLE_SEES[viewer]}>
                Shared with you as <b>{ROLE_LABEL[viewer]}</b>
              </p>
            )}
            <p className="updated">
              Last update <LT iso={op.updatedAt} /> LT
            </p>
            {has('report') && (
              <Link className="btn" to="report">
                <Icon name="report" />
                {op.status === 'completed' ? 'Final report' : 'Operation report'}
              </Link>
            )}
          </div>
        </section>

        {failed && <p className="banner warn">Connection lost. Showing the last update received; reconnecting.</p>}

        <StatusStrip view={view} now={now} />

        <Panel title="Operation progress">
          <PhaseTrack op={op} />
        </Panel>

        <div className="board-grid">
          <div className="board-main">
            <Panel title="Live update feed" aside={<span className="muted">All times local, UTC+05:30</span>}>
              <FeedList entries={op.feed} />
            </Panel>
            {has('delays') && op.delays && (
              <Panel title="Delay log">
                <DelayTable delays={op.delays} now={now} />
              </Panel>
            )}
          </div>
          <aside className="board-side">
            <Panel title={has('etaHistory') ? 'ETA history' : 'ETA'}>
              <EtaPanel op={op} now={now} history={has('etaHistory')} />
            </Panel>
            {has('readiness') && op.readiness && (
              <Panel title="Readiness">
                <ReadinessList op={op} readiness={op.readiness} />
              </Panel>
            )}
            <Panel title="Delivery">
              <DeliveryList grades={op.grades} />
            </Panel>
            {has('documents') && op.documents && (
              <Panel title="Documents">
                <DocumentList documents={op.documents} />
              </Panel>
            )}
            <Panel title="Parties">
              <PartiesList op={op} />
            </Panel>
          </aside>
        </div>
      </main>

      <footer className="board-foot">
        <div>
          <b>Magnate Shipping Agency (Pvt) Ltd</b>
          <span>Sri Lanka · Colombo · Galle · Hambantota · Trincomalee</span>
        </div>
        <p>
          This board is updated by the Magnate operations desk and is shared for information. Times are as reported to the agent and remain subject to the
          final statement of facts.
        </p>
      </footer>
    </div>
  );
}
