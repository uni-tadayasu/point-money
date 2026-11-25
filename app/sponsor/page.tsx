import type { Metadata } from "next";
import { SponsorSalesDetail } from "../../components/toki-sponsor-sales";

export const metadata: Metadata = {
  title: "初回スポンサー掲載条件の確認｜TOKI",
  description: "TOKI初回スポンサー掲載枠。税込5,000円・30日間・1回払いの商品と価格を本番Stripeに登録済み。徴収設定を最終確認中で、購入受付は開始していません。",
  robots: { index: false, follow: false },
};

export default function SponsorPage() { return <SponsorSalesDetail />; }
