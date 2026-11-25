import { mutateSession, snapshot } from "../../../lib/rewards-core";
import { readRewardBody, rewardContext, rewardFailure, rewardResponse } from "../../../lib/rewards-http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db, userId } = await rewardContext(request);
    return rewardResponse(await snapshot(db, userId));
  } catch (error) { return rewardFailure(error); }
}

export async function POST(request: Request) {
  try {
    const { db, userId } = await rewardContext(request);
    return rewardResponse(await mutateSession(db, userId, await readRewardBody(request)));
  } catch (error) { return rewardFailure(error); }
}
