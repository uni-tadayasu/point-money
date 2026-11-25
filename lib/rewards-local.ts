import type { RewardsSnapshot } from "./rewards-types";

type DayTime = { activeMs: number; points: number };
export type LocalRewardData = RewardsSnapshot & {
  localMs: number;
  totalMs: number;
  timeSchema: 2;
  dayStats: Record<string, DayTime>;
  limitedMonth: string | null;
};

const DAY_MS = 86_400_000;
const JST_MS = 9 * 3_600_000;
const CAP = 180;
const dayKey = (now: number) => new Date(now + JST_MS).toISOString().slice(0, 10);
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const pointInteger = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value);
const validDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));

export function createLocalRewardData(now = Date.now()): LocalRewardData {
  const today = dayKey(now);
  return {
    mode: "demo",
    account: { balance: 0, totalEarned: 0, todayEarned: 0, activeSeconds: 0, todaySeconds: 0, dayKey: today, monthSeconds: 0, monthKey: today.slice(0, 7) },
    rules: { pointsPerMinute: 1, dailyCap: CAP, minExchange: 100, referenceJpyPerPoint: 1, heartbeatSeconds: 15 },
    serverTime: now, session: null, history: [], exchanges: [],
    weekly: Array.from({ length: 7 }, (_, index) => ({ dayKey: dayKey(now - (6 - index) * DAY_MS), points: 0 })),
    payout: { enabled: false, reason: "体験版のポイントは換金できません。" },
    localMs: 0, totalMs: 0, timeSchema: 2, dayStats: { [today]: { activeMs: 0, points: 0 } }, limitedMonth: null,
  };
}

function updateTotals(data: LocalRewardData, now: number): LocalRewardData {
  const today = dayKey(now);
  const month = today.slice(0, 7);
  const current = data.dayStats[today] ?? { activeMs: 0, points: 0 };
  data.dayStats[today] = current;
  data.localMs = current.activeMs;
  data.account.dayKey = today;
  data.account.todaySeconds = Math.floor(current.activeMs / 1000);
  data.account.todayEarned = current.points;
  data.account.activeSeconds = Math.floor(data.totalMs / 1000);
  data.account.monthKey = month;
  data.account.monthSeconds = Math.floor(Object.entries(data.dayStats).reduce((sum, [key, value]) => sum + (key.startsWith(`${month}-`) && key <= today ? value.activeMs : 0), 0) / 1000);
  const previousPoints = new Map(data.weekly.map((entry) => [entry.dayKey, entry.points]));
  data.weekly = Array.from({ length: 7 }, (_, index) => {
    const key = dayKey(now - (6 - index) * DAY_MS);
    return { dayKey: key, points: data.dayStats[key]?.points ?? previousPoints.get(key) ?? 0 };
  });
  data.serverTime = now;
  data.session = null;
  return data;
}

/** Legacy storage has exact milliseconds only for its last day. Never infer time from points. */
export function normalizeLocalRewardData(input: unknown, now = Date.now()): LocalRewardData {
  const empty = createLocalRewardData(now);
  if (!input || typeof input !== "object") return empty;
  const old = input as Partial<LocalRewardData>;
  if (!nonnegative(old.localMs) || !nonnegative(old.totalMs) || !pointInteger(old.account?.balance) || !Array.isArray(old.history) || !Array.isArray(old.exchanges) || !Array.isArray(old.weekly)) return empty;
  const result: LocalRewardData = {
    ...empty,
    account: { ...empty.account, balance: old.account.balance, totalEarned: pointInteger(old.account.totalEarned) ? old.account.totalEarned : 0 },
    totalMs: old.totalMs,
    history: old.history.slice(0, 500),
    exchanges: old.exchanges.slice(0, 100),
    weekly: old.weekly.filter((item) => validDay(item?.dayKey) && pointInteger(item?.points)).slice(0, 7),
    dayStats: {},
    limitedMonth: typeof old.limitedMonth === "string" && /^\d{4}-\d{2}$/.test(old.limitedMonth) ? old.limitedMonth : null,
  };
  if (old.timeSchema === 2 && old.dayStats && typeof old.dayStats === "object" && !Array.isArray(old.dayStats)) {
    for (const [key, record] of Object.entries(old.dayStats)) {
      if (validDay(key) && nonnegative(record?.activeMs) && pointInteger(record?.points) && record.points <= CAP) result.dayStats[key] = { activeMs: record.activeMs, points: record.points };
    }
  } else {
    if (validDay(old.account.dayKey)) {
      result.dayStats[old.account.dayKey] = { activeMs: old.localMs, points: pointInteger(old.account.todayEarned) ? Math.min(CAP, old.account.todayEarned) : 0 };
      if (old.totalMs > old.localMs) result.limitedMonth = old.account.dayKey.slice(0, 7);
    } else if (old.totalMs > 0) result.limitedMonth = dayKey(now).slice(0, 7);
  }
  return updateTotals(result, now);
}

/** Add only a short, observed foreground interval, splitting it at JST midnight. */
export function advanceLocalRewardTime(data: LocalRewardData, milliseconds: number, now = Date.now()): LocalRewardData {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 2500) return updateTotals(data, now);
  let cursor = now - milliseconds;
  let earned = 0;
  while (cursor < now) {
    const key = dayKey(cursor);
    const nextMidnight = (Math.floor((cursor + JST_MS) / DAY_MS) + 1) * DAY_MS - JST_MS;
    const end = Math.min(nextMidnight, now);
    const record = data.dayStats[key] ?? { activeMs: 0, points: 0 };
    record.activeMs += end - cursor;
    const nextPoints = Math.min(CAP, Math.floor(record.activeMs / 60_000));
    earned += Math.max(0, nextPoints - record.points);
    record.points = nextPoints;
    data.dayStats[key] = record;
    cursor = end;
  }
  data.totalMs += milliseconds;
  if (earned > 0) {
    data.account.balance += earned;
    data.account.totalEarned += earned;
    data.history.unshift({ id: crypto.randomUUID(), type: "earned", points: earned, createdAt: now, description: "表示時間によるテストポイント" });
    data.history = data.history.slice(0, 500);
  }
  return updateTotals(data, now);
}

export function localTimeCoverageNote(data: LocalRewardData): string {
  return data.limitedMonth === data.account.monthKey ? "以前の端末内記録に日別の時間がないため、今月の時間は保存されている日別記録の合計です。ポイント残高は引き継いでいます。" : "";
}
