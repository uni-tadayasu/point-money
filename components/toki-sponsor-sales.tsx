"use client";

import { useState } from "react";
import { CalendarDays, Check, CheckCircle2, Circle, Copy, FileText, Handshake, Info, LockKeyhole, PanelTop, Target } from "lucide-react";
import { SPONSOR_OFFER, buildSponsorOfferText } from "../lib/sponsor-offer";
import styles from "./toki-sponsor-sales.module.css";

const offer = SPONSOR_OFFER;
const price = new Intl.NumberFormat("ja-JP").format(offer.amountYen);
const termLabels: Record<keyof typeof offer.draftTerms, string> = {
  start: "掲載の開始と期間",
  beforeStartCancellation: "掲載開始前の取消",
  failedStart: "期限までに開始できない場合",
  afterStartCancellation: "掲載開始後の取消",
  interruption: "運営都合で掲載が止まった場合",
  refundTiming: "返金処理の時期",
};

function CopyOffer({ light = false }: { light?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(buildSponsorOfferText());
      setState("copied");
    } catch { setState("failed"); }
  }
  return <div className={`${styles.copyControl} ${light ? styles.copyLight : ""}`}>
    <button type="button" className={styles.copyButton} onClick={() => void copy()}>{state === "copied" ? <Check size={17} /> : <Copy size={17} />}販売条件の下書きをコピー</button>
    {state !== "idle" && <p className={styles.copyStatus} role="status">{state === "copied" ? "コピーしました。送信・契約・決済は行っていません。" : "コピーできませんでした。下の文章を選択してコピーできます。"}</p>}
    {state === "failed" && <textarea className={styles.copyFallback} readOnly aria-label="販売条件の下書き" value={buildSponsorOfferText()} rows={8} onFocus={event => event.currentTarget.select()} />}
  </div>;
}

/** Commercial preparation is intentionally independent of the demo ledger API. */
export function SponsorSalesCard() {
  return <section className={styles.salesCard} aria-label="初回スポンサー枠の販売準備">
    <div className={styles.cardContent}>
      <div className={styles.cardKicker}><span>FIRST PARTNER</span><span className={styles.draftTag}>販売条件の下書き</span></div>
      <h2>{offer.name}</h2>
      <p className={styles.cardLead}>最初の協賛枠を、具体的な提案に。</p>
      <div className={styles.cardPrice}><strong>¥{price}</strong><span>{offer.days}日間 · 1回払い</span></div>
      <p className={styles.taxNote}>税込 · 日本の税登録・税額計算を確認済み</p>
      <div className={styles.cardFacts}><span><PanelTop size={16} />初回 {offer.initialSlots} 枠で実績を確認し、段階的に拡大</span><span>受取先 {offer.merchantName}</span></div>
    </div>
    <div className={styles.cardAction}>
      <span className={styles.statusPill}><LockKeyhole size={15} />販売準備中・決済リンク未発行</span>
      <p>商品・価格と国内の税額計算を確認済みです。掲載先・販売者窓口などを整えてから購入受付を開始します。現在は購入できません。</p>
      <a href="/sponsor" className={styles.detailsLink}>掲載条件と準備状況を見る</a>
      <CopyOffer light />
    </div>
  </section>;
}

export function SponsorGrowthCard() {
  return <section className={styles.growthCard} aria-label="原資100万円の計画管理"><div className={styles.growthHeading}><Target size={26} /><div><span>SPONSOR GROWTH</span><h2>還元原資100万円へ向けた計画</h2></div></div><p>このアプリで確認済みの原資は0円（実入金未連携）です。費用を見込んだ契約数の試算と、営業候補を管理できます。</p><a href="/sponsor/growth">試算・営業候補を開く</a></section>;
}

export function SponsorSalesDetail() {
  return <div className={styles.detailPage}>
    <header className={styles.pageHeader}><a className={styles.brand} href="/" aria-label="TOKI ホーム"><img src="/favicon.svg" width="38" height="38" alt="" /><span>TOKI<small>SPONSOR PARTNERSHIP</small></span></a><a className={styles.backLink} href="/">アプリに戻る</a></header>
    <main className={styles.pageMain}>
      <section className={styles.offerHero}>
        <div className={styles.heroIntro}><span className={styles.eyebrow}>THE FIRST PARTNER</span><h1>{offer.name}</h1><p>あなたのサービスを、<br />TOKIの最初の協賛枠へ。</p><div className={styles.heroBadges}><span>販売条件の確認用</span><span>まだ購入できません</span></div></div>
        <div className={styles.heroPrice}><span>掲載料金（税込）</span><strong>¥{price}</strong><p>{offer.days}日間 · 1回払い · 自動更新なし</p><small>日本の取引で税抜4,545円＋税455円の計算確認済み</small><div><LockKeyhole size={16} />決済リンク未発行</div></div>
      </section>

      <div className={styles.reviewNotice}><FileText size={23} /><div><strong>商品・価格は登録済み、購入受付は準備中です。</strong><p>税込5,000円（税抜4,545円＋消費税455円）の価格で、Stripe Taxの計算を確認しました。掲載先と販売者窓口などを準備中のため、商品は販売保留中です。開始・取消・返金の条件は案であり、現在は購入受付を行っていません。</p></div></div>

      <section className={styles.overview} aria-label="掲載枠の概要"><article><PanelTop size={24} /><span>掲載場所</span><strong>{offer.placementLabel}</strong></article><article><CalendarDays size={24} /><span>掲載期間</span><strong>実際の開始から{offer.days}日間</strong></article><article><Handshake size={24} /><span>段階的な募集</span><strong>初回{offer.initialSlots}枠の掲載実績を確認してから拡大</strong></article></section>

      <SponsorGrowthCard />

      <div className={styles.contentGrid}>
        <section className={styles.whitePanel}><div className={styles.sectionTitle}><span>WHAT IS INCLUDED</span><h2>掲載に含める内容</h2></div><ul className={styles.includedList}>{offer.included.map(item => <li key={item}><Check size={17} /><span>{item}</span></li>)}</ul><div className={styles.pendingPlacement}><Info size={19} /><p>現在の掲載先は、運営者本人だけが閲覧できる確認版です。購入受付前に、対象の利用者が閲覧できる掲載先と開始日を案内します。</p></div></section>
        <section className={styles.whitePanel}><div className={styles.sectionTitle}><span>READY FOR REVIEW</span><h2>現在の準備状況</h2></div><div className={styles.readiness}>{offer.readiness.map(item => <div key={item.key} className={styles.readinessRow}>{item.ready ? <CheckCircle2 className={styles.readyIcon} size={19} /> : <Circle className={styles.pendingIcon} size={19} />}<div><div className={styles.readinessTitle}><strong>{item.label}</strong><span className={item.ready ? styles.readyLabel : styles.pendingLabel}>{item.ready ? "確認済み" : "未完了"}</span></div><p>{item.detail}</p></div></div>)}</div></section>
      </div>

      <section className={styles.whitePanel}><div className={styles.sectionTitle}><span>BEFORE YOU CONSIDER</span><h2>購入前にお伝えすること</h2></div><ul className={styles.disclosureList}>{offer.disclosures.map(item => <li key={item}>{item}</li>)}</ul><div className={styles.noPromise}><Info size={19} /><p>利用者のポイント獲得を伴うサービスの協賛枠です。広告のクリック・商品購入はポイント付与の条件にせず、注視・反応・成果を保証しません。</p></div></section>

      <section className={styles.whitePanel}><div className={styles.termsHeading}><div className={styles.sectionTitle}><span>PROPOSED TERMS</span><h2>開始・取消・返金の条件案</h2></div><span className={styles.proposedTag}>最終確定前</span></div><p className={styles.sectionIntro}>以下は確認用の案です。販売開始前に最終条件を提示します。</p><dl className={styles.terms}>{(Object.keys(offer.draftTerms) as (keyof typeof offer.draftTerms)[]).map(key => <div key={key}><dt>{termLabels[key]}</dt><dd>{offer.draftTerms[key]}</dd></div>)}</dl><div className={styles.refundNote}><Info size={19} /><p>返金の実施には運営者の処理が必要です。現時点で、返金や掲載開始が自動で行われる仕組みは接続していません。</p></div></section>

      <div className={styles.contentGrid}>
        <section className={styles.whitePanel}><div className={styles.sectionTitle}><span>SELLER INFORMATION</span><h2>受取先と販売者情報</h2></div><dl className={styles.sellerInfo}><div><dt>決済アカウントの表示名</dt><dd>{offer.merchantName}</dd></div><div><dt>正式な販売者情報・連絡先</dt><dd>販売開始前に整備・案内します</dd></div></dl><p className={styles.sellerNote}>掲載・取消・返金の問い合わせ窓口も未確定です。決済アカウントの表示名だけで、販売者情報がすべて整った状態を示すものではありません。</p></section>
        <section className={styles.whitePanel}><div className={styles.sectionTitle}><span>DETAILS TO CONFIRM</span><h2>販売開始時に確認する内容</h2></div><ul className={styles.intakeList}>{offer.intakeFields.map(item => <li key={item}>{item}</li>)}</ul><p className={styles.sellerNote}>現在は入力フォームを設けておらず、このページで申込み情報を収集しません。</p></section>
      </div>

      <section className={styles.reviewActions}><div><span className={styles.eyebrow}>PREPARED, NOT YET ON SALE</span><h2>提案内容を、確認用の文面に。</h2><p>下書きには、掲載条件・現在の制約・返金案を含めています。コピーだけでは契約・請求・決済は行われません。</p></div><CopyOffer light /></section>
    </main>
    <footer className={styles.pageFooter}><span>TOKI · {offer.merchantName}</span><span>販売準備中・決済リンク未発行</span></footer>
  </div>;
}
