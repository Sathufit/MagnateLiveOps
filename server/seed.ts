// Sample operations so the console and the demonstration link have something to show
// on first run. Vessel and company names are fictitious.
import type { Operation } from '../shared/domain.ts';
import { applyAction, createOperation } from './actions.ts';
import type { Store } from './store.ts';

const ACTOR = 'Ops Desk';
type Step = [hoursAgo: number, action: Record<string, unknown>];

export async function seedSamples(store: Store): Promise<void> {
  const T = Date.now();
  const refs: string[] = [];
  for (let i = 0; i < 4; i++) refs.push(await store.nextRef(new Date(T)));
  const at = (hoursAgo: number) => new Date(T - hoursAgo * 3600_000).toISOString();

  function build(createdHoursAgo: number, details: Record<string, unknown>, steps: Step[], demo = true): Operation {
    const op = createOperation(details, refs.shift()!, ACTOR, at(createdHoursAgo), demo);
    for (const [hoursAgo, action] of steps) {
      const now = at(hoursAgo);
      let withTime = action.type === 'milestone.set' && action.state !== 'pending' ? { at: now, ...action } : action;
      if (action.type === 'delay.close') withTime = { ...action, id: op.delays.find((d) => !d.endedAt)?.id };
      applyAction(op, withTime, ACTOR, now);
      op.updatedAt = now;
      op.version += 1;
    }
    return op;
  }

  const done = (key: string): Record<string, unknown> => ({ type: 'milestone.set', key, state: 'done' });
  const active = (key: string): Record<string, unknown> => ({ type: 'milestone.set', key, state: 'active' });
  const doc = (op: Operation, index: number, state: string, ref = '') => ({ type: 'doc.set', id: op.documents[index].id, state, ref });

  /* 1. Demonstration board: vessel on passage, supplier mobilising. */
  const a = build(
    26,
    {
      vessel: { name: 'MV Coral Meridian', imo: '9000001', type: 'Bulk carrier' },
      port: 'Colombo',
      location: 'Outer anchorage',
      deliveryMode: 'barge',
      craftName: 'MT Lanka Tide',
      parties: {
        owner: 'Meridian Bulk Carriers',
        charterer: 'Northgate Chartering',
        trader: 'Pacific Marine Fuels',
        supplier: 'Lanka Bunker Supply',
        surveyor: 'Ceylon Marine Surveys',
      },
      grades: [
        { grade: 'VLSFO', nominated: 850 },
        { grade: 'LSMGO', nominated: 120 },
      ],
      eta: at(-1),
      etaSource: 'Master',
    },
    [
      [25, done('supplier_nominated')],
      [25, { type: 'readiness.set', party: 'supplier', level: 'standby', note: 'Stem confirmed, barge allocated.' }],
      [22, done('surveyor_arranged')],
      [22, { type: 'readiness.set', party: 'surveyor', level: 'standby', note: 'Attending surveyor to be confirmed 2 hours before arrival.' }],
      [15, { type: 'eta.revise', eta: at(-4), source: 'Master', note: 'Adverse current on passage.' }],
      [2, { type: 'eta.revise', eta: at(-3.25), source: 'Master', note: '' }],
      [1.2, { type: 'readiness.set', party: 'vessel', level: 'standby', note: 'Port side manifold, 2 hose connections available.' }],
      [1, active('barge_loading')],
      [1, { type: 'readiness.set', party: 'craft', level: 'standby', note: 'Loading at terminal, estimated 2 hours.' }],
      [0.6, { type: 'feed.post', kind: 'notice', text: 'Port control advised anchorage position will be allotted on arrival. Pilot not required for outer anchorage.' }],
    ],
    true,
  );
  applyAction(a, doc(a, 0, 'received', 'PMF/STEM/4471'), ACTOR, at(24.5));
  applyAction(a, { type: 'details.set', ...detailsOf(a), headline: '', etc: at(-11) }, ACTOR, at(0.6));
  a.feed.sort((x, y) => x.at.localeCompare(y.at));

  /* 2. Delivery under way off Galle, after a short supplier delay. */
  const b = build(
    30,
    {
      vessel: { name: 'MT Indus Voyager', imo: '9000002', type: 'Product tanker' },
      port: 'Galle',
      location: 'OPL Galle',
      deliveryMode: 'barge',
      craftName: 'MT Ruhunu Star',
      parties: {
        owner: 'Indus Tankers',
        charterer: 'Halcyon Energy Trading',
        trader: 'Bluewater Bunkering',
        supplier: 'Southern Marine Fuels',
        surveyor: 'Ceylon Marine Surveys',
      },
      grades: [
        { grade: 'VLSFO', nominated: 900 },
        { grade: 'LSMGO', nominated: 150 },
      ],
      eta: at(6),
      etaSource: 'Master',
    },
    [
      [29, done('supplier_nominated')],
      [27, done('surveyor_arranged')],
      [12, { type: 'eta.revise', eta: at(5.5), source: 'Master', note: '' }],
      [7, { type: 'delay.open', cause: 'supplier', note: 'Loading slot at terminal pushed back.' }],
      [5.9, { type: 'delay.close', id: '' }],
      [5.8, done('barge_loading')],
      [5.5, done('barge_departed')],
      [5.3, done('vessel_arrived')],
      [5.2, { type: 'readiness.set', party: 'vessel', level: 'ready', note: 'Drifting at OPL position, starboard side to.' }],
      [3.7, done('barge_alongside')],
      [3.5, done('surveyor_onboard')],
      [3.5, { type: 'readiness.set', party: 'surveyor', level: 'ready', note: 'Opening gauging in progress.' }],
      [2.8, done('bunkering_commenced')],
      [2.8, { type: 'readiness.set', party: 'craft', level: 'ready', note: 'Pumping VLSFO first, LSMGO to follow.' }],
      [0.4, { type: 'feed.post', kind: 'progress', text: 'VLSFO delivery progressing at about 210 MT per hour. No stoppages reported.' }],
    ],
  );
  applyAction(b, doc(b, 0, 'received', 'BWB/2611/118'), ACTOR, at(28));
  applyAction(b, doc(b, 1, 'received'), ACTOR, at(3.4));
  applyAction(b, doc(b, 2, 'received'), ACTOR, at(3));
  applyAction(b, { type: 'delivery.set', gradeId: b.grades[0].id, delivered: 520 }, ACTOR, at(0.3));
  applyAction(b, { type: 'details.set', ...detailsOf(b), headline: '', etc: at(-2.5) }, ACTOR, at(0.3));
  b.readiness.supplier = { level: 'ready', note: '', updatedAt: at(5.8) };
  b.feed.sort((x, y) => x.at.localeCompare(y.at));

  /* 3. Weather hold at Hambantota. */
  const c = build(
    20,
    {
      vessel: { name: 'MV Serendib Express', imo: '9000003', type: 'Container vessel' },
      port: 'Hambantota',
      location: 'Anchorage B',
      deliveryMode: 'barge',
      craftName: 'MT Magampura',
      parties: {
        owner: 'Serendib Lines',
        charterer: 'Serendib Lines',
        trader: 'Pacific Marine Fuels',
        supplier: 'Hambantota Bunker Terminal',
        surveyor: 'Indian Ocean Surveyors',
      },
      grades: [{ grade: 'VLSFO', nominated: 1400 }],
      eta: at(3),
      etaSource: 'Master',
    },
    [
      [19, done('supplier_nominated')],
      [18, done('surveyor_arranged')],
      [4, done('barge_loading')],
      [2.9, done('vessel_arrived')],
      [2, done('barge_departed')],
      [1.5, { type: 'delay.open', cause: 'weather', note: 'Swell at the anchorage is above the safe limit for going alongside. Reviewing at the next weather window.' }],
      [1.5, { type: 'readiness.set', party: 'craft', level: 'issue', note: 'Holding off the anchorage.' }],
    ],
  );
  c.readiness.vessel = { level: 'ready', note: 'At anchor, port side to.', updatedAt: at(2.9) };
  c.readiness.supplier = { level: 'ready', note: '', updatedAt: at(4) };
  c.readiness.surveyor = { level: 'standby', note: 'Launch booked, waiting for the barge to close.', updatedAt: at(2) };

  /* 4. Completed bowser delivery at Trincomalee. */
  const d = build(
    70,
    {
      vessel: { name: 'MV Eastern Kestrel', imo: '9000004', type: 'General cargo' },
      port: 'Trincomalee',
      location: 'Ashroff Jetty',
      deliveryMode: 'bowser',
      craftName: '6 road bowsers',
      parties: {
        owner: 'Kestrel Shipping',
        charterer: 'Bay of Bengal Logistics',
        trader: 'Bluewater Bunkering',
        supplier: 'Lanka Bunker Supply',
        surveyor: 'Indian Ocean Surveyors',
      },
      grades: [{ grade: 'LSMGO', nominated: 180 }],
      eta: at(56),
      etaSource: 'Master',
    },
    [
      [69, done('supplier_nominated')],
      [68, done('surveyor_arranged')],
      [58, { type: 'eta.revise', eta: at(55), source: 'Master', note: '' }],
      [56, done('barge_loading')],
      [55.2, done('vessel_arrived')],
      [54.5, done('barge_departed')],
      [53.6, done('barge_alongside')],
      [53.4, done('surveyor_onboard')],
      [53, done('bunkering_commenced')],
      [48.5, done('bunkering_completed')],
      [48, done('bdn_issued')],
      [47.6, done('barge_cast_off')],
      [47.5, { type: 'op.status', status: 'completed' }],
    ],
  );
  d.grades[0].delivered = 179.84;
  for (const item of d.documents) Object.assign(item, { state: item.name.includes('BDN') ? 'issued' : 'received', at: at(48) });
  d.documents[4].ref = 'LBS/BDN/20931';
  for (const p of ['vessel', 'supplier', 'craft', 'surveyor'] as const) d.readiness[p] = { level: 'ready', note: '', updatedAt: at(53) };
  d.remarks = 'Delivery completed without incident. Quantity agreed between vessel and supplier figures; no letter of protest issued.';
  for (const op of [a, b, c, d]) await store.insertOp(op);
}

function detailsOf(op: Operation) {
  return {
    vessel: op.vessel,
    port: op.port,
    location: op.location,
    deliveryMode: op.deliveryMode,
    craftName: op.craftName,
    parties: op.parties,
    grades: op.grades,
  };
}
