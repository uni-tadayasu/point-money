import { mutateSponsors, SponsorError, sponsorSnapshot } from "../../../lib/sponsor-core";
import { readRewardBody, rewardContext, rewardFailure, rewardResponse } from "../../../lib/rewards-http";

export const dynamic = "force-dynamic";

function failure(error: unknown): Response {
  if (error instanceof SponsorError) return rewardResponse({ error: error.message, code: error.code, mode: "demo", simulation: true }, error.status);
  return rewardFailure(error);
}

export async function GET(request: Request) {
  try {
    const { db, userId } = await rewardContext(request);
    return rewardResponse(await sponsorSnapshot(db, userId));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const { db, userId } = await rewardContext(request);
    return rewardResponse(await mutateSponsors(db, userId, await readRewardBody(request)));
  } catch (error) { return failure(error); }
}
