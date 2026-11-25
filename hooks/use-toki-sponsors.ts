"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { allocateSponsorFunds, validateSponsorCampaign } from "../lib/sponsor-core";
import type { SponsorCampaign, SponsorSnapshot } from "../lib/sponsor-types";

const STORAGE = "toki.sponsors.local-demo.v1";
const DAY = 86_400_000;
type Source = "loading" | "server" | "local" | "error";
export type SponsorDraft = { company: string; title: string; description: string; url: string; amountYen: number; days: number };
type SponsorFailure = Error & { status?: number; code?: string };
type LocalSponsor = SponsorSnapshot & { operationKeys: Record<string, { campaignId: string; deductionsYen: number }> };

function emptyLocal(): LocalSponsor {
  return {
    mode: "demo", simulation: true, currency: "JPY", serverTime: Date.now(),
    allocationRules: { reward: 50, reserve: 20, operations: 20, growth: 10 },
    totals: { grossYen: 0, deductionsYen: 0, netYen: 0, rewardYen: 0, reserveYen: 0, operationsYen: 0, growthYen: 0, realReceivedYen: 0 },
    campaigns: [], ledger: [], operationKeys: {},
    funding: { realEnabled: false, reason: "この端末だけの協賛シミュレーションです。実際の入金・掲載契約・送金はありません。表示時間は未計測です。" },
  };
}

function readLocal(): LocalSponsor {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) || "null") as LocalSponsor | null;
    if (!value || value.mode !== "demo" || value.simulation !== true || !Array.isArray(value.campaigns) || !Array.isArray(value.ledger) || value.campaigns.length > 100 || value.ledger.length > 100 || !value.operationKeys || typeof value.operationKeys !== "object") return emptyLocal();
    const next = { ...emptyLocal(), ...value, serverTime: Date.now() };
    next.funding = emptyLocal().funding;
    next.totals.realReceivedYen = 0;
    next.campaigns = next.campaigns.map((item) => ({ ...item, viewSession: null, report: { visibleSeconds: 0, confirmedIntervals: 0 }, isLive: item.status === "active" && item.startsAt !== null && item.endsAt !== null && item.startsAt <= Date.now() && item.endsAt > Date.now() }));
    return next;
  } catch { return emptyLocal(); }
}

function writeLocal(data: LocalSponsor): void {
  localStorage.setItem(STORAGE, JSON.stringify(data));
}

function localMutation(payload: Record<string, unknown>): LocalSponsor {
  const data = readLocal();
  const now = Date.now();
  if (payload.action === "create") {
    if (data.campaigns.length >= 100) throw new Error("保存できる協賛プランは100件までです。");
    const valid = validateSponsorCampaign(payload);
    data.campaigns.unshift({ ...valid, id: crypto.randomUUID(), createdAt: now, startsAt: null, endsAt: null, status: "draft", isLive: false, viewSession: null, report: { visibleSeconds: 0, confirmedIntervals: 0 } });
  } else {
    const item = data.campaigns.find((campaign) => campaign.id === payload.campaignId);
    if (!item) throw new Error("協賛プランが見つかりません。");
    if (payload.action === "update") {
      if (item.status !== "draft" || data.ledger.some((entry) => entry.campaignId === item.id)) throw new Error("編集できるのは下書きのプランだけです。入金・配分の体験履歴は変更できません。");
      Object.assign(item, validateSponsorCampaign(payload));
    } else if (payload.action === "simulate_settlement") {
      if (payload.simulation !== true) throw new Error("実際の入金には対応していません。");
      const key = String(payload.idempotencyKey ?? "");
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key)) throw new Error("操作の識別子を確認してください。");
      const previous = data.operationKeys[key];
      if (previous) {
        if (previous.campaignId !== item.id || previous.deductionsYen !== payload.deductionsYen) throw new Error("同じ操作の内容を変更できません。");
        return data;
      }
      if (item.status !== "draft") throw new Error("このプランの入金シミュレーションは完了しています。");
      const allocation = allocateSponsorFunds(item.amountYen, Number(payload.deductionsYen));
      item.status = "active"; item.startsAt = now; item.endsAt = now + item.days * DAY; item.isLive = true;
      data.operationKeys[key] = { campaignId: item.id, deductionsYen: Number(payload.deductionsYen) };
      data.ledger.unshift({ ...allocation, id: crypto.randomUUID(), campaignId: item.id, campaignTitle: item.title, simulation: true, createdAt: now });
      data.totals = data.ledger.reduce((sum, entry) => ({ grossYen: sum.grossYen + entry.grossYen, deductionsYen: sum.deductionsYen + entry.deductionsYen, netYen: sum.netYen + entry.netYen, rewardYen: sum.rewardYen + entry.rewardYen, reserveYen: sum.reserveYen + entry.reserveYen, operationsYen: sum.operationsYen + entry.operationsYen, growthYen: sum.growthYen + entry.growthYen, realReceivedYen: 0 }), emptyLocal().totals);
    } else if (payload.action === "archive") {
      item.status = "archived"; item.isLive = false;
    } else if (payload.action === "pause" && item.status === "active") {
      item.status = "paused"; item.isLive = false;
    } else if (payload.action === "resume" && item.status === "paused" && item.endsAt !== null && item.endsAt > now) {
      item.status = "active"; item.isLive = true;
    } else throw new Error("この状態では操作できません。掲載期間も確認してください。");
  }
  data.serverTime = now;
  writeLocal(data);
  return data;
}

export function useTokiSponsors() {
  const [data, setData] = useState<SponsorSnapshot | null>(null);
  const [source, setSource] = useState<Source>("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sourceRef = useRef<Source>("loading");
  const alive = useRef(true);

  const request = useCallback(async (body?: Record<string, unknown>) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch("/api/sponsors", { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const payload: unknown = await response.json().catch(() => null);
      const object = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      if (!response.ok) throw Object.assign(new Error(typeof object.error === "string" ? object.error : "協賛データを読み込めませんでした。"), { status: response.status, code: object.code });
      if (object.mode !== "demo" || object.simulation !== true || !Array.isArray(object.campaigns)) throw new Error("協賛データの形式を確認できませんでした。");
      return payload as SponsorSnapshot;
    } catch (reason) {
      if (controller.signal.aborted) throw new Error("通信がタイムアウトしました。接続を確認して、もう一度お試しください。");
      throw reason;
    } finally { window.clearTimeout(timeout); }
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      if (sourceRef.current === "local") { setData(readLocal()); setError(""); return; }
      const next = await request();
      if (!alive.current) return;
      sourceRef.current = "server"; setSource("server"); setData(next); setError("");
    } catch (reason) {
      if (!alive.current) return;
      if ((reason as SponsorFailure).status === 401) { sourceRef.current = "local"; setSource("local"); setData(readLocal()); setError(""); }
      else { if (!data) { sourceRef.current = "error"; setSource("error"); } setError((reason as Error).message); }
    } finally { if (alive.current) setBusy(false); }
  }, [request, data]);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void request().then((next) => {
      if (cancelled) return;
      sourceRef.current = "server"; setSource("server"); setData(next); setError("");
    }).catch((reason: SponsorFailure) => {
      if (cancelled) return;
      if (reason.status === 401) { sourceRef.current = "local"; setSource("local"); setData(readLocal()); }
      else { sourceRef.current = "error"; setSource("error"); setError(reason.message); }
    });
    function onStorage(event: StorageEvent) { if (event.key === STORAGE && sourceRef.current === "local") setData(readLocal()); }
    window.addEventListener("storage", onStorage);
    return () => { cancelled = true; alive.current = false; window.removeEventListener("storage", onStorage); };
  }, [request]);

  const perform = useCallback(async (payload: Record<string, unknown>, quiet = false) => {
    if (!quiet) { setBusy(true); setError(""); }
    try {
      let next: SponsorSnapshot;
      if (sourceRef.current === "local") {
        const mutate = () => localMutation(payload);
        next = navigator.locks ? await navigator.locks.request("toki-sponsors-write", mutate) : mutate();
      } else if (sourceRef.current === "server") next = await request(payload);
      else throw new Error("協賛データの接続を確認してください。");
      if (alive.current) setData(next);
      return next;
    } catch (reason) { if (!quiet && alive.current) setError((reason as Error).message); throw reason; }
    finally { if (!quiet && alive.current) setBusy(false); }
  }, [request]);

  const createCampaign = useCallback((draft: SponsorDraft) => perform({ action: "create", ...draft }), [perform]);
  const updateCampaign = useCallback((campaignId: string, draft: SponsorDraft) => perform({ action: "update", campaignId, ...draft }), [perform]);
  const settle = useCallback((campaignId: string, deductionsYen: number, idempotencyKey: string) => perform({ action: "simulate_settlement", simulation: true, campaignId, deductionsYen, idempotencyKey }), [perform]);
  const changeStatus = useCallback((campaignId: string, action: "pause" | "resume" | "archive") => perform({ action, campaignId }), [perform]);
  const recordView = useCallback((campaignId: string, sessionId: string, sequence: number, visible: boolean) => perform({ action: "record_view", simulation: true, campaignId, sessionId, sequence, visible }, true), [perform]);
  return { data, source, error, busy, refresh, createCampaign, updateCampaign, settle, changeStatus, recordView };
}

export type TokiSponsors = ReturnType<typeof useTokiSponsors>;
