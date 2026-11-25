import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allocateSponsorFunds, mutateSponsors, sponsorSnapshot, validateSponsorCampaign } from '../lib/sponsor-core.ts';

const T0 = Date.parse('2026-11-25T03:00:00.000Z');
const PLAN = { action: 'create', company: 'テスト協賛者', title: '新商品のお知らせ', description: '表示報酬付きの掲載シミュレーション', url: 'https://example.com/product', amountYen: 10001, days: 7 };

// Execute the real generated migrations, and the production SQL in atomic batches.
function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  const directory = fileURLToPath(new URL('../drizzle/', import.meta.url));
  const migrations = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(migrations.length > 0, 'Run db:generate before the sponsor integration tests');
  for (const name of migrations) sql.exec(readFileSync(`${directory}/${name}`, 'utf8'));
  class Statement {
    constructor(query, values = []) { this.query = query; this.values = values; }
    bind(...values) { return new Statement(this.query, values); }
    async first() { return sql.prepare(this.query).get(...this.values) ?? null; }
    execute() {
      const statement = sql.prepare(this.query);
      if (statement.columns().length) return { success: true, results: statement.all(...this.values), meta: { changes: 0 } };
      const result = statement.run(...this.values);
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    }
    async run() { return this.execute(); }
  }
  return {
    sql,
    prepare(query) { return new Statement(query); },
    async batch(statements) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        const result = statements.map((statement) => statement.execute());
        sql.exec('COMMIT');
        return result;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
}

function settlement(campaignId, key = 'settlement-request-1', deductionsYen = 1000) {
  return { action: 'simulate_settlement', campaignId, idempotencyKey: key, deductionsYen, simulation: true };
}

test('allocation uses integer yen, covers deductions and preserves every rounding yen', () => {
  assert.deepEqual(allocateSponsorFunds(10001, 1000), { grossYen: 10001, deductionsYen: 1000, netYen: 9001, rewardYen: 4500, reserveYen: 1800, operationsYen: 1800, growthYen: 901 });
  for (let gross = 0; gross < 200; gross++) {
    const allocation = allocateSponsorFunds(gross, 3);
    assert.equal(allocation.netYen, allocation.rewardYen + allocation.reserveYen + allocation.operationsYen + allocation.growthYen);
    assert.ok(Object.values(allocation).every(Number.isSafeInteger));
  }
  assert.equal(allocateSponsorFunds(100, 101).netYen, 0);
  assert.throws(() => allocateSponsorFunds(-1, 0), { code: 'INVALID_AMOUNT' });
  assert.throws(() => allocateSponsorFunds(100, 0.5), { code: 'INVALID_AMOUNT' });
  assert.throws(() => allocateSponsorFunds(100, Infinity), { code: 'INVALID_AMOUNT' });
});

test('campaign input rejects executable URLs, credentials, excessive amounts and invalid periods', () => {
  assert.equal(validateSponsorCampaign(PLAN).amountYen, 10001);
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:secret@example.com', 'not-a-url']) {
    assert.throws(() => validateSponsorCampaign({ ...PLAN, url }), { code: 'INVALID_URL' });
  }
  for (const amountYen of [99, -1, 100.5, 10000001]) assert.throws(() => validateSponsorCampaign({ ...PLAN, amountYen }), { code: 'INVALID_AMOUNT' });
  for (const days of [0, 91, 1.5]) assert.throws(() => validateSponsorCampaign({ ...PLAN, days }), { code: 'INVALID_DAYS' });
});

test('new accounts have no invented sponsors or funds; drafts do not fund the pool', async () => {
  const db = database();
  try {
    let state = await sponsorSnapshot(db, 'alice', T0);
    assert.equal(state.mode, 'demo');
    assert.equal(state.simulation, true);
    assert.equal(state.funding.realEnabled, false);
    assert.equal(state.campaigns.length, 0);
    assert.equal(state.ledger.length, 0);
    assert.equal(state.totals.realReceivedYen, 0);
    state = await mutateSponsors(db, 'alice', { ...PLAN, rewardYen: 1000000, realReceivedYen: 1000000 }, T0);
    assert.equal(state.campaigns[0].status, 'draft');
    assert.equal(state.campaigns[0].isLive, false);
    assert.equal(state.totals.grossYen, 0);
    assert.equal(state.totals.realReceivedYen, 0);
  } finally { db.sql.close(); }
});

test('simulated settlement is idempotent under concurrent replay, never credits reward accounts', async () => {
  const db = database();
  try {
    let state = await mutateSponsors(db, 'alice', PLAN, T0);
    const request = settlement(state.campaigns[0].id);
    const results = await Promise.allSettled([
      mutateSponsors(db, 'alice', request, T0 + 1000),
      mutateSponsors(db, 'alice', request, T0 + 1000),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 2);
    state = await sponsorSnapshot(db, 'alice', T0 + 2000);
    assert.equal(state.ledger.length, 1);
    assert.equal(state.ledger[0].simulation, true);
    assert.equal(state.totals.grossYen, 10001);
    assert.equal(state.totals.netYen, 9001);
    assert.equal(state.totals.rewardYen, 4500);
    assert.equal(state.totals.realReceivedYen, 0);
    assert.equal(state.campaigns[0].isLive, true);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM reward_accounts').get().n, 0);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM reward_ledger').get().n, 0);
    await assert.rejects(mutateSponsors(db, 'alice', { ...request, deductionsYen: 500 }, T0 + 3000), { code: 'IDEMPOTENCY_CONFLICT' });
    await assert.rejects(mutateSponsors(db, 'alice', { ...request, simulation: false }, T0 + 3000), { code: 'REAL_FUNDING_UNAVAILABLE' });
    assert.throws(() => db.sql.prepare('UPDATE sponsor_settlements SET simulation = 0').run(), /CHECK constraint failed/);
  } finally { db.sql.close(); }
});

test('different concurrent keys cannot settle one campaign twice', async () => {
  const db = database();
  try {
    const state = await mutateSponsors(db, 'alice', PLAN, T0);
    const campaignId = state.campaigns[0].id;
    const results = await Promise.allSettled([
      mutateSponsors(db, 'alice', settlement(campaignId, 'first-settlement'), T0 + 1000),
      mutateSponsors(db, 'alice', settlement(campaignId, 'second-settlement'), T0 + 1000),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const finalState = await sponsorSnapshot(db, 'alice', T0 + 2000);
    assert.equal(finalState.ledger.length, 1);
    assert.equal(finalState.totals.grossYen, PLAN.amountYen);
  } finally { db.sql.close(); }
});

test('one idempotency key cannot fund two campaigns, and losing transaction stays draft', async () => {
  const db = database();
  try {
    let state = await mutateSponsors(db, 'alice', PLAN, T0);
    const firstId = state.campaigns[0].id;
    state = await mutateSponsors(db, 'alice', { ...PLAN, title: '別の協賛' }, T0 + 1);
    const secondId = state.campaigns.find((campaign) => campaign.id !== firstId).id;
    const results = await Promise.allSettled([
      mutateSponsors(db, 'alice', settlement(firstId, 'shared-settlement'), T0 + 1000),
      mutateSponsors(db, 'alice', settlement(secondId, 'shared-settlement'), T0 + 1000),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    state = await sponsorSnapshot(db, 'alice', T0 + 2000);
    assert.equal(state.ledger.length, 1);
    assert.equal(state.campaigns.filter((campaign) => campaign.status === 'draft').length, 1);
  } finally { db.sql.close(); }
});

test('account ownership is enforced on reads, settlements and state changes', async () => {
  const db = database();
  try {
    const state = await mutateSponsors(db, 'alice', PLAN, T0);
    const campaignId = state.campaigns[0].id;
    await assert.rejects(mutateSponsors(db, 'bob', settlement(campaignId), T0 + 1), { code: 'CAMPAIGN_NOT_FOUND' });
    await assert.rejects(mutateSponsors(db, 'bob', { action: 'archive', campaignId }, T0 + 1), { code: 'CAMPAIGN_NOT_FOUND' });
    const bob = await sponsorSnapshot(db, 'bob', T0 + 2);
    assert.equal(bob.campaigns.length, 0);
    assert.equal(bob.ledger.length, 0);
    assert.equal(bob.totals.netYen, 0);
    assert.equal((await sponsorSnapshot(db, 'alice', T0 + 3)).campaigns[0].status, 'draft');
  } finally { db.sql.close(); }
});

test('only the owner may edit a draft, and settlement freezes its terms and ledger', async () => {
  const db = database();
  try {
    let state = await mutateSponsors(db, 'alice', PLAN, T0);
    const campaignId = state.campaigns[0].id;
    const updated = { ...PLAN, action: 'update', campaignId, title: '変更後の紹介タイトル', amountYen: 25000, days: 14 };
    await assert.rejects(mutateSponsors(db, 'bob', updated, T0 + 1), { code: 'CAMPAIGN_NOT_FOUND' });
    state = await mutateSponsors(db, 'alice', updated, T0 + 2);
    assert.equal(state.campaigns[0].id, campaignId);
    assert.equal(state.campaigns[0].title, updated.title);
    assert.equal(state.campaigns[0].amountYen, 25000);
    assert.equal(state.campaigns[0].days, 14);
    assert.equal(state.campaigns[0].createdAt, T0);
    assert.equal(state.campaigns[0].status, 'draft');
    assert.equal(state.ledger.length, 0);
    state = await mutateSponsors(db, 'alice', settlement(campaignId), T0 + 3);
    assert.equal(state.ledger[0].grossYen, 25000);
    assert.equal(state.ledger[0].campaignTitle, updated.title);
    await assert.rejects(mutateSponsors(db, 'alice', { ...updated, amountYen: 99999, title: '変更できないタイトル' }, T0 + 4), { code: 'CAMPAIGN_NOT_EDITABLE' });
    state = await sponsorSnapshot(db, 'alice', T0 + 5);
    assert.equal(state.campaigns[0].amountYen, 25000);
    assert.equal(state.campaigns[0].title, updated.title);
    assert.equal(state.ledger[0].grossYen, 25000);
    assert.equal(state.totals.grossYen, 25000);
  } finally { db.sql.close(); }
});

test('placements require simulated funding and support pause, resume, expiration and archive', async () => {
  const db = database();
  try {
    let state = await mutateSponsors(db, 'alice', PLAN, T0);
    const campaignId = state.campaigns[0].id;
    await assert.rejects(mutateSponsors(db, 'alice', { action: 'resume', campaignId }, T0 + 1), { code: 'INVALID_STATUS_CHANGE' });
    state = await mutateSponsors(db, 'alice', settlement(campaignId), T0 + 1000);
    const endsAt = state.campaigns[0].endsAt;
    state = await mutateSponsors(db, 'alice', { action: 'pause', campaignId }, T0 + 2000);
    assert.equal(state.campaigns[0].isLive, false);
    state = await mutateSponsors(db, 'alice', { action: 'resume', campaignId }, T0 + 3000);
    assert.equal(state.campaigns[0].isLive, true);
    assert.equal(state.campaigns[0].endsAt, endsAt);
    assert.equal((await sponsorSnapshot(db, 'alice', endsAt)).campaigns[0].isLive, false);
    await mutateSponsors(db, 'alice', { action: 'pause', campaignId }, endsAt);
    await assert.rejects(mutateSponsors(db, 'alice', { action: 'resume', campaignId }, endsAt + 1), { code: 'CAMPAIGN_EXPIRED' });
    state = await mutateSponsors(db, 'alice', { action: 'archive', campaignId }, endsAt + 2);
    assert.equal(state.campaigns[0].status, 'archived');
    assert.equal(state.ledger.length, 1);
    assert.equal(state.totals.netYen, 9001);
    await assert.rejects(mutateSponsors(db, 'alice', { action: 'resume', campaignId }, endsAt + 3), { code: 'INVALID_STATUS_CHANGE' });
  } finally { db.sql.close(); }
});

test('demo reports measure server intervals without trusting duration, double counts or hidden gaps', async () => {
  const db = database();
  try {
    let state = await mutateSponsors(db, 'alice', PLAN, T0);
    const campaignId = state.campaigns[0].id;
    const view = { action: 'record_view', campaignId, sessionId: 'preview-session-one', sequence: 0, visible: true, simulation: true, duration: 99999999 };
    await assert.rejects(mutateSponsors(db, 'alice', view, T0), { code: 'CAMPAIGN_NOT_LIVE' });
    await mutateSponsors(db, 'alice', settlement(campaignId), T0);
    await assert.rejects(mutateSponsors(db, 'alice', view, T0), { code: 'VIEW_REWARD_SESSION_INACTIVE' });
    db.sql.prepare('INSERT INTO reward_accounts (user_id, day_key, created_at, session_id, last_seen, last_visible) VALUES (?, ?, ?, ?, ?, 1)').run('alice', '2026-11-25', T0, view.sessionId, T0);
    state = await mutateSponsors(db, 'alice', view, T0);
    assert.deepEqual(state.campaigns[0].report, { visibleSeconds: 0, confirmedIntervals: 0 });
    assert.deepEqual(state.campaigns[0].viewSession, { id: view.sessionId, sequence: 1 });
    const firstInterval = { ...view, sequence: 1 };
    const concurrent = await Promise.allSettled([
      mutateSponsors(db, 'alice', firstInterval, T0 + 15000),
      mutateSponsors(db, 'alice', firstInterval, T0 + 15000),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 2);
    state = await sponsorSnapshot(db, 'alice', T0 + 15001);
    assert.deepEqual(state.campaigns[0].report, { visibleSeconds: 15, confirmedIntervals: 1 });
    await mutateSponsors(db, 'alice', { ...view, sequence: 2, visible: false }, T0 + 20000);
    state = await mutateSponsors(db, 'alice', { ...view, sequence: 3 }, T0 + 25000);
    assert.equal(state.campaigns[0].report.visibleSeconds, 15);
    state = await mutateSponsors(db, 'alice', { ...view, sequence: 4 }, T0 + 40000);
    assert.deepEqual(state.campaigns[0].report, { visibleSeconds: 30, confirmedIntervals: 2 });
    db.sql.prepare('UPDATE reward_accounts SET last_seen = ? WHERE user_id = ?').run(T0 + 71000, 'alice');
    state = await mutateSponsors(db, 'alice', { ...view, sequence: 5 }, T0 + 71000);
    assert.equal(state.campaigns[0].report.visibleSeconds, 30);
    await assert.rejects(mutateSponsors(db, 'alice', { ...view, sequence: 3 }, T0 + 72000), { code: 'VIEW_SEQUENCE_CONFLICT' });
    await assert.rejects(mutateSponsors(db, 'bob', view, T0 + 72000), { code: 'CAMPAIGN_NOT_FOUND' });
    await assert.rejects(mutateSponsors(db, 'alice', { ...view, simulation: false }, T0 + 72000), { code: 'REAL_REPORTING_UNAVAILABLE' });
    await mutateSponsors(db, 'alice', { action: 'pause', campaignId }, T0 + 73000);
    await assert.rejects(mutateSponsors(db, 'alice', { ...view, sequence: 6 }, T0 + 74000), { code: 'CAMPAIGN_NOT_LIVE' });
  } finally { db.sql.close(); }
});

test('campaign pause/resume and inactive reward session reset visibility baselines', async () => {
  const db = database();
  try {
    let state = await mutateSponsors(db, 'alice', PLAN, T0);
    const campaignId = state.campaigns[0].id;
    const sessionId = 'active-reward-session';
    const view = { action: 'record_view', campaignId, sessionId, sequence: 0, visible: true, simulation: true };
    await mutateSponsors(db, 'alice', settlement(campaignId), T0);
    db.sql.prepare('INSERT INTO reward_accounts (user_id, day_key, created_at, session_id, last_seen, last_visible) VALUES (?, ?, ?, ?, ?, 1)').run('alice', '2026-11-25', T0, sessionId, T0);
    await mutateSponsors(db, 'alice', view, T0);
    await mutateSponsors(db, 'alice', { action: 'pause', campaignId }, T0 + 5000);
    await mutateSponsors(db, 'alice', { action: 'resume', campaignId }, T0 + 10000);
    state = await mutateSponsors(db, 'alice', { ...view, sequence: 1 }, T0 + 15000);
    assert.equal(state.campaigns[0].report.visibleSeconds, 0);
    state = await mutateSponsors(db, 'alice', { ...view, sequence: 2 }, T0 + 30000);
    assert.equal(state.campaigns[0].report.visibleSeconds, 15);
    db.sql.prepare('UPDATE reward_accounts SET last_visible = 0 WHERE user_id = ?').run('alice');
    await assert.rejects(mutateSponsors(db, 'alice', { ...view, sequence: 3 }, T0 + 35000), { code: 'VIEW_REWARD_SESSION_INACTIVE' });
    db.sql.prepare('UPDATE reward_accounts SET last_visible = 1, last_seen = ? WHERE user_id = ?').run(T0 + 40000, 'alice');
    state = await mutateSponsors(db, 'alice', { ...view, sequence: 3 }, T0 + 40000);
    assert.equal(state.campaigns[0].report.visibleSeconds, 15);
    await assert.rejects(mutateSponsors(db, 'alice', { ...view, sessionId: 'invented-session-id', sequence: 0 }, T0 + 41000), { code: 'VIEW_REWARD_SESSION_INACTIVE' });
    db.sql.prepare('UPDATE reward_accounts SET session_id = NULL, last_visible = 0 WHERE user_id = ?').run('alice');
    state = await mutateSponsors(db, 'alice', { ...view, sequence: 4, visible: false }, T0 + 42000);
    assert.equal(state.campaigns[0].report.visibleSeconds, 15);
    assert.equal(state.campaigns[0].viewSession, null);
  } finally { db.sql.close(); }
});
