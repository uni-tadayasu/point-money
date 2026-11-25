import type { SponsorAllocation, SponsorCampaign, SponsorSnapshot } from "./sponsor-types";

export const SPONSOR_ALLOCATION = Object.freeze({ reward: 50 as const, reserve: 20 as const, operations: 20 as const, growth: 10 as const });
const DAY_MS = 86_400_000;
const MAX_CAMPAIGNS = 100;

export class SponsorError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type CampaignRow = Omit<SponsorCampaign, "isLive" | "report" | "viewSession"> & { revision: number };
type SettlementIdentity = { campaign_id: string; deductions_yen: number };
const CAMPAIGN_COLUMNS = "id, company, title, description, url, amount_yen AS amountYen, days, status, created_at AS createdAt, starts_at AS startsAt, ends_at AS endsAt, revision";
const ZERO_ALLOCATION: SponsorAllocation = { grossYen: 0, deductionsYen: 0, netYen: 0, rewardYen: 0, reserveYen: 0, operationsYen: 0, growthYen: 0 };

function objectPayload(payload: unknown): asserts payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new SponsorError(400, "INVALID_REQUEST", "入力内容を確認してください。");
}

function cleanText(value: unknown, label: string, max: number, optional = false): string {
  if (typeof value !== "string") throw new SponsorError(400, "INVALID_CAMPAIGN", `${label}を入力してください。`);
  const result = value.trim();
  if ((!optional && !result) || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result)) throw new SponsorError(400, "INVALID_CAMPAIGN", `${label}は${max}文字以内で入力してください。`);
  return result;
}

export function validateSponsorCampaign(payload: unknown): Pick<SponsorCampaign, "company" | "title" | "description" | "url" | "amountYen" | "days"> {
  objectPayload(payload);
  const company = cleanText(payload.company, "企業・屋号", 80);
  const title = cleanText(payload.title, "掲載タイトル", 80);
  const description = cleanText(payload.description ?? "", "紹介文", 400, true);
  const rawUrl = cleanText(payload.url, "リンク先URL", 600);
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new SponsorError(400, "INVALID_URL", "httpsから始まるリンク先URLを入力してください。"); }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) throw new SponsorError(400, "INVALID_URL", "httpsから始まる公開サイトのURLを入力してください。");
  if (!Number.isSafeInteger(payload.amountYen) || Number(payload.amountYen) < 100 || Number(payload.amountYen) > 10_000_000) throw new SponsorError(400, "INVALID_AMOUNT", "協賛額は100円から1,000万円までの整数で入力してください。");
  if (!Number.isSafeInteger(payload.days) || Number(payload.days) < 1 || Number(payload.days) > 90) throw new SponsorError(400, "INVALID_DAYS", "掲載日数は1日から90日までの整数で入力してください。");
  return { company, title, description, url: url.toString(), amountYen: Number(payload.amountYen), days: Number(payload.days) };
}

/** Integer-yen allocation. Rounding remainder stays in growth, so totals always balance. */
export function allocateSponsorFunds(grossYen: number, deductionsYen: number): SponsorAllocation {
  if (!Number.isSafeInteger(grossYen) || grossYen < 0 || grossYen > 10_000_000 || !Number.isSafeInteger(deductionsYen) || deductionsYen < 0 || deductionsYen > 10_000_000) throw new SponsorError(400, "INVALID_AMOUNT", "金額は0円から1,000万円までの整数で入力してください。");
  const netYen = Math.max(0, grossYen - deductionsYen);
  const rewardYen = Math.floor(netYen * SPONSOR_ALLOCATION.reward / 100);
  const reserveYen = Math.floor(netYen * SPONSOR_ALLOCATION.reserve / 100);
  const operationsYen = Math.floor(netYen * SPONSOR_ALLOCATION.operations / 100);
  const growthYen = netYen - rewardYen - reserveYen - operationsYen;
  return { grossYen, deductionsYen, netYen, rewardYen, reserveYen, operationsYen, growthYen };
}

export async function sponsorSnapshot(db: D1Database, userId: string, now = Date.now()): Promise<SponsorSnapshot> {
  const [campaignResult, ledgerResult, totalsResult, reportsResult, viewSessionResult] = await db.batch([
    db.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM sponsor_campaigns WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`).bind(userId),
    db.prepare("SELECT s.id, s.campaign_id AS campaignId, c.title AS campaignTitle, s.gross_yen AS grossYen, s.deductions_yen AS deductionsYen, s.net_yen AS netYen, s.reward_yen AS rewardYen, s.reserve_yen AS reserveYen, s.operations_yen AS operationsYen, s.growth_yen AS growthYen, s.created_at AS createdAt FROM sponsor_settlements s JOIN sponsor_campaigns c ON c.id = s.campaign_id AND c.user_id = s.user_id WHERE s.user_id = ? AND s.simulation = 1 ORDER BY s.created_at DESC, s.id DESC LIMIT 100").bind(userId),
    db.prepare("SELECT COALESCE(SUM(gross_yen),0) AS grossYen, COALESCE(SUM(deductions_yen),0) AS deductionsYen, COALESCE(SUM(net_yen),0) AS netYen, COALESCE(SUM(reward_yen),0) AS rewardYen, COALESCE(SUM(reserve_yen),0) AS reserveYen, COALESCE(SUM(operations_yen),0) AS operationsYen, COALESCE(SUM(growth_yen),0) AS growthYen FROM sponsor_settlements WHERE user_id = ? AND simulation = 1").bind(userId),
    db.prepare("SELECT campaign_id AS campaignId, SUM(visible_ms) AS visibleMs, SUM(confirmed_intervals) AS confirmedIntervals FROM sponsor_views WHERE user_id = ? GROUP BY campaign_id").bind(userId),
    db.prepare("SELECT a.session_id AS sessionId, a.last_seen AS lastSeen, a.last_visible AS lastVisible, v.campaign_id AS campaignId, v.sequence FROM reward_accounts a LEFT JOIN sponsor_views v ON v.user_id = a.user_id AND v.session_id = a.session_id WHERE a.user_id = ?").bind(userId),
  ]);
  const reports = new Map((reportsResult.results as { campaignId: string; visibleMs: number; confirmedIntervals: number }[]).map((row) => [row.campaignId, { visibleSeconds: Math.floor(row.visibleMs / 1000), confirmedIntervals: row.confirmedIntervals }]));
  const viewRows = viewSessionResult.results as { sessionId: string | null; lastSeen: number | null; lastVisible: number; campaignId: string | null; sequence: number | null }[];
  const liveReward = viewRows[0]?.sessionId && viewRows[0].lastVisible === 1 && viewRows[0].lastSeen !== null && viewRows[0].lastSeen <= now && now - viewRows[0].lastSeen <= 45_000 ? viewRows[0] : null;
  const sequences = new Map(viewRows.filter((row) => row.campaignId && row.sequence !== null).map((row) => [row.campaignId!, row.sequence! + 1]));
  return {
    mode: "demo", simulation: true, currency: "JPY", serverTime: now,
    allocationRules: { ...SPONSOR_ALLOCATION },
    totals: { ...ZERO_ALLOCATION, ...(totalsResult.results[0] as SponsorAllocation), realReceivedYen: 0 },
    campaigns: (campaignResult.results as CampaignRow[]).map(({ revision: _revision, ...campaign }) => {
      const isLive = campaign.status === "active" && campaign.startsAt !== null && campaign.startsAt <= now && campaign.endsAt !== null && campaign.endsAt > now;
      return { ...campaign, isLive, report: reports.get(campaign.id) ?? { visibleSeconds: 0, confirmedIntervals: 0 }, viewSession: isLive && liveReward ? { id: liveReward.sessionId!, sequence: sequences.get(campaign.id) ?? 0 } : null };
    }),
    ledger: (ledgerResult.results as Omit<SponsorSnapshot["ledger"][number], "simulation">[]).map((entry) => ({ ...entry, simulation: true })),
    funding: { realEnabled: false, reason: "協賛の登録・入金・配分はすべてシミュレーションです。実際の売上・入金・換金原資は発生しません。本番運用には協賛契約、入金確認、送金契約が必要です。" },
  };
}

async function ownedCampaign(db: D1Database, userId: string, id: unknown): Promise<CampaignRow> {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new SponsorError(400, "INVALID_CAMPAIGN", "協賛プランを選択してください。");
  const row = await db.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM sponsor_campaigns WHERE id = ? AND user_id = ?`).bind(id, userId).first<CampaignRow>();
  if (!row) throw new SponsorError(404, "CAMPAIGN_NOT_FOUND", "協賛プランが見つかりません。");
  return row;
}

async function existingSettlement(db: D1Database, userId: string, key: string): Promise<SettlementIdentity | null> {
  return db.prepare("SELECT campaign_id, deductions_yen FROM sponsor_settlements WHERE user_id = ? AND idempotency_key = ? AND simulation = 1").bind(userId, key).first<SettlementIdentity>();
}

function sameSettlement(existing: SettlementIdentity, campaignId: string, deductionsYen: number): void {
  if (existing.campaign_id !== campaignId || existing.deductions_yen !== deductionsYen) throw new SponsorError(409, "IDEMPOTENCY_CONFLICT", "同じ操作の識別子で内容を変更できません。");
}

async function settleSimulation(db: D1Database, userId: string, payload: Record<string, unknown>, now: number): Promise<SponsorSnapshot> {
  if (payload.simulation !== true) throw new SponsorError(503, "REAL_FUNDING_UNAVAILABLE", "実際の入金処理は利用できません。シミュレーションとして操作してください。");
  if (typeof payload.idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(payload.idempotencyKey)) throw new SponsorError(400, "INVALID_IDEMPOTENCY_KEY", "入金シミュレーションの識別子を確認してください。");
  if (!Number.isSafeInteger(payload.deductionsYen) || Number(payload.deductionsYen) < 0 || Number(payload.deductionsYen) > 10_000_000) throw new SponsorError(400, "INVALID_AMOUNT", "控除額は0円から1,000万円までの整数で入力してください。");
  const campaign = await ownedCampaign(db, userId, payload.campaignId);
  const deductions = Number(payload.deductionsYen);
  const prior = await existingSettlement(db, userId, payload.idempotencyKey);
  if (prior) { sameSettlement(prior, campaign.id, deductions); return sponsorSnapshot(db, userId, now); }
  if (campaign.status !== "draft") throw new SponsorError(409, "CAMPAIGN_ALREADY_PROCESSED", "このプランの入金シミュレーションは完了しているか、アーカイブされています。");
  const allocation = allocateSponsorFunds(campaign.amountYen, deductions);
  const token = crypto.randomUUID();
  const result = await db.batch([
    db.prepare("UPDATE sponsor_campaigns SET status = 'active', starts_at = ?, ends_at = ?, revision = revision + 1, last_mutation = ? WHERE id = ? AND user_id = ? AND status = 'draft' AND revision = ? AND NOT EXISTS (SELECT 1 FROM sponsor_settlements WHERE user_id = ? AND (campaign_id = ? OR idempotency_key = ?))")
      .bind(now, now + campaign.days * DAY_MS, token, campaign.id, userId, campaign.revision, userId, campaign.id, payload.idempotencyKey),
    db.prepare("INSERT INTO sponsor_settlements (id, user_id, campaign_id, idempotency_key, gross_yen, deductions_yen, net_yen, reward_yen, reserve_yen, operations_yen, growth_yen, simulation, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ? WHERE EXISTS (SELECT 1 FROM sponsor_campaigns WHERE id = ? AND user_id = ? AND last_mutation = ?)")
      .bind(token, userId, campaign.id, payload.idempotencyKey, allocation.grossYen, allocation.deductionsYen, allocation.netYen, allocation.rewardYen, allocation.reserveYen, allocation.operationsYen, allocation.growthYen, now, campaign.id, userId, token),
  ]);
  if (result[0].meta.changes !== 1) {
    const repeated = await existingSettlement(db, userId, payload.idempotencyKey);
    if (repeated) { sameSettlement(repeated, campaign.id, deductions); return sponsorSnapshot(db, userId, now); }
    throw new SponsorError(409, "CONCURRENT_UPDATE", "協賛プランが更新されました。最新の状態を読み込んでください。");
  }
  return sponsorSnapshot(db, userId, now);
}

export async function mutateSponsors(db: D1Database, userId: string, payload: unknown, now = Date.now()): Promise<SponsorSnapshot> {
  objectPayload(payload);
  if (payload.action === "record_view") return recordSponsorView(db, userId, payload, now);
  if (payload.action === "create") {
    const campaign = validateSponsorCampaign(payload);
    const result = await db.prepare("INSERT INTO sponsor_campaigns (id, user_id, company, title, description, url, amount_yen, days, status, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ? WHERE (SELECT COUNT(*) FROM sponsor_campaigns WHERE user_id = ?) < ?")
      .bind(crypto.randomUUID(), userId, campaign.company, campaign.title, campaign.description, campaign.url, campaign.amountYen, campaign.days, now, userId, MAX_CAMPAIGNS).run();
    if (result.meta.changes !== 1) throw new SponsorError(409, "CAMPAIGN_LIMIT", "保存できる協賛プランは100件までです。");
    return sponsorSnapshot(db, userId, now);
  }
  if (payload.action === "update") {
    const current = await ownedCampaign(db, userId, payload.campaignId);
    if (current.status !== "draft") throw new SponsorError(409, "CAMPAIGN_NOT_EDITABLE", "編集できるのは下書きのプランだけです。入金・配分の体験履歴は変更できません。");
    const campaign = validateSponsorCampaign(payload);
    const result = await db.prepare("UPDATE sponsor_campaigns SET company = ?, title = ?, description = ?, url = ?, amount_yen = ?, days = ?, revision = revision + 1, last_mutation = ? WHERE id = ? AND user_id = ? AND status = 'draft' AND revision = ? AND NOT EXISTS (SELECT 1 FROM sponsor_settlements WHERE campaign_id = ? AND user_id = ?)")
      .bind(campaign.company, campaign.title, campaign.description, campaign.url, campaign.amountYen, campaign.days, crypto.randomUUID(), current.id, userId, current.revision, current.id, userId).run();
    if (result.meta.changes !== 1) throw new SponsorError(409, "CONCURRENT_UPDATE", "協賛プランの状態が更新されました。最新の内容を確認してください。");
    return sponsorSnapshot(db, userId, now);
  }
  if (payload.action === "simulate_settlement") return settleSimulation(db, userId, payload, now);
  if (typeof payload.action !== "string" || !["pause", "resume", "archive"].includes(payload.action)) throw new SponsorError(400, "INVALID_ACTION", "操作を確認してください。");
  const campaign = await ownedCampaign(db, userId, payload.campaignId);
  const nextStatus = payload.action === "pause" ? "paused" : payload.action === "resume" ? "active" : "archived";
  if (campaign.status === nextStatus) return sponsorSnapshot(db, userId, now);
  const allowed = payload.action === "archive" || (payload.action === "pause" && campaign.status === "active") || (payload.action === "resume" && campaign.status === "paused");
  if (campaign.status === "archived" || !allowed) throw new SponsorError(409, "INVALID_STATUS_CHANGE", "この状態では操作できません。掲載開始には入金シミュレーションが必要です。");
  if (payload.action === "resume" && (campaign.endsAt === null || campaign.endsAt <= now)) throw new SponsorError(409, "CAMPAIGN_EXPIRED", "掲載期間が終了しています。新しいプランを作成してください。");
  const token = crypto.randomUUID();
  const result = await db.batch([
    db.prepare("UPDATE sponsor_campaigns SET status = ?, revision = revision + 1, last_mutation = ? WHERE id = ? AND user_id = ? AND revision = ?")
      .bind(nextStatus, token, campaign.id, userId, campaign.revision),
    db.prepare("UPDATE sponsor_views SET last_visible = 0, last_seen = ?, revision = revision + 1 WHERE campaign_id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM sponsor_campaigns WHERE id = ? AND user_id = ? AND last_mutation = ?)")
      .bind(now, campaign.id, userId, campaign.id, userId, token),
  ]);
  if (result[0].meta.changes !== 1) throw new SponsorError(409, "CONCURRENT_UPDATE", "協賛プランが更新されました。最新の状態を読み込んでください。");
  return sponsorSnapshot(db, userId, now);
}

type SponsorViewRow = { id: string; sequence: number; last_seen: number; last_visible: number; revision: number };

/** These client visibility claims describe demo display intervals, not verified people. */
async function recordSponsorView(db: D1Database, userId: string, payload: Record<string, unknown>, now: number): Promise<SponsorSnapshot> {
  if (payload.simulation !== true) throw new SponsorError(503, "REAL_REPORTING_UNAVAILABLE", "表示計測はシミュレーションの掲載にのみ使用できます。");
  if (typeof payload.sessionId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(payload.sessionId) || !Number.isSafeInteger(payload.sequence) || Number(payload.sequence) < 0 || Number(payload.sequence) > 1_000_000 || typeof payload.visible !== "boolean") throw new SponsorError(400, "INVALID_VIEW", "表示計測のリクエストを確認してください。");
  const campaign = await ownedCampaign(db, userId, payload.campaignId);
  if (campaign.status !== "active" || campaign.startsAt === null || campaign.startsAt > now || campaign.endsAt === null || campaign.endsAt <= now) throw new SponsorError(409, "CAMPAIGN_NOT_LIVE", "この掲載シミュレーションは現在停止しています。");
  const readView = () => db.prepare("SELECT id, sequence, last_seen, last_visible, revision FROM sponsor_views WHERE user_id = ? AND campaign_id = ? AND session_id = ?").bind(userId, campaign.id, payload.sessionId).first<SponsorViewRow>();
  const prior = await readView();
  const visible = payload.visible ? 1 : 0;
  if (visible === 1) {
    const reward = await db.prepare("SELECT user_id FROM reward_accounts WHERE user_id = ? AND session_id = ? AND last_visible = 1 AND last_seen >= ? AND last_seen <= ?").bind(userId, payload.sessionId, now - 45_000, now).first();
    if (!reward) {
      if (prior) await db.prepare("UPDATE sponsor_views SET last_visible = 0, last_seen = MAX(last_seen, ?), revision = revision + 1 WHERE id = ? AND user_id = ? AND revision = ?").bind(now, prior.id, userId, prior.revision).run();
      throw new SponsorError(409, "VIEW_REWARD_SESSION_INACTIVE", "ポイント計測中の画面で掲載を表示すると計測できます。");
    }
  }
  if (!prior) {
    if (visible !== 1) throw new SponsorError(409, "VIEW_NOT_STARTED", "この画面ではまだ掲載を計測していません。");
    if (payload.sequence !== 0) throw new SponsorError(409, "VIEW_SEQUENCE_CONFLICT", "表示計測を最初から再開してください。");
    const result = await db.prepare("INSERT OR IGNORE INTO sponsor_views (id, user_id, campaign_id, session_id, sequence, last_seen, last_visible) SELECT ?, ?, ?, ?, 0, ?, ? WHERE EXISTS (SELECT 1 FROM sponsor_campaigns WHERE id = ? AND user_id = ? AND status = 'active' AND starts_at <= ? AND ends_at > ?) AND EXISTS (SELECT 1 FROM reward_accounts WHERE user_id = ? AND session_id = ? AND last_visible = 1 AND last_seen >= ? AND last_seen <= ?) AND (SELECT COUNT(*) FROM sponsor_views WHERE user_id = ? AND campaign_id = ?) < 500")
      .bind(crypto.randomUUID(), userId, campaign.id, payload.sessionId, now, visible, campaign.id, userId, now, now, userId, payload.sessionId, now - 45_000, now, userId, campaign.id).run();
    if (result.meta.changes !== 1) {
      const repeated = await readView();
      if (!repeated || repeated.sequence !== 0 || repeated.last_visible !== visible) throw new SponsorError(409, "VIEW_SEQUENCE_CONFLICT", "表示計測を再開できませんでした。最新の画面を確認してください。");
    }
    return sponsorSnapshot(db, userId, now);
  }
  if (payload.sequence === prior.sequence && prior.last_visible === visible) return sponsorSnapshot(db, userId, now);
  if (payload.sequence !== prior.sequence + 1) throw new SponsorError(409, "VIEW_SEQUENCE_CONFLICT", "表示計測の順序が更新されました。再開してください。");
  const elapsed = now - prior.last_seen;
  const validInterval = visible === 1 && prior.last_visible === 1 && elapsed > 0 && elapsed <= 30_000;
  const result = await db.prepare("UPDATE sponsor_views SET sequence = ?, last_seen = MAX(last_seen, ?), last_visible = ?, visible_ms = visible_ms + ?, confirmed_intervals = confirmed_intervals + ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM sponsor_campaigns WHERE id = ? AND user_id = ? AND status = 'active' AND starts_at <= ? AND ends_at > ?) AND (? = 0 OR EXISTS (SELECT 1 FROM reward_accounts WHERE user_id = ? AND session_id = ? AND last_visible = 1 AND last_seen >= ? AND last_seen <= ?))")
    .bind(payload.sequence, now, visible, validInterval ? elapsed : 0, validInterval ? 1 : 0, prior.id, userId, prior.revision, campaign.id, userId, now, now, visible, userId, payload.sessionId, now - 45_000, now).run();
  if (result.meta.changes !== 1) {
    const repeated = await readView();
    if (!repeated || repeated.sequence !== payload.sequence || repeated.last_visible !== visible) throw new SponsorError(409, "VIEW_SEQUENCE_CONFLICT", "表示計測が更新されました。再開してください。");
  }
  return sponsorSnapshot(db, userId, now);
}
