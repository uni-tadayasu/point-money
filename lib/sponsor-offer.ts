/**
 * Reviewable commercial offer, separate from all simulated sponsor records.
 * This module cannot create a Stripe product, collect payment, or issue points.
 * A checkout URL must remain absent until the outstanding sale conditions are resolved.
 */
export const SPONSOR_OFFER = {
  version: "toki-first-sponsor-2026-11-25",
  preparedAt: "2026-11-25",
  merchantName: "KASAI SOLUTIONS",
  name: "TOKI 初回スポンサー掲載枠",
  amountYen: 5_000,
  days: 30,
  initialSlots: 1,
  paymentLinkUrl: null,
  status: "preparing",
  taxStatus: "pending",
  placementLabel: "TOKIホーム画面のスポンサー紹介欄",
  startWithinDays: 7,
  refundProcessWithinDays: 7,
  included: [
    "企業名・屋号、紹介タイトル、紹介文、外部サイトへのリンク1件",
    "実際の掲載開始日時から30日間の紹介カード掲載",
    "掲載開始・終了日時と掲載URLの記録",
    "1回払い。自動更新なし。画像制作は含みません。",
  ],
  disclosures: [
    "新規サービスの初回スポンサー枠です。利用者数・表示実績は未確認で、表示回数、クリック、申込み、売上を保証しません。",
    "TOKIはアプリの表示時間に応じてポイントが加算される仕組みです。利用者の閲覧にはポイント獲得という目的が含まれます。人による注視や、広告への関心を保証しません。",
    "広告のクリックや商品購入をポイント付与の条件にはしません。",
    "現在のアプリは運営者本人だけが閲覧できる確認版です。ポイントの現金・暗号資産への交換は未提供です。購入受付前に、実際に閲覧できる掲載先を案内します。",
    "本ページは販売条件の確認用です。決済リンクはまだ発行しておらず、申込み・契約・支払いは発生しません。",
  ],
  draftTerms: {
    start: "掲載内容を事前に確認し、閲覧可能な掲載場所と開始日を合意してから決済を案内します。決済確認後7日以内に掲載を開始し、実際の開始日時から30日間掲載する案です。",
    beforeStartCancellation: "掲載開始前の取消は全額返金する案です。",
    failedStart: "決済確認後7日以内に掲載を開始できない場合は、全額返金する案です。開始期限を自動で延長しません。",
    afterStartCancellation: "掲載開始後の取消は、未提供時間を30日間に対して按分し、1円未満を切り上げて返金する案です。返金総額は実際の支払額を上限とします。",
    interruption: "運営都合による未掲載期間は、購入者が期間延長または未提供分の返金を選べる案です。",
    refundTiming: "取消・未提供が確定してから7日以内に運営が返金処理を行う案です。決済手段への着金日は保証しません。自動返金機能は未接続です。",
  },
  readiness: [
    { key: "merchant", label: "受取先", ready: true, detail: "KASAI SOLUTIONSの本番Stripe口座を使用する方針が確定しています。" },
    { key: "offer", label: "初回掲載枠", ready: true, detail: "5,000円・30日間・1回払いの内容を用意しました。開始・返金条件は確認用の案です。" },
    { key: "tax", label: "消費税の扱い", ready: false, detail: "税の徴収方針を確認してから、Stripeの商品・価格を登録します。" },
    { key: "placement", label: "掲載先の公開", ready: false, detail: "対象の利用者が閲覧できる掲載先と、購入した内容を表示する仕組みを整えます。" },
    { key: "contact", label: "販売者・連絡窓口", ready: false, detail: "販売者情報と、掲載・取消・返金の問い合わせ先を確定します。" },
    { key: "checkout", label: "購入受付", ready: false, detail: "購入条件と入金確認・掲載・返金の手順を整えた後、決済リンクを発行します。" },
  ],
  intakeFields: [
    "企業名・屋号",
    "担当者名・連絡用メールアドレス",
    "掲載タイトル・紹介文・httpsのリンク先URL",
    "希望開始日",
    "掲載内容を使用する権限の確認",
    "閲覧の誘因・掲載先・成果保証なし・開始と返金条件への同意",
  ],
} as const;

/** Copy only. The result is deliberately labelled as an unsent, non-binding draft. */
export function buildSponsorOfferText(): string {
  const offer = SPONSOR_OFFER;
  return [
    "【販売条件の確認用・未送信・決済受付前】",
    `${offer.name}｜${offer.merchantName}`,
    "",
    `予定の支払総額：${offer.amountYen.toLocaleString("ja-JP")}円（消費税の扱いは確認中）`,
    `掲載期間：実際の掲載開始から${offer.days}日間／1回払い・自動更新なし`,
    `初回の販売予定数：${offer.initialSlots}枠`,
    `掲載場所：${offer.placementLabel}（現在は本人限定公開。購入受付前に掲載先を確定）`,
    "",
    "掲載内容",
    ...offer.included.map((line) => `・${line}`),
    "",
    "購入前にお伝えする事項",
    ...offer.disclosures.map((line) => `・${line}`),
    "",
    "開始・取消・返金条件の案",
    ...Object.values(offer.draftTerms).map((line) => `・${line}`),
    "",
    "販売者情報・問い合わせ窓口・税区分を確定後、最終の購入条件を提示します。",
    "この文面のコピーでは送信・契約・請求・決済は行われません。",
  ].join("\n");
}
