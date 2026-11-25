import { RewardError } from "../../../lib/rewards-core";
import { readRewardBody, rewardContext, rewardResponse } from "../../../lib/rewards-http";
import { mutateSponsorProspects, SponsorProspectError, sponsorProspectsSnapshot } from "../../../lib/sponsor-prospects-core";

export const dynamic = "force-dynamic";

function failure(error: unknown): Response {
  if (error instanceof SponsorProspectError || error instanceof RewardError) {
    const message = error.code === "SIGN_IN_REQUIRED" ? "営業候補を保存するにはサインインしてください。保存はまだ行われていません。" : error.message;
    return rewardResponse({ error: message, code: error.code, kind: "sales_plan" }, error.status);
  }
  console.error("Sponsor prospects API failed", error instanceof Error ? error.message : "Unknown error");
  return rewardResponse({ error: "営業候補を読み込めませんでした。接続を確認して再度お試しください。", code: "SERVER_ERROR", kind: "sales_plan" }, 500);
}

export async function GET(request: Request) {
  try {
    const { db, userId } = await rewardContext(request);
    return rewardResponse(await sponsorProspectsSnapshot(db, userId));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const { db, userId } = await rewardContext(request);
    return rewardResponse(await mutateSponsorProspects(db, userId, await readRewardBody(request)));
  } catch (error) { return failure(error); }
}
