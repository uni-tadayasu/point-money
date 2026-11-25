import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { calculateAccrual, ensureAccount, jstDay, mutateExchange, mutateSession, snapshot, validateHeartbeat } from '../lib/rewards-core.ts';
import { advanceLocalRewardTime, createLocalRewardData, localTimeCoverageNote, normalizeLocalRewardData } from '../lib/rewards-local.ts';

const T0 = Date.parse('2026-11-25T03:00:00.000Z');

// SQLite executes the same statements as D1. Each batch is an atomic transaction.
function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE reward_accounts (user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, total_earned INTEGER NOT NULL DEFAULT 0, total_active_ms INTEGER NOT NULL DEFAULT 0, day_key TEXT NOT NULL, today_earned INTEGER NOT NULL DEFAULT 0, today_active_ms INTEGER NOT NULL DEFAULT 0, session_id TEXT, session_sequence INTEGER NOT NULL DEFAULT 0, last_seen INTEGER, last_visible INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, last_mutation TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE reward_daily (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, day_key TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0, active_ms INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id, day_key));
    CREATE TABLE reward_ledger (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, points INTEGER NOT NULL, created_at INTEGER NOT NULL, description TEXT NOT NULL);
    CREATE TABLE reward_exchanges (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, method TEXT NOT NULL, points INTEGER NOT NULL, status TEXT NOT NULL, idempotency_key TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(user_id, idempotency_key));
  `);
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

function heartbeat(state, visible = true) {
  return { action: 'heartbeat', sessionId: state.session.id, sequence: state.session.sequence, visible };
}

test('new account starts at zero; 60 measured seconds earn exactly one point', async () => {
  const db = database();
  let state = await snapshot(db, 'alice', T0);
  assert.equal(state.account.balance, 0);
  assert.equal(state.mode, 'demo');
  assert.equal(state.payout.enabled, false);
  state = await mutateSession(db, 'alice', { action: 'start' }, T0);
  for (let i = 1; i <= 4; i++) state = await mutateSession(db, 'alice', heartbeat(state), T0 + i * 15_000);
  assert.equal(state.account.balance, 1);
  assert.equal(state.account.todaySeconds, 60);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].points, 1);
  assert.equal(state.weekly.at(-1).points, 1);
  assert.equal(state.session.sequence, 4);
  db.sql.close();
});

test('server ignores client balances, elapsed time, rates and future client timestamps', async () => {
  const db = database();
  let state = await mutateSession(db, 'alice', { action: 'start', balance: 1000000 }, T0);
  state = await mutateSession(db, 'alice', { ...heartbeat(state), balance: 1000000, elapsed: 99999999, rate: 100000, timestamp: 99999999999999 }, T0 + 15_000);
  assert.equal(state.account.balance, 0);
  assert.equal(state.account.todaySeconds, 15);
  db.sql.close();
});

test('duplicate heartbeats and multiple concurrent tabs cannot double credit', async () => {
  const db = database();
  const starts = await Promise.allSettled([
    mutateSession(db, 'alice', { action: 'start' }, T0),
    mutateSession(db, 'alice', { action: 'start' }, T0),
  ]);
  assert.equal(starts.filter((r) => r.status === 'fulfilled').length, 1);
  let state = starts.find((r) => r.status === 'fulfilled').value;
  await assert.rejects(mutateSession(db, 'alice', { action: 'start' }, T0 + 10), { code: 'SESSION_ACTIVE' });
  const payload = heartbeat(state);
  const results = await Promise.allSettled([
    mutateSession(db, 'alice', payload, T0 + 15_000),
    mutateSession(db, 'alice', payload, T0 + 15_000),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await assert.rejects(mutateSession(db, 'alice', payload, T0 + 15_001), { code: 'STALE_SEQUENCE' });
  state = await snapshot(db, 'alice', T0 + 15_002);
  assert.equal(state.account.todaySeconds, 15);
  assert.equal(state.session.sequence, 1);
  db.sql.close();
});

test('hidden intervals, resumed baselines, long gaps and expired sessions do not backfill', async () => {
  const db = database();
  let state = await mutateSession(db, 'alice', { action: 'start' }, T0);
  state = await mutateSession(db, 'alice', heartbeat(state, false), T0 + 15_000);
  state = await mutateSession(db, 'alice', heartbeat(state, true), T0 + 30_000);
  assert.equal(state.account.todaySeconds, 0);
  state = await mutateSession(db, 'alice', heartbeat(state), T0 + 45_000);
  assert.equal(state.account.todaySeconds, 15);
  state = await mutateSession(db, 'alice', heartbeat(state), T0 + 76_000);
  assert.equal(state.account.todaySeconds, 15);
  await assert.rejects(mutateSession(db, 'alice', heartbeat(state), T0 + 122_000), { code: 'SESSION_EXPIRED' });
  state = await mutateSession(db, 'alice', { action: 'start' }, T0 + 122_000);
  assert.equal(state.account.todaySeconds, 15);
  const paused = await mutateSession(db, 'alice', { action: 'pause', sessionId: state.session.id }, T0 + 125_000);
  assert.equal(paused.session, null);
  assert.equal(paused.account.todaySeconds, 15);
  db.sql.close();
});

test('daily limit and JST midnight split preserve already earned points', async () => {
  const db = database();
  const before = Date.parse('2026-11-25T14:59:50.000Z');
  await ensureAccount(db, 'alice', before);
  db.sql.prepare('UPDATE reward_accounts SET today_active_ms = ?, today_earned = ?, balance = ?, total_earned = ?, session_id = ?, session_sequence = 0, last_seen = ?, last_visible = 1 WHERE user_id = ?')
    .run(59_000, 0, 0, 0, 'session-midnight', before, 'alice');
  let state = await mutateSession(db, 'alice', { action: 'heartbeat', sessionId: 'session-midnight', sequence: 0, visible: true }, before + 20_000);
  assert.equal(state.account.dayKey, '2026-11-26');
  assert.equal(state.account.balance, 1);
  assert.equal(state.account.todayEarned, 0);
  assert.equal(state.account.todaySeconds, 10);
  assert.equal(state.weekly.at(-2).points, 1);
  db.sql.prepare('UPDATE reward_accounts SET today_active_ms = ?, today_earned = ?, balance = 180, total_earned = 180 WHERE user_id = ?').run(180 * 60_000, 180, 'alice');
  state = await mutateSession(db, 'alice', heartbeat(state), before + 35_000);
  assert.equal(state.account.balance, 180);
  assert.equal(state.account.todayEarned, 180);
  db.sql.close();
});

test('simulation exchange is atomic, idempotent, and refunds at most once', async () => {
  const db = database();
  await ensureAccount(db, 'alice', T0);
  db.sql.prepare('UPDATE reward_accounts SET balance = 200, total_earned = 200 WHERE user_id = ?').run('alice');
  const payload = { method: 'bank', points: 100, idempotencyKey: 'request-12345', simulation: true };
  const results = await Promise.allSettled([
    mutateExchange(db, 'alice', payload, T0 + 1000),
    mutateExchange(db, 'alice', payload, T0 + 1000),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
  let state = await snapshot(db, 'alice', T0 + 1001);
  assert.equal(state.account.balance, 100);
  assert.equal(state.exchanges.length, 1);
  assert.equal(state.history.length, 1);
  assert.equal(state.exchanges[0].status, 'simulated');
  await assert.rejects(mutateExchange(db, 'alice', { ...payload, method: 'btc' }, T0 + 1002), { code: 'IDEMPOTENCY_CONFLICT' });
  const cancel = { action: 'cancel', id: state.exchanges[0].id, simulation: true };
  await mutateExchange(db, 'alice', cancel, T0 + 1003);
  state = await mutateExchange(db, 'alice', cancel, T0 + 1004);
  assert.equal(state.account.balance, 200);
  assert.equal(state.history.filter((row) => row.type === 'refund').length, 1);
  assert.equal(state.exchanges[0].status, 'cancelled');
  db.sql.close();
});

test('concurrent independent exchange requests cannot overspend', async () => {
  const db = database();
  await ensureAccount(db, 'alice', T0);
  db.sql.prepare('UPDATE reward_accounts SET balance = 100 WHERE user_id = ?').run('alice');
  const requests = await Promise.allSettled([
    mutateExchange(db, 'alice', { method: 'btc', points: 100, idempotencyKey: 'bitcoin-request', simulation: true }, T0),
    mutateExchange(db, 'alice', { method: 'eth', points: 100, idempotencyKey: 'ethereum-request', simulation: true }, T0),
  ]);
  assert.equal(requests.filter((r) => r.status === 'fulfilled').length, 1);
  const state = await snapshot(db, 'alice', T0);
  assert.equal(state.account.balance, 0);
  assert.equal(state.exchanges.length, 1);
  db.sql.close();
});

test('payouts fail closed, negative/fractional requests fail, users cannot access each other', async () => {
  const db = database();
  await ensureAccount(db, 'alice', T0);
  db.sql.prepare('UPDATE reward_accounts SET balance = 300 WHERE user_id = ?').run('alice');
  const payload = { method: 'bank', points: 100, idempotencyKey: 'request-ownership', simulation: true };
  await assert.rejects(mutateExchange(db, 'alice', { ...payload, simulation: false }, T0), { code: 'PAYOUT_NOT_CONFIGURED', status: 503 });
  await assert.rejects(mutateExchange(db, 'alice', { ...payload, points: -100 }, T0), { code: 'INVALID_EXCHANGE' });
  await assert.rejects(mutateExchange(db, 'alice', { ...payload, points: 100.5 }, T0), { code: 'INVALID_EXCHANGE' });
  let state = await snapshot(db, 'alice', T0);
  assert.equal(state.account.balance, 300);
  state = await mutateExchange(db, 'alice', payload, T0);
  await assert.rejects(mutateExchange(db, 'bob', { action: 'cancel', id: state.exchanges[0].id, simulation: true }, T0), { code: 'EXCHANGE_NOT_FOUND' });
  const bob = await snapshot(db, 'bob', T0);
  assert.equal(bob.account.balance, 0);
  assert.equal(bob.history.length, 0);
  assert.equal(bob.exchanges.length, 0);
  assert.equal((await snapshot(db, 'alice', T0)).account.balance, 200);
  db.sql.close();
});

test('monthly time uses the authenticated account and JST month boundaries, including days outside the week', async () => {
  const db = database();
  await ensureAccount(db, 'alice', T0);
  const insert = db.sql.prepare('INSERT INTO reward_daily (id, user_id, day_key, points, active_ms) VALUES (?, ?, ?, ?, ?)');
  insert.run('older-month', 'alice', '2026-10-31', 1, 999_000);
  insert.run('first-day', 'alice', '2026-11-01', 1, 61_500);
  insert.run('earlier-this-month', 'alice', '2026-11-10', 1, 122_500);
  insert.run('current-day', 'alice', '2026-11-25', 1, 6_000);
  insert.run('future-day', 'alice', '2026-11-26', 1, 500_000);
  insert.run('future-month', 'alice', '2026-12-01', 1, 999_000);
  insert.run('other-account', 'bob', '2026-11-25', 1, 999_000);
  const state = await snapshot(db, 'alice', T0);
  assert.equal(state.account.monthKey, '2026-11');
  assert.equal(state.account.monthSeconds, 190);
  assert.equal(state.weekly.length, 7);
  assert.equal(state.account.balance, 0);
  db.sql.close();
});

test('a heartbeat across JST month-end keeps both daily totals and starts the new month at its own seconds', async () => {
  const db = database();
  const before = Date.parse('2026-11-30T14:59:50.000Z');
  await ensureAccount(db, 'alice', before);
  db.sql.prepare('UPDATE reward_accounts SET today_active_ms = 59000, today_earned = 0, session_id = ?, session_sequence = 0, last_seen = ?, last_visible = 1 WHERE user_id = ?').run('month-rollover', before, 'alice');
  const next = await mutateSession(db, 'alice', { action: 'heartbeat', sessionId: 'month-rollover', sequence: 0, visible: true }, before + 20_000);
  assert.equal(next.account.monthKey, '2026-12');
  assert.equal(next.account.todaySeconds, 10);
  assert.equal(next.account.monthSeconds, 10);
  assert.equal(next.account.balance, 1);
  const rows = db.sql.prepare('SELECT day_key, active_ms FROM reward_daily WHERE user_id = ? ORDER BY day_key').all('alice');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].day_key, '2026-11-30');
  assert.equal(rows[0].active_ms, 69_000);
  assert.equal(rows[1].day_key, '2026-12-01');
  assert.equal(rows[1].active_ms, 10_000);
  db.sql.close();
});

test('local legacy migration preserves points and only carries the recorded day milliseconds', () => {
  const now = Date.parse('2026-11-25T03:00:00.000Z');
  const base = createLocalRewardData(now);
  const { dayStats, timeSchema, limitedMonth, ...legacy } = base;
  legacy.account.balance = 77;
  legacy.account.totalEarned = 187;
  legacy.account.todayEarned = 7;
  legacy.localMs = 420_500;
  legacy.totalMs = 10_000_000;
  legacy.weekly[0].points = 180;
  const migrated = normalizeLocalRewardData(legacy, now);
  assert.equal(migrated.account.balance, 77);
  assert.equal(migrated.account.totalEarned, 187);
  assert.equal(migrated.account.monthSeconds, 420);
  assert.equal(migrated.dayStats['2026-11-25'].activeMs, 420_500);
  assert.ok(localTimeCoverageNote(migrated));
  assert.equal(Object.keys(migrated.dayStats).length, 1);
});

test('local time continues after the point cap and splits month-end without counting long gaps', () => {
  const before = Date.parse('2026-11-30T14:59:59.000Z');
  let state = createLocalRewardData(before);
  state.dayStats['2026-11-30'] = { activeMs: 10_800_000, points: 180 };
  state.totalMs = 10_800_000;
  state.account.balance = 180;
  state.account.totalEarned = 180;
  state = normalizeLocalRewardData(state, before);
  advanceLocalRewardTime(state, 1000, before + 1000);
  assert.equal(state.account.balance, 180);
  assert.equal(state.dayStats['2026-11-30'].activeMs, 10_801_000);
  assert.equal(state.account.dayKey, '2026-12-01');
  assert.equal(state.account.monthSeconds, 0);
  advanceLocalRewardTime(state, 1500, before + 2500);
  assert.equal(state.account.todaySeconds, 1);
  assert.equal(state.account.monthSeconds, 1);
  const recorded = state.totalMs;
  advanceLocalRewardTime(state, 30_000, before + 32_500);
  assert.equal(state.totalMs, recorded);
  assert.equal(state.account.monthSeconds, 1);
});
