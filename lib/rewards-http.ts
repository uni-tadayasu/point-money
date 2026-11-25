import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { RewardError } from "./rewards-core";

const RESPONSE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function rewardContext(request: Request): Promise<{ db: D1Database; userId: string }> {
  const user = await getChatGPTUser();
  if (!user) throw new RewardError(401, "SIGN_IN_REQUIRED", "保存するにはサインインしてください。体験ポイントは換金できません。");
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if ((origin && origin !== new URL(request.url).origin) || site === "cross-site") throw new RewardError(403, "ORIGIN_REJECTED", "この画面から操作してください。");
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new RewardError(415, "JSON_REQUIRED", "JSON形式で送信してください。");
  }
  if (!env.DB) throw new RewardError(503, "STORAGE_UNAVAILABLE", "保存先を準備中です。しばらくしてから再度お試しください。");
  return { db: env.DB, userId: user.userId };
}

export async function readRewardBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 4096) throw new RewardError(413, "REQUEST_TOO_LARGE", "リクエストが大きすぎます。");
  const body = await request.text();
  if (body.length > 4096) throw new RewardError(413, "REQUEST_TOO_LARGE", "リクエストが大きすぎます。");
  try { return JSON.parse(body); } catch { throw new RewardError(400, "INVALID_JSON", "リクエストの形式を確認してください。"); }
}

export function rewardResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: RESPONSE_HEADERS });
}

export function rewardFailure(error: unknown): Response {
  if (error instanceof RewardError) return rewardResponse({ error: error.message, code: error.code, mode: "demo" }, error.status);
  console.error("Reward API failed", error instanceof Error ? error.message : "Unknown error");
  return rewardResponse({ error: "読み込みに失敗しました。しばらくしてから再度お試しください。", code: "SERVER_ERROR", mode: "demo" }, 500);
}
