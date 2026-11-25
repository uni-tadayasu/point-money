"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Archive, Check, Copy, Eye, Megaphone, Pause, Pencil, Play, Plus, RefreshCw, ShieldCheck, Wallet, X } from "lucide-react";
import type { SponsorCampaign } from "../lib/sponsor-types";
import { allocateSponsorFunds } from "../lib/sponsor-core";
import type { SponsorDraft, TokiSponsors } from "../hooks/use-toki-sponsors";
import { SponsorSalesCard } from "./toki-sponsor-sales";
import styles from "./toki-sponsors.module.css";

const yen = (value: number) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value);
const date = (value: number | null) => value ? new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", timeZone: "Asia/Tokyo" }).format(value) : "未開始";
const duration = (value: number) => value < 60 ? `${Math.floor(value)}秒` : `${Math.floor(value / 60)}分${Math.floor(value % 60)}秒`;
const initialDraft: SponsorDraft = { company: "", title: "", description: "", url: "", amountYen: 5000, days: 30 };
const statusLabel = (campaign: SponsorCampaign) => campaign.status === "draft" ? "下書き" : campaign.status === "paused" ? "一時停止" : campaign.status === "archived" ? "アーカイブ" : campaign.isLive ? "掲載体験中" : "掲載期間終了";

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && !ref.current?.open) ref.current?.showModal(); if (!open && ref.current?.open) ref.current?.close(); }, [open]);
  return <dialog className={styles.dialog} ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} aria-label={title}>
    <div className={styles.modalBody}><header className={styles.modalHeader}><h2>{title}</h2><button type="button" className={styles.iconButton} aria-label="閉じる" onClick={onClose}><X size={21} /></button></header>{children}</div>
  </dialog>;
}

export function SponsorPanel({ sponsor }: { sponsor: TokiSponsors }) {
  const [dialog, setDialog] = useState<"create" | "edit" | "settle" | "archive" | null>(null);
  const [selected, setSelected] = useState<SponsorCampaign | null>(null);
  const [draft, setDraft] = useState<SponsorDraft>({ ...initialDraft });
  const [deductions, setDeductions] = useState(0);
  const [settlementKey, setSettlementKey] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const close = () => { if (!sponsor.busy) { setDialog(null); setFormError(""); } };
  const notify = (message: string) => { setNotice(message); };
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4500); return () => window.clearTimeout(timer); }, [notice]);

  async function submitDraft(event: FormEvent) {
    event.preventDefault(); setFormError("");
    try {
      if (dialog === "edit" && selected) await sponsor.updateCampaign(selected.id, draft);
      else await sponsor.createCampaign(draft);
      setDialog(null); setDraft({ ...initialDraft }); notify(dialog === "edit" ? "協賛プランの下書きを更新しました。" : "協賛プランを下書きに保存しました。");
    }
    catch (reason) { setFormError((reason as Error).message); }
  }
  async function submitSettlement(event: FormEvent) {
    event.preventDefault(); if (!selected) return; setFormError("");
    try { await sponsor.settle(selected.id, deductions, settlementKey); setDialog(null); notify("入金と配分のシミュレーションを記録しました。現金の入金はありません。"); }
    catch (reason) { setFormError((reason as Error).message); }
  }
  async function changeStatus(campaign: SponsorCampaign, action: "pause" | "resume" | "archive") {
    try { await sponsor.changeStatus(campaign.id, action); setDialog(null); notify(action === "archive" ? "アーカイブしました。配分の体験履歴は残ります。" : action === "pause" ? "掲載体験を一時停止しました。" : "掲載体験を再開しました。"); }
    catch (reason) { setFormError((reason as Error).message); }
  }
  async function copyProposal(campaign: SponsorCampaign) {
    const text = `【協賛提案の下書き・未送信】\n${campaign.company} 御中\n\nTOKIの協賛掲載についてのご提案です。\n掲載タイトル：${campaign.title}\n紹介文：${campaign.description || "別途ご相談"}\n掲載先URL：${campaign.url}\n提案金額：${yen(campaign.amountYen)}\n掲載期間：${campaign.days}日間\n\n本サービスは現在、運営者本人だけが閲覧できる確認版です。利用者数・表示実績は未確認で、掲載先の公開、販売者情報、税区分、掲載・返金条件を整えてから購入受付を案内します。現在、決済リンクは発行していません。表示時間に応じたポイント獲得という閲覧の誘因があり、現在のポイントは換金できません。広告クリックや商品購入をポイント付与の条件にはしません。画面内の表示時間は技術的な計測値であり、人の注視・表示回数・クリック・申込み・売上を保証しません。\n\n配分の計画例：経費控除後の50%を還元予算、20%を予備費、20%を運営費、10%を次の協賛募集の予算とします。\nこの文面のコピーによる契約・送信・決済は発生しません。`;
    try { await navigator.clipboard.writeText(text); notify("提案文をコピーしました。送信はしていません。"); }
    catch { notify("コピーできませんでした。ブラウザのクリップボード設定を確認してください。"); }
  }

  if (!sponsor.data) return <section className={styles.root}><SponsorSalesCard /><div className={styles.empty}><Megaphone size={32} /><h2>協賛シミュレーション</h2><p>{sponsor.error || "協賛データを読み込んでいます。"}</p>{sponsor.error && <button type="button" className={styles.primary} onClick={() => void sponsor.refresh()} disabled={sponsor.busy}><RefreshCw size={16} />再読み込み</button>}</div></section>;
  const data = sponsor.data;
  const cards = [
    { label: "還元予算", ratio: 50, amount: data.totals.rewardYen, detail: "利用者のポイント原資へ", color: "#0e695d" },
    { label: "予備費", ratio: 20, amount: data.totals.reserveYen, detail: "返金・変動に備える", color: "#6f9c94" },
    { label: "運営費", ratio: 20, amount: data.totals.operationsYen, detail: "サービスを維持する", color: "#4c6689" },
    { label: "次の協賛募集", ratio: 10, amount: data.totals.growthYen, detail: "提案・制作へ再投資する", color: "#b58a39" },
  ];
  const campaigns = data.campaigns.filter((item) => filter === "all" || item.status === filter);
  let preview = null;
  if (selected && Number.isSafeInteger(deductions) && deductions >= 0 && deductions <= 10_000_000) preview = allocateSponsorFunds(selected.amountYen, deductions);

  return <section className={styles.root}>
    <SponsorSalesCard />
    <header className={styles.heading}><div><span className={styles.eyebrow}>SPONSOR STUDIO</span><h2>原資を育てる、協賛の仕組み。</h2><p>企業の紹介枠をつくり、協賛収入の配分を設計します。</p></div><span className={styles.source}>{sponsor.source === "local" ? "この端末だけの体験" : "データを保存中の体験環境"}</span></header>
    <div className={styles.demoNotice}><ShieldCheck size={21} /><div><strong>ここから下は、入金・配分のシミュレーションです</strong><p>上の販売準備とは別のテスト用台帳です。実際の入金・契約・送金は発生せず、体験の配分額は換金できる残高に加算されません。</p></div></div>
    {sponsor.error && <div className={styles.error} role="alert">{sponsor.error}<button type="button" onClick={() => void sponsor.refresh()} disabled={sponsor.busy}>再読み込み</button></div>}
    <div className={styles.financialHeader}><div className={styles.realFunds}><Wallet size={23} /><span>実際の入金</span><strong>未接続</strong><small>このアプリで受領した現金は0円です。</small></div><div className={styles.simulatedFunds}><span>シミュレーションの配分対象額</span><strong>{yen(data.totals.netYen)}</strong><small>協賛設定額 {yen(data.totals.grossYen)} − 控除 {yen(data.totals.deductionsYen)}</small></div></div>
    <div className={styles.allocations}>{cards.map((card) => <article className={styles.allocationCard} key={card.label}><span className={styles.colorLine} style={{ background: card.color }} /><div><h3>{card.label}</h3><span>{card.ratio}%</span></div><strong>{yen(card.amount)}</strong><p>{card.detail}</p></article>)}</div>
    <div className={styles.growthNote}><strong>増やすのは、協賛との接点。</strong><p>紹介枠を提案し、合意した企業の掲載を行い、実際の入金を確認してから配分する設計です。「次の協賛募集」の予算は提案や制作へ使う計画額で、自動運用や収益の保証ではありません。</p></div>

    <section className={styles.campaignSection} aria-label="協賛プラン"><div className={styles.sectionHeader}><div><h3>協賛プラン</h3><span>{data.campaigns.length}件のプラン</span></div><button type="button" className={styles.primary} disabled={sponsor.busy || data.campaigns.length >= 100} onClick={() => { setSelected(null); setDraft({ ...initialDraft }); setDialog("create"); setFormError(""); }}><Plus size={18} />新しいプラン</button></div>
      <div className={styles.filters} aria-label="掲載状態で絞り込み">{[["all", "すべて"], ["draft", "下書き"], ["active", "掲載体験"], ["paused", "一時停止"], ["archived", "保管済み"]].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
      {campaigns.length === 0 ? <div className={styles.empty}><Megaphone size={33} /><h4>{data.campaigns.length ? "この状態のプランはありません" : "最初の協賛枠を、つくってみましょう。"}</h4><p>企業名・紹介文・提案額を登録すると、提案文のコピーと配分の体験ができます。</p></div> : <div className={styles.campaignList}>{campaigns.map((campaign) => <article key={campaign.id} className={styles.campaign}>
        <div className={styles.campaignMain}><div className={styles.campaignTop}><span className={styles.status} data-active={campaign.isLive}>{statusLabel(campaign)}</span><span>{campaign.company}</span></div><h4>{campaign.title}</h4>{campaign.description && <p>{campaign.description}</p>}<a className={styles.campaignLink} href={campaign.url} target="_blank" rel="noopener noreferrer sponsored">{new URL(campaign.url).hostname}</a><dl className={styles.campaignMeta}><div><dt>協賛の提案額</dt><dd>{yen(campaign.amountYen)}</dd></div><div><dt>掲載期間</dt><dd>{campaign.startsAt ? `${date(campaign.startsAt)}〜${date(campaign.endsAt)}` : `${campaign.days}日間`}</dd></div><div><dt>画面内の表示時間</dt><dd>{sponsor.source === "local" ? "未計測" : duration(campaign.report?.visibleSeconds || 0)}</dd></div></dl></div>
        <div className={styles.campaignActions}>{campaign.status === "draft" && <button type="button" className={styles.secondary} disabled={sponsor.busy} onClick={() => { setSelected(campaign); setDraft({ company: campaign.company, title: campaign.title, description: campaign.description, url: campaign.url, amountYen: campaign.amountYen, days: campaign.days }); setFormError(""); setDialog("edit"); }}><Pencil size={15} />下書きを編集</button>}<button type="button" className={styles.secondary} onClick={() => void copyProposal(campaign)}><Copy size={15} />提案文をコピー</button>{campaign.status === "draft" && <button type="button" className={styles.primary} disabled={sponsor.busy} onClick={() => { setSelected(campaign); setDeductions(0); setSettlementKey(crypto.randomUUID()); setFormError(""); setDialog("settle"); }}>入金・配分を体験</button>}{campaign.status === "active" && campaign.isLive && <button type="button" className={styles.secondary} disabled={sponsor.busy} onClick={() => void changeStatus(campaign, "pause")}><Pause size={15} />掲載を一時停止</button>}{campaign.status === "paused" && campaign.endsAt !== null && campaign.endsAt > Date.now() && <button type="button" className={styles.secondary} disabled={sponsor.busy} onClick={() => void changeStatus(campaign, "resume")}><Play size={15} />掲載を再開</button>}{campaign.status !== "archived" && <button type="button" className={styles.textButton} disabled={sponsor.busy} onClick={() => { setSelected(campaign); setFormError(""); setDialog("archive"); }}><Archive size={14} />アーカイブ</button>}</div>
      </article>)}</div>}
    </section>

    <section className={styles.ledgerSection}><div className={styles.sectionHeader}><div><h3>入金・配分の体験履歴</h3><span>実際の入金明細ではありません</span></div><button className={styles.iconButton} type="button" aria-label="協賛履歴を更新" disabled={sponsor.busy} onClick={() => void sponsor.refresh()}><RefreshCw size={19} /></button></div>{data.ledger.length ? <div className={styles.ledgerList}>{data.ledger.map((entry) => <div className={styles.ledgerRow} key={entry.id}><div><strong>{entry.campaignTitle}</strong><small>{date(entry.createdAt)}・配分シミュレーション</small></div><div><strong>{yen(entry.netYen)}</strong><small>還元予算 {yen(entry.rewardYen)}</small></div></div>)}</div> : <p className={styles.noHistory}>プランを保存し「入金・配分を体験」を実行すると、ここに記録されます。</p>}</section>
    <p className={styles.measureNote}><Eye size={16} />表示時間は、この画面の協賛枠が半分以上見えている時間の参考値です。人の注視・広告成果・売上の証明ではありません。</p>
    {notice && <div className={styles.toast} role="status"><Check size={18} />{notice}</div>}

    <Modal open={dialog === "create" || dialog === "edit"} title={dialog === "edit" ? "協賛プランの下書きを編集" : "新しい協賛プラン"} onClose={close}><p className={styles.modalLead}>{dialog === "edit" ? "企業名・紹介内容・提案額・期間を変更できます。入金・配分の体験を行ったプランは編集できません。" : "まずは提案の下書きを作成します。この操作で契約・掲載・請求は発生しません。"}</p><form onSubmit={(event) => void submitDraft(event)} className={styles.form}>
      <label>企業名・屋号<input autoFocus required maxLength={80} placeholder="例：〇〇コーヒー" value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} /></label>
      <label>掲載タイトル<input required maxLength={80} placeholder="紹介する商品やサービスのタイトル" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>紹介文<textarea rows={3} maxLength={400} placeholder="どんな価値を届けるか、わかりやすく。" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /><small>{draft.description.length} / 400</small></label>
      <label>紹介するサイトのURL<input required type="url" maxLength={600} placeholder="https://example.com" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} /><small>httpsの公開サイトを入力してください。</small></label>
      <div className={styles.fieldPair}><label>協賛の提案額（円）<input required type="number" min={100} max={10000000} step={1} value={draft.amountYen} onChange={(event) => setDraft({ ...draft, amountYen: Number(event.target.value) })} /></label><label>掲載期間（日）<input required type="number" min={1} max={90} step={1} value={draft.days} onChange={(event) => setDraft({ ...draft, days: Number(event.target.value) })} /></label></div>
      {formError && <p className={styles.error} role="alert">{formError}</p>}<div className={styles.modalActions}><button className={styles.secondary} type="button" onClick={close} disabled={sponsor.busy}>閉じる</button><button className={styles.primary} type="submit" disabled={sponsor.busy}>{sponsor.busy ? "保存しています" : dialog === "edit" ? "変更を保存" : "プランを保存"}</button></div>
    </form></Modal>

    <Modal open={dialog === "settle"} title="入金・配分のシミュレーション" onClose={close}>{selected && <form onSubmit={(event) => void submitSettlement(event)} className={styles.form}><div className={styles.modalWarning}><ShieldCheck size={20} /><p>現金は受け取っていません。テストの記録と協賛枠の掲載体験を開始します。</p></div><div className={styles.confirmAmount}><span>{selected.title}</span><strong>{yen(selected.amountYen)}</strong></div><label>控除の設定額（円）<input autoFocus type="number" required min={0} max={10000000} step={1} value={deductions} onChange={(event) => setDeductions(Number(event.target.value))} /><small>経費・返金などを想定した体験用の数値です。</small></label>{preview && <div className={styles.breakdown}><div><span>配分対象</span><strong>{yen(preview.netYen)}</strong></div><div><span>還元予算 50%</span><span>{yen(preview.rewardYen)}</span></div><div><span>予備費 20%</span><span>{yen(preview.reserveYen)}</span></div><div><span>運営費 20%</span><span>{yen(preview.operationsYen)}</span></div><div><span>次の協賛募集 10% ＋端数</span><span>{yen(preview.growthYen)}</span></div></div>}{deductions > selected.amountYen && <p className={styles.warningText}>控除が設定額を上回るため、配分できる金額は0円です。超過した費用は解消されません。</p>}{formError && <p className={styles.error} role="alert">{formError}</p>}<div className={styles.modalActions}><button type="button" className={styles.secondary} onClick={close} disabled={sponsor.busy}>戻る</button><button type="submit" className={styles.primary} disabled={sponsor.busy}>{sponsor.busy ? "記録しています" : "シミュレーションを実行"}</button></div></form>}</Modal>

    <Modal open={dialog === "archive"} title="プランをアーカイブ" onClose={close}><p className={styles.modalLead}>「{selected?.title}」の掲載体験を終了し、保管済みへ移します。入金・配分の体験履歴は残ります。</p>{formError && <p className={styles.error} role="alert">{formError}</p>}<div className={styles.modalActions}><button className={styles.secondary} type="button" onClick={close} disabled={sponsor.busy}>戻る</button><button className={styles.primary} type="button" disabled={sponsor.busy} onClick={() => selected && void changeStatus(selected, "archive")}>アーカイブする</button></div></Modal>
  </section>;
}

export function SponsorPlacement({ sponsor, rewardSession }: { sponsor: TokiSponsors; rewardSession?: { id: string } | null }) {
  const element = useRef<HTMLElement>(null);
  const [tracking, setTracking] = useState("未計測");
  const campaign = sponsor.data?.campaigns.find((item) => item.isLive && item.endsAt !== null && item.endsAt > Date.now());
  const snapshotRef = useRef(sponsor.data);
  snapshotRef.current = sponsor.data;
  const sessionId = rewardSession?.id || null;

  useEffect(() => {
    if (!campaign || sponsor.source !== "server" || !sessionId || !element.current) { setTracking(sponsor.source === "local" ? "この端末の体験・表示時間は未計測" : "表示時間は計測待ち"); return; }
    const campaignId = campaign.id;
    const initialView = campaign.viewSession;
    let sequence = initialView?.id === sessionId ? initialView.sequence : 0;
    let inView = false;
    let stopped = false;
    let pending = false;
    let baseline = sequence > 0;
    let desired = false;
    let resetNeeded = false;
    let retry: { sequence: number; visible: boolean } | null = null;

    async function send(visible: boolean) {
      desired = visible;
      if (!visible && pending) resetNeeded = true;
      if (pending || (!baseline && !visible && !retry)) return;
      if (stopped && visible) return;
      pending = true;
      const payload = retry || { sequence, visible: resetNeeded ? false : visible };
      let succeeded = false;
      retry = null;
      if (!payload.visible) resetNeeded = false;
      try {
        const next = await sponsor.recordView(campaignId, sessionId!, payload.sequence, payload.visible);
        const view = next.campaigns.find((item) => item.id === campaignId)?.viewSession;
        sequence = view?.id === sessionId ? view.sequence : payload.sequence + 1;
        baseline = true;
        succeeded = true;
        if (!stopped) setTracking(payload.visible ? "画面内の表示時間を計測中" : "表示時間の計測を一時停止");
      } catch (reason) {
        const failure = reason as Error & { status?: number; code?: string };
        if (failure.status === 409) {
          const latest = snapshotRef.current?.campaigns.find((item) => item.id === campaignId)?.viewSession;
          if (latest?.id === sessionId) sequence = latest.sequence;
          if (!stopped) { setTracking("計測状態を確認中"); void sponsor.refresh(); }
        } else { retry = payload; if (!stopped) setTracking("通信を待っています・未確定"); }
      } finally {
        pending = false;
        // Failed requests wait for the next observation; never spin on a lost connection.
        if (succeeded && (resetNeeded || (stopped && desired === false && baseline && payload.visible))) void send(false);
        else if (succeeded && !stopped && desired !== payload.visible && !retry) void send(desired);
      }
    }
    const update = () => { const visible = inView && !document.hidden && navigator.onLine; if (!visible) resetNeeded = pending; void send(visible); };
    if (typeof IntersectionObserver === "undefined") { setTracking("このブラウザでは表示時間は未計測です"); return; }
    const observer = new IntersectionObserver((entries) => { inView = entries[0]?.isIntersecting === true && entries[0].intersectionRatio >= 0.5; update(); }, { threshold: [0, 0.5, 1] });
    observer.observe(element.current);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("offline", update); window.addEventListener("online", update);
    const timer = window.setInterval(() => { const next = snapshotRef.current?.campaigns.find((item) => item.id === campaignId)?.viewSession; if (!pending && !retry && next?.id === sessionId) sequence = next.sequence; if (inView && !document.hidden && navigator.onLine) void send(true); }, 15_000);
    return () => { stopped = true; desired = false; observer.disconnect(); window.clearInterval(timer); document.removeEventListener("visibilitychange", update); window.removeEventListener("offline", update); window.removeEventListener("online", update); void send(false); };
  // A session change closes the old baseline before a new reward session can measure.
  }, [campaign?.id, sponsor.source, sessionId, sponsor.recordView]);

  if (!campaign) return <aside className={styles.placementEmpty}><Megaphone size={22} /><div><strong>この場所に、協賛の紹介を。</strong><p>「スポンサー」でプランを作り、入金のシミュレーションをすると表示されます。</p></div><span>DEMO</span></aside>;
  return <aside ref={element} className={styles.placement}><div className={styles.placementTop}><span>DEMO 協賛</span><span>{campaign.company}</span></div><h3>{campaign.title}</h3>{campaign.description && <p>{campaign.description}</p>}<div className={styles.placementBottom}><a href={campaign.url} target="_blank" rel="noopener noreferrer sponsored">紹介サイトを見る</a><small><Eye size={14} />{tracking}</small></div></aside>;
}
