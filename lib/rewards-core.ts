import type { ExchangeMethod, RewardExchange, RewardHistory, RewardsSnapshot } from "./rewards-types";

export const RULES = Object.freeze({
  pointsPerMinute: 1 as const,
  dailyCap: 180 as const,
  minExchange: 100 as const,
  referenceJpyPerPoint: 1 as const,
  heartbeatSeconds: 15 as const,
});
export const SESSION_LEASE_MS = 45_000;
export const MAX_HEARTBEAT_GAP_MS = 30_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const JST_OFFSET = 9 * 60 * MINUTE_MS;

export class RewardError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type AccountRow = {
  user_id: string;
  balance: number;
  total_earned: number;
  total_active_ms: number;
  day_key: string;
  today_earned: number;
  today_active_ms: number;
  session_id: string | null;
  session_sequence: number;
  last_seen: number | null;
  last_visible: number;
  revision: number;
  last_mutation: string | null;
  created_at: number;
};

type DailyUpdate = { dayKey: string; points: number; activeMs: number };
type Accrual = {
  dayKey: string;
  todayEarned: number;
  todayActiveMs: number;
  activeDelta: number;
  earnedDelta: number;
  days: DailyUpdate[];
};

export function jstDay(now: number): string {
  return new Date(now + JST_OFFSET).toISOString().slice(0, 10);
}

function dayStart(now: number): number {
  return Math.floor((now + JST_OFFSET) / DAY_MS) * DAY_MS - JST_OFFSET;
}

function pointsForMs(ms: number): number {
  return Math.min(RULES.dailyCap, Math.floor(Math.max(0, ms) / MINUTE_MS));
}

/** Uses server timestamps only. Long/hidden gaps never earn retroactive points. */
export function calculateAccrual(account: AccountRow, now: number, visible: boolean): Accrual {
  const dayKey = jstDay(now);
  const sameDay = account.day_key === dayKey;
  let todayActiveMs = sameDay ? account.today_active_ms : 0;
  let todayEarned = sameDay ? account.today_earned : 0;
  let activeDelta = 0;
  let earnedDelta = 0;
  const days: DailyUpdate[] = [];
  const elapsed = account.last_seen === null ? 0 : now - account.last_seen;
  if (visible && account.last_visible === 1 && elapsed > 0 && elapsed <= MAX_HEARTBEAT_GAP_MS) {
    activeDelta = elapsed;
    const midnight = dayStart(now);
    if (!sameDay && account.last_seen !== null && account.last_seen < midnight && jstDay(account.last_seen) === account.day_key) {
      const previousMs = account.today_active_ms + midnight - account.last_seen;
      const previousPoints = pointsForMs(previousMs);
      earnedDelta += Math.max(0, previousPoints - account.today_earned);
      days.push({ dayKey: account.day_key, points: previousPoints, activeMs: previousMs });
      todayActiveMs = now - midnight;
    } else {
      todayActiveMs += elapsed;
    }
    const nextPoints = pointsForMs(todayActiveMs);
    earnedDelta += Math.max(0, nextPoints - todayEarned);
    todayEarned = nextPoints;
    days.push({ dayKey, points: todayEarned, activeMs: todayActiveMs });
  }
  return { dayKey, todayEarned, todayActiveMs, activeDelta, earnedDelta, days };
}

export function validateHeartbeat(account: AccountRow, payload: Record<string, unknown>, now: number): void {
  if (typeof payload.sessionId !== "string" || !Number.isSafeInteger(payload.sequence) || typeof payload.visible !== "boolean") {
    throw new RewardError(400, "INVALID_HEARTBEAT", "計測リクエストの形式を確認してください。");
  }
  if (!account.session_id || payload.sessionId !== account.session_id) {
    throw new RewardError(409, "SESSION_CONFLICT", "この画面の計測セッションは終了しています。再開してください。");
  }
  if (payload.sequence !== account.session_sequence) {
    throw new RewardError(409, "STALE_SEQUENCE", "重複した計測を受け取りました。最新の状態を読み込んでください。");
  }
  if (account.last_seen === null || now < account.last_seen || now - account.last_seen > SESSION_LEASE_MS) {
    throw new RewardError(409, "SESSION_EXPIRED", "計測が一時停止しました。画面を開いて再開してください。");
  }
}

export async function ensureAccount(db: D1Database, userId: string, now: number): Promise<AccountRow> {
  await db.prepare("INSERT OR IGNORE INTO reward_accounts (user_id, day_key, created_at) VALUES (?, ?, ?)")
    .bind(userId, jstDay(now), now).run();
  const account = await db.prepare("SELECT * FROM reward_accounts WHERE user_id = ?").bind(userId).first<AccountRow>();
  if (!account) throw new RewardError(503, "ACCOUNT_UNAVAILABLE", "ポイント情報を読み込めませんでした。しばらくしてから再度お試しください。");
  return account;
}

export async function snapshot(db: D1Database, userId: string, now = Date.now()): Promise<RewardsSnapshot> {
  const account = await ensureAccount(db, userId, now);
  const dayKey = jstDay(now);
  const monthKey = dayKey.slice(0, 7);
  const monthStart = `${monthKey}-01`;
  const nextMonthStart = new Date(Date.UTC(Number(dayKey.slice(0, 4)), Number(dayKey.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const firstDay = jstDay(now - 6 * DAY_MS);
  const [historyResult, exchangeResult, dailyResult, monthResult] = await db.batch([
    db.prepare("SELECT id, type, points, created_at AS createdAt, description FROM reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50").bind(userId),
    db.prepare("SELECT id, method, points, status, created_at AS createdAt FROM reward_exchanges WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 30").bind(userId),
    db.prepare("SELECT day_key AS dayKey, points FROM reward_daily WHERE user_id = ? AND day_key >= ? AND day_key <= ? ORDER BY day_key").bind(userId, firstDay, dayKey),
    db.prepare("SELECT COALESCE(SUM(active_ms), 0) AS activeMs FROM reward_daily WHERE user_id = ? AND day_key >= ? AND day_key < ? AND day_key <= ?").bind(userId, monthStart, nextMonthStart, dayKey),
  ]);
  const daily = new Map((dailyResult.results as { dayKey: string; points: number }[]).map((row) => [row.dayKey, row.points]));
  const sessionLive = account.session_id !== null && account.last_seen !== null && now - account.last_seen <= SESSION_LEASE_MS;
  return {
    mode: "demo",
    account: {
      balance: account.balance,
      totalEarned: account.total_earned,
      todayEarned: account.day_key === dayKey ? account.today_earned : 0,
      activeSeconds: Math.floor(account.total_active_ms / 1000),
      todaySeconds: account.day_key === dayKey ? Math.floor(account.today_active_ms / 1000) : 0,
      dayKey,
      monthSeconds: Math.floor(Number((monthResult.results[0] as { activeMs: number }).activeMs) / 1000),
      monthKey,
    },
    rules: { ...RULES },
    serverTime: now,
    session: sessionLive ? { id: account.session_id!, sequence: account.session_sequence, lastSeen: account.last_seen! } : null,
    history: historyResult.results as RewardHistory[],
    exchanges: exchangeResult.results as RewardExchange[],
    weekly: Array.from({ length: 7 }, (_, index) => {
      const key = jstDay(now - (6 - index) * DAY_MS);
      return { dayKey: key, points: daily.get(key) ?? 0 };
    }),
    payout: { enabled: false, reason: "体験ポイントは換金できません。実際の交換は、支払原資・送金事業者との契約・本人確認の準備後に開始します。" },
  };
}

function validateObject(payload: unknown): asserts payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new RewardError(400, "INVALID_REQUEST", "リクエストを確認してください。");
}

export async function mutateSession(db: D1Database, userId: string, payload: unknown, now = Date.now()): Promise<RewardsSnapshot> {
  validateObject(payload);
  if (typeof payload.action !== "string" || !["start", "heartbeat", "pause", "stop"].includes(payload.action)) throw new RewardError(400, "INVALID_ACTION", "操作を確認してください。");
  const account = await ensureAccount(db, userId, now);
  const token = crypto.randomUUID();
  const dayKey = jstDay(now);
  let sessionId = account.session_id;
  let sequence = account.session_sequence;
  let lastSeen: number | null = now;
  let visible = 0;
  let accrual: Accrual = { dayKey, todayEarned: account.day_key === dayKey ? account.today_earned : 0, todayActiveMs: account.day_key === dayKey ? account.today_active_ms : 0, activeDelta: 0, earnedDelta: 0, days: [] };
  if (payload.action === "start") {
    if (account.session_id && account.last_seen !== null && now - account.last_seen <= SESSION_LEASE_MS) {
      throw new RewardError(409, "SESSION_ACTIVE", "別の画面で計測中です。その画面を一時停止するか、45秒ほど待ってから再開してください。");
    }
    sessionId = crypto.randomUUID();
    sequence = 0;
    visible = 1;
  } else {
    if (payload.action === "heartbeat") {
      validateHeartbeat(account, payload, now);
      visible = payload.visible === true ? 1 : 0;
      accrual = calculateAccrual(account, now, visible === 1);
      sequence += 1;
    } else {
      if (typeof payload.sessionId !== "string" || payload.sessionId !== account.session_id) throw new RewardError(409, "SESSION_CONFLICT", "この画面の計測は終了しています。");
      sessionId = null;
      sequence = 0;
      lastSeen = null;
    }
  }
  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE reward_accounts SET balance = balance + ?, total_earned = total_earned + ?, total_active_ms = total_active_ms + ?, day_key = ?, today_earned = ?, today_active_ms = ?, session_id = ?, session_sequence = ?, last_seen = ?, last_visible = ?, revision = revision + 1, last_mutation = ? WHERE user_id = ? AND revision = ?")
      .bind(accrual.earnedDelta, accrual.earnedDelta, accrual.activeDelta, accrual.dayKey, accrual.todayEarned, accrual.todayActiveMs, sessionId, sequence, lastSeen, visible, token, userId, account.revision),
  ];
  if (accrual.earnedDelta > 0) {
    statements.push(db.prepare("INSERT INTO reward_ledger (id, user_id, type, points, created_at, description) SELECT ?, ?, 'earned', ?, ?, ? WHERE EXISTS (SELECT 1 FROM reward_accounts WHERE user_id = ? AND last_mutation = ?)")
      .bind(token, userId, accrual.earnedDelta, now, "画面を開いていた時間の体験ポイント", userId, token));
  }
  for (const day of accrual.days) {
    statements.push(db.prepare("INSERT INTO reward_daily (id, user_id, day_key, points, active_ms) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM reward_accounts WHERE user_id = ? AND last_mutation = ?) ON CONFLICT(user_id, day_key) DO UPDATE SET points = excluded.points, active_ms = excluded.active_ms")
      .bind(crypto.randomUUID(), userId, day.dayKey, day.points, day.activeMs, userId, token));
  }
  const result = await db.batch(statements);
  if (result[0].meta.changes !== 1) throw new RewardError(409, "CONCURRENT_UPDATE", "別の操作が先に完了しました。最新の状態を読み込んでください。");
  return snapshot(db, userId, now);
}

export async function mutateExchange(db: D1Database, userId: string, payload: unknown, now = Date.now()): Promise<RewardsSnapshot> {
  validateObject(payload);
  if (payload.simulation !== true) throw new RewardError(503, "PAYOUT_NOT_CONFIGURED", "実際の送金はまだ利用できません。体験ポイントは換金できません。");
  const account = await ensureAccount(db, userId, now);
  const token = crypto.randomUUID();
  if (payload.action === "cancel") {
    if (typeof payload.id !== "string" || payload.id.length > 100) throw new RewardError(400, "INVALID_EXCHANGE", "交換履歴を確認してください。");
    const exchange = await db.prepare("SELECT id, points, status FROM reward_exchanges WHERE id = ? AND user_id = ?").bind(payload.id, userId).first<{ id: string; points: number; status: string }>();
    if (!exchange) throw new RewardError(404, "EXCHANGE_NOT_FOUND", "交換履歴が見つかりません。");
    if (exchange.status === "cancelled") return snapshot(db, userId, now);
    const result = await db.batch([
      db.prepare("UPDATE reward_accounts SET balance = balance + ?, revision = revision + 1, last_mutation = ? WHERE user_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM reward_exchanges WHERE id = ? AND user_id = ? AND status = 'simulated')").bind(exchange.points, token, userId, account.revision, exchange.id, userId),
      db.prepare("UPDATE reward_exchanges SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'simulated' AND EXISTS (SELECT 1 FROM reward_accounts WHERE user_id = ? AND last_mutation = ?)").bind(exchange.id, userId, userId, token),
      db.prepare("INSERT INTO reward_ledger (id, user_id, type, points, created_at, description) SELECT ?, ?, 'refund', ?, ?, ? WHERE EXISTS (SELECT 1 FROM reward_accounts WHERE user_id = ? AND last_mutation = ?)").bind(token, userId, exchange.points, now, "交換体験の取り消し・体験ポイント返却", userId, token),
    ]);
    if (result[0].meta.changes !== 1) throw new RewardError(409, "CONCURRENT_UPDATE", "状態が更新されました。もう一度お試しください。");
    return snapshot(db, userId, now);
  }
  if (payload.action !== undefined && payload.action !== "create") throw new RewardError(400, "INVALID_ACTION", "操作を確認してください。");
  if (typeof payload.method !== "string" || !["bank", "btc", "eth"].includes(payload.method) || !Number.isSafeInteger(payload.points) || Number(payload.points) < RULES.minExchange || Number(payload.points) > 10_000_000) {
    throw new RewardError(400, "INVALID_EXCHANGE", `${RULES.minExchange}pt以上の整数と交換方法を指定してください。`);
  }
  if (typeof payload.idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(payload.idempotencyKey)) throw new RewardError(400, "INVALID_IDEMPOTENCY_KEY", "交換リクエストを確認してください。");
  const existing = await db.prepare("SELECT method, points FROM reward_exchanges WHERE user_id = ? AND idempotency_key = ?").bind(userId, payload.idempotencyKey).first<{ method: string; points: number }>();
  if (existing) {
    if (existing.method !== payload.method || existing.points !== payload.points) throw new RewardError(409, "IDEMPOTENCY_CONFLICT", "同じリクエストで内容を変更できません。");
    return snapshot(db, userId, now);
  }
  const points = Number(payload.points);
  if (points > account.balance) throw new RewardError(409, "INSUFFICIENT_POINTS", "体験ポイントが不足しています。");
  const method = payload.method as ExchangeMethod;
  const methodLabel = method === "bank" ? "銀行振込" : method.toUpperCase();
  const result = await db.batch([
    db.prepare("UPDATE reward_accounts SET balance = balance - ?, revision = revision + 1, last_mutation = ? WHERE user_id = ? AND revision = ? AND balance >= ? AND NOT EXISTS (SELECT 1 FROM reward_exchanges WHERE user_id = ? AND idempotency_key = ?)").bind(points, token, userId, account.revision, points, userId, payload.idempotencyKey),
    db.prepare("INSERT INTO reward_exchanges (id, user_id, method, points, status, idempotency_key, created_at) SELECT ?, ?, ?, ?, 'simulated', ?, ? WHERE EXISTS (SELECT 1 FROM reward_accounts WHERE user_id = ? AND last_mutation = ?)").bind(token, userId, method, points, payload.idempotencyKey, now, userId, token),
    db.prepare("INSERT INTO reward_ledger (id, user_id, type, points, created_at, description) SELECT ?, ?, 'exchange', ?, ?, ? WHERE EXISTS (SELECT 1 FROM reward_accounts WHERE user_id = ? AND last_mutation = ?)").bind(token, userId, -points, now, `${methodLabel}への交換体験（送金なし）`, userId, token),
  ]);
  if (result[0].meta.changes !== 1) {
    const repeated = await db.prepare("SELECT method, points FROM reward_exchanges WHERE user_id = ? AND idempotency_key = ?").bind(userId, payload.idempotencyKey).first<{ method: string; points: number }>();
    if (repeated && repeated.method === method && repeated.points === points) return snapshot(db, userId, now);
    throw new RewardError(409, "CONCURRENT_UPDATE", "ポイントが更新されました。最新の状態を確認してください。");
  }
  return snapshot(db, userId, now);
}
