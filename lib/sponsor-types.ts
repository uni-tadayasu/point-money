export type SponsorCampaignStatus = "draft" | "active" | "paused" | "archived";

export type SponsorCampaign = {
  id: string;
  company: string;
  title: string;
  description: string;
  url: string;
  amountYen: number;
  days: number;
  status: SponsorCampaignStatus;
  createdAt: number;
  startsAt: number | null;
  endsAt: number | null;
  isLive: boolean;
  report: { visibleSeconds: number; confirmedIntervals: number };
  viewSession: { id: string; sequence: number } | null;
};

export type SponsorAllocation = {
  grossYen: number;
  deductionsYen: number;
  netYen: number;
  rewardYen: number;
  reserveYen: number;
  operationsYen: number;
  growthYen: number;
};

export type SponsorLedgerEntry = SponsorAllocation & {
  id: string;
  campaignId: string;
  campaignTitle: string;
  createdAt: number;
  simulation: true;
};

export type SponsorSnapshot = {
  mode: "demo";
  simulation: true;
  currency: "JPY";
  serverTime: number;
  allocationRules: { reward: 50; reserve: 20; operations: 20; growth: 10 };
  totals: SponsorAllocation & { realReceivedYen: 0 };
  campaigns: SponsorCampaign[];
  ledger: SponsorLedgerEntry[];
  funding: { realEnabled: false; reason: string };
};
