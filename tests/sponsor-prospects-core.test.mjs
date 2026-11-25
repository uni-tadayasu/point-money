import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { mutateSponsorProspects, sponsorProspectsSnapshot } from '../lib/sponsor-prospects-core.ts';

const NOW = Date.parse('2026-11-25T09:00:00.000Z');
const draft = { action: 'create', companyName: '記録テストの企業', websiteUrl: 'https://example.com', estimatedAmountYen: 50_000, stage: 'candidate', notes: '手入力の予定額。入金証明ではありません。' };

function database() {
  const sql = new DatabaseSync(':memory:');
  // Apply actual committed migrations: schema drift should fail this integration test.
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  for (const entry of journal.entries) sql.exec(readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8'));
  class Statement {
    constructor(query, values = []) { this.query = query; this.values = values; }
    bind(...values) { return new Statement(this.query, values); }
    async first() { return sql.prepare(this.query).get(...this.values) ?? null; }
    execute() {
      const statement = sql.prepare(this.query);
      if (statement.columns().length) return { success: true, results: statement.all(...this.values), meta: { changes: 0 } };
      return { success: true, results: [], meta: { changes: Number(statement.run(...this.values).changes) } };
    }
    async run() { return this.execute(); }
  }
  return { sql, prepare(query) { return new Statement(query); }, async batch(statements) {
    sql.exec('BEGIN IMMEDIATE');
    try { const results = statements.map((statement) => statement.execute()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
}

test('empty sales plan has no invented prospects; agreed amounts never create rewards or sponsor funds', async () => {
  const db = database();
  const empty = await sponsorProspectsSnapshot(db, 'alice', NOW);
  assert.equal(empty.kind, 'sales_plan');
  assert.deepEqual(empty.prospects, []);
  assert.deepEqual({ ...empty.summary }, { count: 0, activeCount: 0, estimatedAmountYen: 0 });
  const state = await mutateSponsorProspects(db, 'alice', { ...draft, stage: 'agreed' }, NOW);
  assert.equal(state.prospects.length, 1);
  assert.equal(state.summary.estimatedAmountYen, 50_000);
  for (const table of ['reward_accounts', 'reward_ledger', 'reward_exchanges', 'sponsor_campaigns', 'sponsor_settlements']) assert.equal(db.sql.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  assert.equal('verifiedFunds' in state, false);
  assert.equal('realReceivedYen' in state.summary, false);
  db.sql.close();
});

test('prospects are fully account-scoped for reads, updates and archiving', async () => {
  const db = database();
  const alice = await mutateSponsorProspects(db, 'alice', draft, NOW);
  const item = alice.prospects[0];
  const bob = await sponsorProspectsSnapshot(db, 'bob', NOW);
  assert.equal(bob.prospects.length, 0);
  assert.equal(bob.summary.estimatedAmountYen, 0);
  await assert.rejects(mutateSponsorProspects(db, 'bob', { ...draft, action: 'update', id: item.id, revision: 0, companyName: '変更不可' }, NOW), { code: 'PROSPECT_NOT_FOUND', status: 404 });
  await assert.rejects(mutateSponsorProspects(db, 'bob', { action: 'archive', id: item.id, revision: 0 }, NOW), { code: 'PROSPECT_NOT_FOUND', status: 404 });
  const unchanged = await sponsorProspectsSnapshot(db, 'alice', NOW);
  assert.equal(unchanged.prospects[0].companyName, draft.companyName);
  assert.equal(unchanged.prospects[0].revision, 0);
  db.sql.close();
});

test('amount, text, HTTPS, stage and unsupported money fields are validated before writes', async () => {
  const db = database();
  for (const estimatedAmountYen of [-1, 0.5, 10_000_001, '50000', null]) await assert.rejects(mutateSponsorProspects(db, 'alice', { ...draft, estimatedAmountYen }, NOW), { code: 'INVALID_AMOUNT', status: 400 });
  for (const stage of ['paid', 'verified', '', {}, null]) await assert.rejects(mutateSponsorProspects(db, 'alice', { ...draft, stage }, NOW), { code: 'INVALID_STAGE', status: 400 });
  for (const websiteUrl of ['javascript:alert(1)', 'http://example.com', 'https://name:password@example.com']) await assert.rejects(mutateSponsorProspects(db, 'alice', { ...draft, websiteUrl }, NOW), { code: 'INVALID_URL', status: 400 });
  await assert.rejects(mutateSponsorProspects(db, 'alice', { ...draft, companyName: ' ' }, NOW), { code: 'INVALID_TEXT' });
  await assert.rejects(mutateSponsorProspects(db, 'alice', { ...draft, companyName: 'x'.repeat(81) }, NOW), { code: 'INVALID_TEXT' });
  await assert.rejects(mutateSponsorProspects(db, 'alice', { ...draft, notes: 'x'.repeat(1001) }, NOW), { code: 'INVALID_TEXT' });
  await assert.rejects(mutateSponsorProspects(db, 'alice', { ...draft, verifiedFunds: 1_000_000 }, NOW), { code: 'UNSUPPORTED_FIELD' });
  assert.equal((await sponsorProspectsSnapshot(db, 'alice', NOW)).prospects.length, 0);
  const allowed = await mutateSponsorProspects(db, 'alice', { ...draft, websiteUrl: '', estimatedAmountYen: 0 }, NOW);
  assert.equal(allowed.prospects[0].websiteUrl, null);
  assert.equal(allowed.prospects[0].estimatedAmountYen, 0);
  db.sql.close();
});

test('all six plan stages are accepted; closed and archived amounts are excluded from active totals', async () => {
  const db = database();
  for (const stage of ['candidate', 'preparing', 'contacted', 'negotiating', 'agreed', 'closed']) await mutateSponsorProspects(db, 'alice', { ...draft, companyName: stage, estimatedAmountYen: 100_000, stage }, NOW);
  let state = await sponsorProspectsSnapshot(db, 'alice', NOW);
  assert.equal(state.summary.count, 6);
  assert.equal(state.summary.activeCount, 5);
  assert.equal(state.summary.estimatedAmountYen, 500_000);
  const item = state.prospects.find((row) => row.stage === 'agreed');
  state = await mutateSponsorProspects(db, 'alice', { action: 'archive', id: item.id, revision: item.revision }, NOW + 1);
  assert.equal(state.summary.count, 6);
  assert.equal(state.summary.activeCount, 4);
  assert.equal(state.summary.estimatedAmountYen, 400_000);
  assert.equal(state.prospects.find((row) => row.id === item.id).archivedAt, NOW + 1);
  await assert.rejects(mutateSponsorProspects(db, 'alice', { ...draft, action: 'update', id: item.id, revision: 1 }, NOW + 2), { code: 'PROSPECT_ARCHIVED' });
  db.sql.close();
});

test('stale or racing revisions cannot overwrite a newer sales note', async () => {
  const db = database();
  const state = await mutateSponsorProspects(db, 'alice', draft, NOW);
  const item = state.prospects[0];
  const results = await Promise.allSettled([
    mutateSponsorProspects(db, 'alice', { ...draft, action: 'update', id: item.id, revision: 0, notes: '先の更新' }, NOW + 1),
    mutateSponsorProspects(db, 'alice', { ...draft, action: 'update', id: item.id, revision: 0, notes: '競合する更新' }, NOW + 1),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'PROSPECT_CONFLICT');
  const current = (await sponsorProspectsSnapshot(db, 'alice', NOW + 1)).prospects[0];
  assert.equal(current.revision, 1);
  assert.equal(current.createdAt, NOW);
  assert.equal(current.updatedAt, NOW + 1);
  await assert.rejects(mutateSponsorProspects(db, 'alice', { action: 'archive', id: item.id, revision: 0 }, NOW + 2), { code: 'PROSPECT_CONFLICT' });
  await assert.rejects(mutateSponsorProspects(db, 'alice', { ...draft, action: 'update', id: item.id }, NOW + 2), { code: 'INVALID_REVISION' });
  assert.equal((await sponsorProspectsSnapshot(db, 'alice', NOW + 2)).prospects[0].notes, current.notes);
  db.sql.close();
});
