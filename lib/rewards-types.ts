export type ExchangeMethod = "bank" | "btc" | "eth";
export type RewardSession = { id: string; sequence: number; lastSeen: number };
export type RewardHistory = {
  id: string;
  type: "earned" | "exchange" | "refund";
  points: number;
  createdAt: number;
  description: string;
};
export type RewardExchange = {
  id: string;
  method: ExchangeMethod;
  points: number;
  status: "simulated" | "cancelled";
  createdAt: number;
};
export type RewardsSnapshot = {
  mode: "demo";
  account: {
    balance: number;
    totalEarned: number;
    todayEarned: number;
    activeSeconds: number;
    todaySeconds: number;
    dayKey: string;
    monthSeconds: number;
    monthKey: string;
  };
  rules: {
    pointsPerMinute: 1;
    dailyCap: 180;
    minExchange: 100;
    referenceJpyPerPoint: 1;
    heartbeatSeconds: 15;
  };
  serverTime: number;
  session: RewardSession | null;
  history: RewardHistory[];
  exchanges: RewardExchange[];
  weekly: { dayKey: string; points: number }[];
  payout: { enabled: false; reason: string };
};
