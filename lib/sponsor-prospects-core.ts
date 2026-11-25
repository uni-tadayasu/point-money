import type { SponsorProspect, SponsorProspectsSnapshot, SponsorProspectStage } from "./sponsor-prospects-types";

const STAGES = new Set(["candidate", "preparing", "contacted", "negotiating", "agreed", "closed"]);
const MAX_RECORDS = 5_000;
const FIELDS = ["companyName", "websiteUrl", "estimatedAmountYen", "stage", "notes"];
const COLUMNS = "id, company_name AS companyName, website_url AS websiteUrl, estimated_amount_yen AS estimatedAmountYen, stage, notes, created_at AS createdAt, updated_at AS updatedAt, revision, archived_at AS archivedAt";

export class SponsorProspectError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type EditableFields = Pick<SponsorProspect, "companyName" | "websiteUrl" | "estimatedAmountYen" | "stage" | "notes">;

function objectPayload(payload: unknown): asserts payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new SponsorProspectError(400, "INVALID_REQUEST", "入力内容を確認してください。");
}

function allowedFields(payload: Record<string, unknown>, fields: string[]): void {
  const allowed = new Set(fields);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw new SponsorProspectError(400, "UNSUPPORTED_FIELD", "営業候補で保存できない項目が含まれています。実入金やポイント残高は変更できません。");
}

function textField(value: unknown, label: string, max: number, required = false): string {
  if (!required && value === undefined) return "";
  if (typeof value !== "string") throw new SponsorProspectError(400, "INVALID_TEXT", `${label}を文字で入力してください。`);
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(trimmed)) throw new SponsorProspectError(400, "INVALID_TEXT", `${label}は${max}文字以内で入力してください。`);
  return trimmed;
}

function validateFields(payload: Record<string, unknown>, requireStage = false): EditableFields {
  const companyName = textField(payload.companyName, "企業名", 80, true);
  const notes = textField(payload.notes, "メモ", 1000);
  let websiteUrl: string | null = null;
  if (payload.websiteUrl !== undefined && payload.websiteUrl !== null) {
    const raw = textField(payload.websiteUrl, "WebサイトURL", 600);
    if (raw) {
      let parsed: URL;
      try { parsed = new URL(raw); } catch { throw new SponsorProspectError(400, "INVALID_URL", "WebサイトURLはhttpsから始まるURLで入力してください。"); }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new SponsorProspectError(400, "INVALID_URL", "WebサイトURLは認証情報を含まないhttpsのURLで入力してください。");
      websiteUrl = parsed.toString();
    }
  }
  if (!Number.isSafeInteger(payload.estimatedAmountYen) || Number(payload.estimatedAmountYen) < 0 || Number(payload.estimatedAmountYen) > 10_000_000) throw new SponsorProspectError(400, "INVALID_AMOUNT", "予定額は0円から1,000万円までの整数で入力してください。");
  const stage = payload.stage === undefined && !requireStage ? "candidate" : payload.stage;
  if (typeof stage !== "string" || !STAGES.has(stage)) throw new SponsorProspectError(400, "INVALID_STAGE", "営業の進捗状態を選択してください。");
  return { companyName, websiteUrl, estimatedAmountYen: Number(payload.estimatedAmountYen), stage: stage as SponsorProspectStage, notes };
}

function validateIdentity(payload: Record<string, unknown>): { id: string; revision: number } {
  if (typeof payload.id !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(payload.id)) throw new SponsorProspectError(400, "INVALID_PROSPECT", "営業候補を選択してください。");
  if (!Number.isSafeInteger(payload.revision) || Number(payload.revision) < 0) throw new SponsorProspectError(400, "INVALID_REVISION", "最新の営業候補を読み込んでから編集してください。");
  return { id: payload.id, revision: Number(payload.revision) };
}

export async function sponsorProspectsSnapshot(db: D1Database, userId: string, now = Date.now()): Promise<SponsorProspectsSnapshot> {
  const [list, totals] = await db.batch([
    db.prepare(`SELECT ${COLUMNS} FROM sponsor_prospects WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?`).bind(userId, MAX_RECORDS),
    db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN archived_at IS NULL AND stage <> 'closed' THEN 1 ELSE 0 END), 0) AS activeCount, COALESCE(SUM(CASE WHEN archived_at IS NULL AND stage <> 'closed' THEN estimated_amount_yen ELSE 0 END), 0) AS estimatedAmountYen FROM sponsor_prospects WHERE user_id = ?").bind(userId),
  ]);
  return { kind: "sales_plan", prospects: list.results as SponsorProspect[], summary: totals.results[0] as SponsorProspectsSnapshot["summary"], serverTime: now };
}

export async function mutateSponsorProspects(db: D1Database, userId: string, payload: unknown, now = Date.now()): Promise<SponsorProspectsSnapshot> {
  objectPayload(payload);
  if (payload.action === "create") {
    allowedFields(payload, ["action", ...FIELDS]);
    const record = validateFields(payload);
    const result = await db.prepare("INSERT INTO sponsor_prospects (id, user_id, company_name, website_url, estimated_amount_yen, stage, notes, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM sponsor_prospects WHERE user_id = ?) < ?")
      .bind(crypto.randomUUID(), userId, record.companyName, record.websiteUrl, record.estimatedAmountYen, record.stage, record.notes, now, now, userId, MAX_RECORDS).run();
    if (result.meta.changes !== 1) throw new SponsorProspectError(409, "PROSPECT_LIMIT", `保存できる営業候補はアーカイブを含めて${MAX_RECORDS.toLocaleString("ja-JP")}件までです。`);
    return sponsorProspectsSnapshot(db, userId, now);
  }
  if (payload.action !== "update" && payload.action !== "archive") throw new SponsorProspectError(400, "INVALID_ACTION", "操作を確認してください。");
  allowedFields(payload, payload.action === "archive" ? ["action", "id", "revision"] : ["action", "id", "revision", ...FIELDS]);
  const { id, revision } = validateIdentity(payload);
  const existing = await db.prepare(`SELECT ${COLUMNS} FROM sponsor_prospects WHERE id = ? AND user_id = ?`).bind(id, userId).first<SponsorProspect>();
  if (!existing) throw new SponsorProspectError(404, "PROSPECT_NOT_FOUND", "営業候補が見つかりません。");
  if (existing.revision !== revision) throw new SponsorProspectError(409, "PROSPECT_CONFLICT", "別の操作で更新されています。最新の内容を読み込んでから編集してください。");
  if (payload.action === "archive" && existing.archivedAt !== null) return sponsorProspectsSnapshot(db, userId, now);
  if (existing.archivedAt !== null) throw new SponsorProspectError(409, "PROSPECT_ARCHIVED", "アーカイブ済みの営業候補は編集できません。");
  const record = payload.action === "update" ? validateFields(payload, true) : null;
  const statement = record
    ? db.prepare("UPDATE sponsor_prospects SET company_name = ?, website_url = ?, estimated_amount_yen = ?, stage = ?, notes = ?, updated_at = MAX(updated_at, ?), revision = revision + 1 WHERE id = ? AND user_id = ? AND revision = ? AND archived_at IS NULL").bind(record.companyName, record.websiteUrl, record.estimatedAmountYen, record.stage, record.notes, now, id, userId, revision)
    : db.prepare("UPDATE sponsor_prospects SET archived_at = ?, updated_at = MAX(updated_at, ?), revision = revision + 1 WHERE id = ? AND user_id = ? AND revision = ? AND archived_at IS NULL").bind(now, now, id, userId, revision);
  const result = await statement.run();
  if (result.meta.changes !== 1) throw new SponsorProspectError(409, "PROSPECT_CONFLICT", "別の操作で更新されています。最新の内容を読み込んでから編集してください。");
  return sponsorProspectsSnapshot(db, userId, now);
}
