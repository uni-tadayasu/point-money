import type { Metadata } from "next";
import { SponsorSalesDetail } from "../../components/toki-sponsor-sales";

export const metadata: Metadata = {
  title: "初回スポンサー掲載条件の確認｜TOKI",
  description: "TOKI初回スポンサー掲載枠の販売準備。予定額5,000円・30日間・1回払い。販売条件は確認用の下書きで、決済受付は開始していません。",
  robots: { index: false, follow: false },
};

export default function SponsorPage() { return <SponsorSalesDetail />; }
