export const PROSPECT_STAGES = ["candidate", "preparing", "contacted", "negotiating", "agreed", "closed"] as const;
export type SponsorProspectStage = typeof PROSPECT_STAGES[number];

export type SponsorProspect = {
  id: string;
  companyName: string;
  websiteUrl: string | null;
  estimatedAmountYen: number;
  stage: SponsorProspectStage;
  notes: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  archivedAt: number | null;
};

export type SponsorProspectInput = {
  companyName: string;
  websiteUrl?: string | null;
  estimatedAmountYen: number;
  stage?: SponsorProspectStage;
  notes?: string;
};

export type SponsorProspectsSnapshot = {
  kind: "sales_plan";
  prospects: SponsorProspect[];
  summary: {
    /** All saved records, including archived records. */
    count: number;
    /** Non-archived records whose stage is not closed. */
    activeCount: number;
    /** Planned amounts from those active records, never verified incoming funds. */
    estimatedAmountYen: number;
  };
  serverTime: number;
};
