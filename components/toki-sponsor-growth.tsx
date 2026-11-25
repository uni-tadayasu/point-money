"use client";

import Link from "next/link";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Archive, CheckCircle2, ChevronDown, Copy, FileText, Handshake, Info, Pencil, Plus, RefreshCw, Search, ShieldCheck, Target, Wallet, X } from "lucide-react";
import { buildSponsorOfferText } from "../lib/sponsor-offer";
import { calculateSponsorFundingPlan, FUNDING_ASSUMPTIONS, FUNDING_TARGET_YEN } from "../lib/sponsor-funding-plan";
import type { SponsorProspect, SponsorProspectStage, SponsorProspectsSnapshot } from "../lib/sponsor-prospects-types";
import styles from "./toki-sponsor-growth.module.css";
import { TokiBgmControls } from "./toki-bgm-controls";

const stages: { value: SponsorProspectStage; label: string }[] = [{ value: "candidate", label: "候補" }, { value: "preparing", label: "提案準備" }, { value: "contacted", label: "連絡済" }, { value: "negotiating", label: "商談" }, { value: "agreed", label: "合意" }, { value: "closed", label: "見送り" }];
const yen = (value: number) => `¥${new Intl.NumberFormat("ja-JP").format(value)}`;
const number = (value: number) => new Intl.NumberFormat("ja-JP").format(value);
const shortDate = (value: number) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(value);
const emptyDraft = { companyName: "", websiteUrl: "", estimatedAmountYen: "5000", stage: "candidate" as SponsorProspectStage, notes: "" };

type ApiFailure = Error & { status?: number; code?: string };
async function prospectRequest(payload?: Record<string, unknown>, signal?: AbortSignal): Promise<SponsorProspectsSnapshot> {
  const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 15000);
  const onAbort = () => controller.abort(); signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) controller.abort();
    const response = await fetch("/api/sponsor-prospects", { method: payload ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: payload ? { "Content-Type": "application/json" } : undefined, body: payload ? JSON.stringify(payload) : undefined });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw Object.assign(new Error(typeof data.error === "string" ? data.error : "営業候補を読み込めませんでした。"), { status: response.status, code: data.code });
    if (data.kind !== "sales_plan" || !Array.isArray(data.prospects)) throw new Error("営業候補の応答を確認できませんでした。");
    return data as unknown as SponsorProspectsSnapshot;
  } catch (reason) {
    if ((reason as Error).name === "AbortError" && !signal?.aborted) throw new Error("接続がタイムアウトしました。保存結果を再読み込みして確認してください。");
    throw reason;
  } finally { window.clearTimeout(timeout); signal?.removeEventListener("abort", onAbort); }
}

function Modal({ title, children, close, busy = false }: { title: string; children: ReactNode; close: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className={styles.dialog} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) close(); }} onClick={event => { if (event.target === event.currentTarget && !busy) close(); }}><div className={styles.modalBody}><header className={styles.modalHeader}><h2>{title}</h2><button className={styles.iconButton} disabled={busy} onClick={close} type="button" aria-label="閉じる"><X size={21} /></button></header>{children}</div></dialog>;
}

export function SponsorGrowthPage() {
  const [priceText, setPriceText] = useState("5000"); const [allocationText, setAllocationText] = useState("50");
  const [data, setData] = useState<SponsorProspectsSnapshot | null>(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [filter, setFilter] = useState("all"); const [query, setQuery] = useState(""); const [visibleLimit, setVisibleLimit] = useState(50); const [modal, setModal] = useState<"create" | "edit" | "archive" | "copy" | null>(null); const [selected, setSelected] = useState<SponsorProspect | null>(null); const [draft, setDraft] = useState({ ...emptyDraft }); const [formError, setFormError] = useState(""); const [notice, setNotice] = useState(""); const [copyText, setCopyText] = useState("");
  const refresh = useCallback(async (signal?: AbortSignal) => { setLoading(true); setError(""); try { const next = await prospectRequest(undefined, signal); if (!signal?.aborted) setData(next); } catch (reason) { if (!signal?.aborted) { const issue = reason as ApiFailure; setError(issue.status === 401 ? "営業候補の保存には、このアプリへのログインが必要です。計画の試算はこのまま確認できます。" : issue.message); } } finally { if (!signal?.aborted) setLoading(false); } }, []);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh]);
  useEffect(() => { if (!notice) return; const timeout = window.setTimeout(() => setNotice(""), 6000); return () => window.clearTimeout(timeout); }, [notice]);

  let plan: ReturnType<typeof calculateSponsorFundingPlan> | null = null; let planError = "";
  try { if (!priceText || !allocationText) throw new Error("税込単価と還元配分を入力してください。"); plan = calculateSponsorFundingPlan(Number(priceText), Number(allocationText)); } catch (reason) { planError = (reason as Error).message; }
  const compareRatio = plan?.rewardPercent ?? FUNDING_ASSUMPTIONS.defaultRewardPercent;
  const comparison = FUNDING_ASSUMPTIONS.priceScenariosYen.map(price => calculateSponsorFundingPlan(price, compareRatio));
  const activeProspects = data?.prospects.filter(item => item.archivedAt === null) ?? [];
  const visibleProspects = (data?.prospects ?? []).filter(item => (filter === "archived" ? item.archivedAt !== null : item.archivedAt === null && (filter === "all" || item.stage === filter)) && (!query.trim() || `${item.companyName} ${item.websiteUrl || ""} ${item.notes}`.toLocaleLowerCase("ja-JP").includes(query.trim().toLocaleLowerCase("ja-JP"))));
  useEffect(() => { setVisibleLimit(50); }, [filter, query]);
  const closeModal = () => { if (!busy) { setModal(null); setFormError(""); } };
  function beginCreate() { setSelected(null); setDraft({ ...emptyDraft }); setFormError(""); setModal("create"); }
  function beginEdit(item: SponsorProspect) { setSelected(item); setDraft({ companyName: item.companyName, websiteUrl: item.websiteUrl || "", estimatedAmountYen: String(item.estimatedAmountYen), stage: item.stage, notes: item.notes }); setFormError(""); setModal("edit"); }
  async function saveProspect(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setFormError("");
    try {
      const amount = Number(draft.estimatedAmountYen); if (!draft.companyName.trim() || !draft.estimatedAmountYen || !Number.isSafeInteger(amount) || amount < 0 || amount > 10_000_000) throw new Error("候補名と予定額をご確認ください。");
      const fields = { companyName: draft.companyName.trim(), websiteUrl: draft.websiteUrl.trim() || null, estimatedAmountYen: amount, stage: draft.stage, notes: draft.notes.trim() };
      const result = await prospectRequest(modal === "edit" && selected ? { action: "update", id: selected.id, revision: selected.revision, ...fields } : { action: "create", ...fields });
      setData(result); setError(""); setModal(null); setNotice("営業候補を保存しました。連絡・契約・入金確認は行っていません。");
    } catch (reason) { const issue = reason as ApiFailure; setFormError(issue.code === "PROSPECT_CONFLICT" ? "ほかの画面で更新されています。この編集は保存されていません。閉じて再読み込みしてから編集してください。" : issue.message); }
    finally { setBusy(false); }
  }
  async function archiveProspect() {
    if (!selected || busy) return; setBusy(true); setFormError("");
    try { const result = await prospectRequest({ action: "archive", id: selected.id, revision: selected.revision }); setData(result); setModal(null); setNotice("営業候補を保管済みに移しました。実際の契約や支払いは変更していません。"); }
    catch (reason) { const issue = reason as ApiFailure; setFormError(issue.code === "PROSPECT_CONFLICT" ? "ほかの画面で更新されています。保管は完了していません。閉じて再読み込みしてください。" : issue.message); }
    finally { setBusy(false); }
  }
  async function copyProposal(item?: SponsorProspect) {
    const text = [item ? `${item.companyName} 御中` : "", "", buildSponsorOfferText(), "", "最初は1枠の掲載実績を確認し、提供できる掲載枠・期間の範囲で段階的に拡大します。", "営業候補への登録やこの文面のコピーだけでは、連絡送信・契約・請求は行われません。"].join("\n").trim();
    try { if (!navigator.clipboard?.writeText) throw new Error("unavailable"); await navigator.clipboard.writeText(text); setNotice("提案の下書きをコピーしました。相手への送信は行っていません。"); }
    catch { setCopyText(text); setModal("copy"); }
  }

  return <div className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.brand}><img src="/favicon.svg" width="38" height="38" alt="" /><span>TOKI<small>SPONSOR GROWTH</small></span></Link><nav><TokiBgmControls /><Link href="/sponsor">掲載条件</Link><Link href="/">アプリに戻る</Link></nav></header>
    <main className={styles.main}>
      <section className={styles.hero}><div><span className={styles.eyebrow}>BUILD THE FUND, STEP BY STEP</span><h1>原資100万円へ向けた、<br />スポンサー計画。</h1><p>費用を見込み、提案先を整理し、<br />実際に提供できる枠から育てます。</p></div><div className={styles.target}><span><Target size={18} />還元原資の目標</span><strong>{yen(FUNDING_TARGET_YEN)}</strong><small>売上ではなく、還元へ充てる額の目標</small></div></section>

      <section className={styles.actualPanel} aria-label="確認済み原資"><div><span className={styles.smallLabel}>このアプリで確認済みの原資</span><strong>¥0<span>実際の入金とは未連携</span></strong></div><div className={styles.goalProgress}><div><span>目標への実績</span><strong>0%</strong></div><div className={styles.progressTrack} role="progressbar" aria-label="確認済み原資の目標達成率" aria-valuenow={0} aria-valuemin={0} aria-valuemax={100}><span /></div><p>営業候補の予定額・入金シミュレーションは、この原資に加算しません。</p></div></section>
      <div className={styles.fundsRule}><ShieldCheck size={21} /><p><strong>入金された全額を、すぐに還元へ回す設計にはしません。</strong> 掲載の履行と、未提供分の返金に必要な資金の確保を確認した額だけを扱います。現在の実原資は未接続の0円です。</p></div>

      <section className={styles.panel} aria-labelledby="funding-calc-title"><div className={styles.sectionHeading}><div><span className={styles.sectionEyebrow}>PLANNING CALCULATOR</span><h2 id="funding-calc-title">100万円に必要な契約数を試算</h2></div><span className={styles.planBadge}>試算のみ</span></div><p className={styles.intro}>現在の商品価格は税込5,000円（販売保留中）。還元50%は試算用の仮設定です。入力しても、実売価格や運用の配分設定は変更されません。</p><div className={styles.calculatorFields}><label>1契約の税込単価（円）<input type="number" inputMode="numeric" min="100" max="10000000" step="1" value={priceText} onChange={event => setPriceText(event.target.value)} /></label><label>控除後の還元配分（%）<input type="number" inputMode="numeric" min="1" max="100" step="1" value={allocationText} onChange={event => setAllocationText(event.target.value)} /></label></div>
        {planError && <p className={styles.formError} role="status">{planError}</p>}
        {plan && <><div className={styles.results}><article><span>1契約からの還元原資・試算</span><strong>{yen(plan.rewardPerContractYen)}</strong><small>掲載履行・返金分確保後の想定</small></article><article><span>目標までの履行済み契約数</span><strong>{plan.contractsRequired === null ? "算定不可" : number(plan.contractsRequired)}{plan.contractsRequired !== null && <small>件</small>}</strong><small>同時に販売する枠数ではありません</small></article><article><span>必要な税込売上の目安</span><strong>{plan.grossAtTargetYen === null ? "—" : yen(plan.grossAtTargetYen)}</strong><small>目標に達するまでの累計試算</small></article></div>
        <div className={styles.calculationBody}><dl className={styles.breakdown}><div><dt>税込の契約額</dt><dd>{yen(plan.unitGrossYen)}</dd></div><div><dt>売上に含まれる税の取置額</dt><dd>−{yen(plan.salesTaxReserveYen)}</dd></div><div><dt>カード費用 3.6% ＋ 費用の消費税</dt><dd>−{yen(plan.cardProcessingFeeYen + plan.cardFeeTaxYen)}</dd></div><div><dt>Stripe Tax費用 0.5% ＋ 費用の消費税</dt><dd>−{yen(plan.taxServiceFeeYen + plan.taxServiceFeeTaxYen)}</dd></div><div className={styles.subtotal}><dt>税・手数料を控除した額</dt><dd>{yen(plan.netAfterReservesYen)}</dd></div><div className={styles.total}><dt>還元配分 {plan.rewardPercent}%</dt><dd>{yen(plan.rewardPerContractYen)}</dd></div></dl><div className={styles.assumptions}><h3>試算に使う条件</h3><ul><li>国内カード決済の費用を3.6%、Stripe Taxの費用を0.5%と仮定。</li><li>売上の消費税と、両方の手数料にかかる消費税を10%として見込みます。</li><li>{FUNDING_ASSUMPTIONS.rounding}</li><li>実際の契約・決済方法・料金で費用は変わります。その他の運営費、送金費用、返金による損失等は別に必要です。</li></ul>{plan.rewardPercent === 100 && <p className={styles.caution}>100%配分では、運営費・予備費・次の募集費をこの配分に確保しません。</p>}<p>控除後に残す計画額：1契約あたり <strong>{yen(plan.retainedPerContractYen)}</strong></p></div></div></>}
        <div className={styles.priceComparison}><div className={styles.sectionHeading}><h3>単価を変えた場合の比較</h3><span>還元配分 {compareRatio}%</span></div><p>下の3万円・10万円は、単価の比較シナリオです。新しい販売プランではありません。</p><div className={styles.tableScroll}><table><thead><tr><th scope="col">税込単価の試算</th><th scope="col">1契約の還元原資</th><th scope="col">必要な契約数</th><th scope="col">税込売上目安</th></tr></thead><tbody>{comparison.map(item => <tr key={item.unitGrossYen}><th scope="row">{yen(item.unitGrossYen)}</th><td>{yen(item.rewardPerContractYen)}</td><td>{item.contractsRequired === null ? "算定不可" : `${number(item.contractsRequired)}件`}</td><td>{item.grossAtTargetYen === null ? "—" : yen(item.grossAtTargetYen)}</td></tr>)}</tbody></table></div></div>
        <p className={styles.sources}>料金条件の参考：<a href="https://stripe.com/jp/pricing" target="_blank" rel="noreferrer">Stripeの料金</a> · <a href="https://support.stripe.com/questions/understanding-stripe-tax-pricing?locale=ja-JP" target="_blank" rel="noreferrer">Stripe Taxの料金</a> · <a href="https://support.stripe.com/questions/taxes-on-stripe-fees-for-businesses-in-japan?locale=ja-JP" target="_blank" rel="noreferrer">日本の手数料にかかる税</a></p>
      </section>

      <section className={styles.expansion}><div className={styles.sectionHeading}><div><span className={styles.sectionEyebrow}>START WITH ONE</span><h2>初回1枠から、段階的に増やす。</h2></div><Handshake size={27} /></div><div className={styles.expansionSteps}><article><h3>販売の準備を整える</h3><p>公開する掲載先、正式な販売者情報、掲載・返金の運用を確定します。連絡窓口は設定済みで、購入受付はまだ始めていません。</p></article><article><h3>最初の1枠を履行する</h3><p>掲載開始・終了、提供内容、受取額と費用を確認し、実際の掲載実績をつくります。</p></article><article><h3>提供可能な枠だけ増やす</h3><p>受け入れ可能な掲載枠と期間を決め、確認できた実績を使って次の提案を進めます。無制限の同時販売は行いません。</p></article></div></section>

      <section className={styles.panel} aria-labelledby="prospect-list-title"><div className={styles.sectionHeading}><div><span className={styles.sectionEyebrow}>YOUR SPONSOR PIPELINE</span><h2 id="prospect-list-title">営業候補を管理する</h2></div><button className={styles.primary} type="button" disabled={!data || busy || loading || data.prospects.length >= 5000} onClick={beginCreate}><Plus size={18} />候補を追加</button></div><p className={styles.intro}>実際に検討する企業を手動で登録します。保存や段階の変更は、連絡の送信・契約締結・入金確認を意味しません。</p>
        <div className={styles.pipelineSummary}><div><span>進行中の候補</span><strong>{data ? number(data.summary.activeCount) : "—"}<small>件</small></strong></div><div><span>候補の予定額合計</span><strong>{data ? yen(data.summary.estimatedAmountYen) : "—"}</strong></div><div className={styles.plannedNote}><Info size={19} /><p>予定額は売上でも原資でもありません。見送り・保管済みは合計から除きます。</p></div></div>
        <div className={styles.stageSummary}>{stages.map(stage => <button key={stage.value} type="button" aria-pressed={filter === stage.value} onClick={() => setFilter(filter === stage.value ? "all" : stage.value)}><span>{stage.label}</span><strong>{data ? activeProspects.filter(item => item.stage === stage.value).length : "—"}</strong></button>)}</div>
        <div className={styles.listTools}><label className={styles.searchField}><Search size={18} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="候補名・メモを検索" aria-label="営業候補を検索" /></label><label className={styles.selectField}><select aria-label="営業候補の段階で絞り込む" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">すべての段階</option>{stages.map(stage => <option value={stage.value} key={stage.value}>{stage.label}</option>)}<option value="archived">保管済み</option></select><ChevronDown size={16} /></label><button type="button" className={styles.iconButton} disabled={loading || busy} onClick={() => void refresh()} aria-label="営業候補を再読み込み"><RefreshCw size={19} /></button></div>
        {error && <div className={styles.error} role="alert"><Info size={19} /><p>{error} </p><button type="button" disabled={loading || busy} onClick={() => void refresh()}>再読み込み</button></div>}
        {loading && !data ? <div className={styles.empty} role="status"><RefreshCw size={27} /><h3>営業候補を読み込んでいます。</h3><p>登録内容を確認できるまで、候補を追加する操作はできません。</p></div> : !data ? <div className={styles.empty}><Wallet size={27} /><h3>営業候補をまだ読み込めていません。</h3><p>上の再読み込みから接続を確認してください。</p></div> : visibleProspects.length === 0 ? <div className={styles.empty}><Handshake size={30} /><h3>{data.prospects.length ? "この条件の営業候補はありません。" : "最初の提案先を、ここに。"}</h3><p>企業名・公式URL・予定額・段階・メモを保存できます。</p>{data.prospects.length === 0 && <button className={styles.secondary} type="button" onClick={beginCreate}><Plus size={17} />候補を追加する</button>}</div> : <div className={styles.prospectList}>{visibleProspects.slice(0, visibleLimit).map(item => <article className={styles.prospectCard} key={item.id}><div className={styles.prospectMain}><div className={styles.prospectMeta}><span data-stage={item.archivedAt !== null ? "archived" : item.stage}>{item.archivedAt !== null ? "保管済み" : stages.find(stage => stage.value === item.stage)?.label}</span><small>更新 {shortDate(item.updatedAt)}</small></div><h3>{item.companyName}</h3>{item.websiteUrl && /^https:\/\//i.test(item.websiteUrl) && <a href={item.websiteUrl} target="_blank" rel="noopener noreferrer">公式サイトを確認</a>}{item.notes && <p className={styles.prospectNotes}>{item.notes}</p>}<div className={styles.estimate}><span>営業管理上の予定額</span><strong>{yen(item.estimatedAmountYen)}</strong><small>入金・原資ではありません</small></div></div><div className={styles.prospectActions}>{item.archivedAt === null && <button type="button" className={styles.secondary} disabled={busy} onClick={() => beginEdit(item)}><Pencil size={15} />編集</button>}<button type="button" className={styles.secondary} onClick={() => void copyProposal(item)}><Copy size={15} />提案文をコピー</button>{item.archivedAt === null && <button type="button" className={styles.textButton} disabled={busy} onClick={() => { setSelected(item); setFormError(""); setModal("archive"); }}><Archive size={15} />削除・保管</button>}</div></article>)}</div>}
        {data && visibleProspects.length > 0 && <div className={styles.loadMore}><span>{number(visibleProspects.length)}件中 {number(Math.min(visibleLimit, visibleProspects.length))}件を表示</span>{visibleLimit < visibleProspects.length && <button className={styles.secondary} type="button" onClick={() => setVisibleLimit(count => count + 50)}>さらに50件表示</button>}</div>}
      </section>

      <section className={styles.outreachNote}><FileText size={23} /><div><h2>提案は、現在の実態を伝える文面で。</h2><p>利用実績が未確認であること、現在の掲載先が運営者限定であること、ポイントが換金不可であること、掲載・返金条件が下書きであることを含めます。コピーした文面は、送信前に確認できます。</p></div><button type="button" className={styles.secondary} onClick={() => void copyProposal()}><Copy size={16} />共通の提案文をコピー</button></section>
    </main><footer className={styles.footer}><span>TOKI · KASAI SOLUTIONS</span><span>計画額と実際の原資を分けて管理します。</span></footer>
    {notice && <div className={styles.toast} role="status"><CheckCircle2 size={19} />{notice}</div>}
    {(modal === "create" || modal === "edit") && <Modal title={modal === "edit" ? "営業候補を編集" : "営業候補を追加"} close={closeModal} busy={busy}><p className={styles.modalLead}>手動の営業メモを保存します。相手への連絡や入金確認は行いません。</p><form className={styles.form} onSubmit={event => void saveProspect(event)}><label>候補名・企業名<input autoFocus required maxLength={80} value={draft.companyName} onChange={event => setDraft({ ...draft, companyName: event.target.value })} placeholder="検討する企業名" /></label><label>公式サイトのURL（任意）<input type="url" maxLength={600} value={draft.websiteUrl} onChange={event => setDraft({ ...draft, websiteUrl: event.target.value })} placeholder="https://" /></label><div className={styles.fieldPair}><label>予定額（円）<input required type="number" inputMode="numeric" min="0" max="10000000" step="1" value={draft.estimatedAmountYen} onChange={event => setDraft({ ...draft, estimatedAmountYen: event.target.value })} /></label><label>営業の段階<span className={styles.selectField}><select value={draft.stage} onChange={event => setDraft({ ...draft, stage: event.target.value as SponsorProspectStage })}>{stages.map(stage => <option value={stage.value} key={stage.value}>{stage.label}</option>)}</select><ChevronDown size={16} /></span></label></div><label>メモ（任意）<textarea rows={4} maxLength={1000} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} placeholder="提案したい内容や次に確認すること" /><small>{draft.notes.length} / 1,000</small></label><div className={styles.modalNotice}><Info size={18} /><p>「連絡済」「合意」も手動のメモです。保存による送信・契約・入金確認はなく、実原資は増えません。</p></div>{formError && <p className={styles.formError} role="alert">{formError}</p>}<div className={styles.modalActions}><button type="button" className={styles.secondary} disabled={busy} onClick={closeModal}>閉じる</button><button type="submit" className={styles.primary} disabled={busy}>{busy ? "保存しています" : "候補を保存"}</button></div></form></Modal>}
    {modal === "archive" && selected && <Modal title="営業候補を保管済みに移す" close={closeModal} busy={busy}><p className={styles.modalLead}>「{selected.companyName}」を通常の一覧から外します。履歴を残すため完全には消去せず、「保管済み」から確認できます。実際の契約・支払いは変更しません。</p>{formError && <p className={styles.formError} role="alert">{formError}</p>}<div className={styles.modalActions}><button type="button" className={styles.secondary} disabled={busy} onClick={closeModal}>戻る</button><button type="button" className={styles.primary} disabled={busy} onClick={() => void archiveProspect()}>{busy ? "保存しています" : "保管済みに移す"}</button></div></Modal>}
    {modal === "copy" && <Modal title="提案文の下書き" close={closeModal}><p className={styles.modalLead}>自動コピーができませんでした。下の文面を選択してコピーしてください。相手への送信は行っていません。</p><textarea className={styles.copyFallback} aria-label="提案文の下書き" readOnly value={copyText} rows={15} onFocus={event => event.currentTarget.select()} /><div className={styles.modalActions}><button type="button" className={styles.primary} onClick={closeModal}>閉じる</button></div></Modal>}
  </div>;
}
