import type { Metadata } from "next";
import { SponsorGrowthPage } from "../../../components/toki-sponsor-growth";

export const metadata: Metadata = {
  title: "原資100万円へ向けたスポンサー計画｜TOKI",
  description: "還元原資100万円へ向けた費用・契約数の試算と、手動の営業候補管理。計画額と実際の原資を分けて確認します。",
  robots: { index: false, follow: false },
};

export default function GrowthPage() { return <SponsorGrowthPage />; }
