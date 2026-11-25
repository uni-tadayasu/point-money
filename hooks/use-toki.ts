"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExchangeMethod, RewardExchange, RewardHistory, RewardsSnapshot } from "../lib/rewards-types";
import { advanceLocalRewardTime, createLocalRewardData, localTimeCoverageNote, normalizeLocalRewardData, type LocalRewardData } from "../lib/rewards-local";

export type TokiMethod = ExchangeMethod;
export type TokiHistory = RewardHistory;
export type TokiExchange = RewardExchange;
export type TokiSnapshot = RewardsSnapshot;

type LocalData = LocalRewardData;
const STORAGE = "toki.local-demo.v1";
const LEASE = "toki.local-demo.lease.v1";
const jstDay = (timestamp = Date.now()) => new Date(timestamp + 9 * 3600000).toISOString().slice(0, 10);
function readLocal(): LocalData {
  try {
    return normalizeLocalRewardData(JSON.parse(localStorage.getItem(STORAGE) || "null"));
  } catch { return createLocalRewardData(); }
}
function saveLocal(data: LocalData) { try { localStorage.setItem(STORAGE, JSON.stringify(data)); } catch { /* Private browsing can disable storage; this session still works. */ } }

export function useToki() {
  const [data, setData] = useState<TokiSnapshot | null>(null);
  const [mode, setMode] = useState<"loading" | "server" | "local">("loading");
  const [status, setStatus] = useState("準備しています");
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ownSession, setOwnSession] = useState<TokiSnapshot["session"]>(null);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [timingActive, setTimingActive] = useState(false);
  const [clockKeys, setClockKeys] = useState({ day: "", month: "" });
  const [timeCoverageNote, setTimeCoverageNote] = useState("");
  const control = useRef({ mode: "loading" as "loading" | "server" | "local", session: null as TokiSnapshot["session"], pending: false, manualPause: false, mustPause: false, stopped: false, lastAttempt: 0, lastHeartbeat: 0, lastPaint: 0, baseline: 0, owner: "", local: null as LocalData | null, hasLock: false, release: null as (() => void) | null, lockPending: false, sessionMs: 0, timingActive: false, snapshotTime: 0, snapshotPerf: 0 });

  const apply = useCallback((next: TokiSnapshot) => {
    setData(next); const now = performance.now(); control.current.baseline = now; control.current.snapshotTime = next.serverTime; control.current.snapshotPerf = now; setElapsed(0);
    const day = jstDay(next.serverTime); setClockKeys({ day, month: day.slice(0, 7) });
    setTimeCoverageNote("timeSchema" in next ? localTimeCoverageNote(next as LocalData) : "");
  }, []);

  const request = useCallback(async (path: string, body?: unknown) => {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw Object.assign(new Error(typeof payload.error === "string" ? payload.error : "通信を確認して、もう一度お試しください。"), { status: response.status, code: payload.code });
      return payload as unknown as TokiSnapshot;
    } finally { clearTimeout(timeout); }
  }, []);

  useEffect(() => {
    const state = control.current;
    let cancelled = false;
    state.stopped = false; state.owner = crypto.randomUUID(); state.lastPaint = performance.now();
    const change = (label: string, active = false) => { if (!state.stopped) { setStatus(label); setRunning(active); } };
    const timing = (active: boolean) => { state.timingActive = active; if (!cancelled && !state.stopped) setTimingActive(active); };
    function releaseLocal() {
      state.release?.(); state.release = null; state.hasLock = false;
      try { const lease = JSON.parse(localStorage.getItem(LEASE) || "null"); if (lease?.owner === state.owner) localStorage.removeItem(LEASE); } catch { /* no storage */ }
    }
    async function acquireLocal() {
      if (state.hasLock || state.lockPending) return;
      if (navigator.locks) {
        state.lockPending = true;
        void navigator.locks.request("toki-local-demo", { ifAvailable: true }, async lock => {
          state.lockPending = false;
          if (!lock || cancelled || state.stopped || document.hidden || state.manualPause) return;
          state.hasLock = true; state.local = readLocal(); state.lastPaint = performance.now();
          await new Promise<void>(resolve => { state.release = resolve; });
          state.hasLock = false;
        }).catch(() => { state.lockPending = false; });
      } else {
        try {
          const lease = JSON.parse(localStorage.getItem(LEASE) || "null");
          if (!lease || lease.until < Date.now() || lease.owner === state.owner) {
            localStorage.setItem(LEASE, JSON.stringify({ owner: state.owner, until: Date.now() + 3500 }));
            state.hasLock = JSON.parse(localStorage.getItem(LEASE) || "null")?.owner === state.owner;
          }
        } catch { state.hasLock = false; change("このブラウザでは保存を利用できません"); }
      }
    }
    async function pauseServer() {
      if (!state.session || state.pending) return;
      const own = state.session; state.pending = true; setOwnSession(null); timing(false);
      try { const next = await request("/api/rewards", { action: "pause", sessionId: own.id }); if (!cancelled && !state.stopped) apply(next); }
      catch { /* Lease expires without crediting hidden time. */ }
      finally { state.session = null; state.pending = false; state.mustPause = false; state.lastAttempt = 0; }
    }
    async function tick() {
      if (cancelled || state.stopped || state.mode === "loading") return;
      const now = performance.now(); const step = now - state.lastPaint; state.lastPaint = now;
      if (state.snapshotTime > 0) {
        const day = jstDay(state.snapshotTime + Math.max(0, now - state.snapshotPerf));
        setClockKeys((previous) => previous.day === day ? previous : { day, month: day.slice(0, 7) });
      }
      const eligible = !document.hidden && navigator.onLine && !state.manualPause && !state.mustPause && (state.mode === "local" ? state.hasLock : !!state.session && now - state.lastHeartbeat <= 30_000);
      if (state.timingActive && eligible && step > 0 && step <= 2500) { state.sessionMs += step; setSessionSeconds(Math.floor(state.sessionMs / 1000)); }
      timing(eligible);
      if (document.hidden || !navigator.onLine || state.manualPause) {
        state.mustPause = true; setOwnSession(null); releaseLocal(); void pauseServer(); setElapsed(0); timing(false);
        change(state.manualPause ? "計測を一時停止しています" : !navigator.onLine ? "オフラインのため一時停止" : "別の画面を表示中です");
        return;
      }
      if (state.mustPause && state.mode === "server") {
        if (state.pending) return;
        if (state.session) { await pauseServer(); return; }
        state.mustPause = false; state.lastAttempt = 0;
      }
      if (state.mode === "local") {
        const alreadyOwned = state.hasLock;
        await acquireLocal();
        if (!state.hasLock) { timing(false); change("ほかのタブで計測中です"); state.local = readLocal(); apply(state.local); return; }
        if (!navigator.locks) {
          try {
            const lease = JSON.parse(localStorage.getItem(LEASE) || "null");
            if (lease?.owner !== state.owner && lease?.until > Date.now()) { state.hasLock = false; timing(false); return; }
            localStorage.setItem(LEASE, JSON.stringify({ owner: state.owner, until: Date.now() + 3500 }));
          } catch { state.hasLock = false; timing(false); return; }
        }
        const local = readLocal();
        if (alreadyOwned && step > 0 && step <= 2500) {
          advanceLocalRewardTime(local, step);
          state.local = local; saveLocal(local); apply({ ...local, account: { ...local.account } });
        }
        state.mustPause = false; timing(true); setElapsed(0); change(local.account.todayEarned >= local.rules.dailyCap ? "本日のポイント上限・時間は計測中" : "テストポイントを計測中", local.account.todayEarned < local.rules.dailyCap); return;
      }
      if (state.session) setElapsed(Math.min(30, Math.max(0, (now - state.baseline) / 1000)));
      if (state.pending) return;
      const due = state.session ? now - state.lastHeartbeat >= 15000 : now - state.lastAttempt >= 15000;
      if (!due && (state.session || state.lastAttempt > 0)) return;
      state.pending = true; state.lastAttempt = now;
      try {
        const next = await request("/api/rewards", state.session ? { action: "heartbeat", sessionId: state.session.id, sequence: state.session.sequence, visible: true } : { action: "start" });
        if (cancelled || state.stopped) return;
        const isStart = state.session === null;
        state.session = next.session; setOwnSession(state.mustPause ? null : next.session); state.lastHeartbeat = performance.now(); if (isStart) state.lastPaint = state.lastHeartbeat; apply(next); setError("");
        if (state.mustPause) { change("計測を一時停止しています"); return; }
        timing(!document.hidden && navigator.onLine && !state.manualPause && !!state.session);
        change(next.account.todayEarned >= next.rules.dailyCap ? "本日のポイント上限・時間は計測中" : "テストポイントを計測中", next.account.todayEarned < next.rules.dailyCap);
      } catch (reason) {
        if (cancelled || state.stopped) return;
        const failure = reason as Error & { status?: number; code?: string };
        state.session = null; setOwnSession(null); setElapsed(0); timing(false);
        if (failure.status === 409) change(failure.code === "SESSION_ACTIVE" ? "ほかの画面で計測中です" : "計測を再接続しています");
        else { change("接続の確認を待っています"); setError(failure.message); }
      } finally { state.pending = false; if (!cancelled && state.mustPause && state.session) void pauseServer(); }
    }
    async function initialize() {
      try { const next = await request("/api/rewards"); if (cancelled || state.stopped) return; state.mode = "server"; setMode("server"); apply(next); void tick(); }
      catch (reason) {
        if (cancelled || state.stopped) return;
        const failure = reason as Error & { status?: number };
        if (failure.status === 401) { state.local = readLocal(); state.mode = "local"; setMode("local"); apply(state.local); void tick(); }
        else { setError(failure.message); change("接続できませんでした"); }
      }
    }
    function onVisibility() { if (document.hidden || !navigator.onLine) { state.mustPause = true; setOwnSession(null); setRunning(false); timing(false); } state.lastPaint = performance.now(); void tick(); }
    function onStorage(event: StorageEvent) { if (event.key === STORAGE && state.mode === "local" && !state.hasLock) { state.local = readLocal(); apply(state.local); } }
    function onPageHide() {
      state.mustPause = true; setOwnSession(null); releaseLocal(); timing(false);
      if (state.session) { void fetch("/api/rewards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop", sessionId: state.session.id }), keepalive: true }).catch(() => {}); state.session = null; }
    }
    void initialize();
    const timer = window.setInterval(() => { void tick(); }, 1000);
    document.addEventListener("visibilitychange", onVisibility); window.addEventListener("online", onVisibility); window.addEventListener("offline", onVisibility); window.addEventListener("pagehide", onPageHide); window.addEventListener("storage", onStorage);
    return () => { cancelled = true; state.stopped = true; window.clearInterval(timer); onPageHide(); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("online", onVisibility); window.removeEventListener("offline", onVisibility); window.removeEventListener("pagehide", onPageHide); window.removeEventListener("storage", onStorage); };
  }, [apply, request]);

  function togglePause() { control.current.manualPause = !control.current.manualPause; setPaused(control.current.manualPause); if (control.current.manualPause) { control.current.mustPause = true; control.current.timingActive = false; setTimingActive(false); setRunning(false); setOwnSession(null); } }

  async function exchange(method: TokiMethod, points: number) {
    if (!Number.isSafeInteger(points) || points < (data?.rules.minExchange || 100) || points > (data?.account.balance || 0)) throw new Error("交換ポイント数をご確認ください。");
    setBusy(true);
    try {
      if (mode === "local") {
        if (!control.current.hasLock) throw new Error("計測中のタブでお試しください。このタブで計測を再開してから申請できます。");
        const local = readLocal();
        if (local.account.balance < points) throw new Error("テストポイントが足りません。");
        local.account.balance -= points;
        const id = crypto.randomUUID(); const createdAt = Date.now();
        local.exchanges.unshift({ id, method, points, status: "simulated", createdAt });
        local.history.unshift({ id, type: "exchange", points: -points, createdAt, description: "交換手順のテスト（送金なし）" });
        saveLocal(local); control.current.local = local; apply(local);
      } else { const next = await request("/api/rewards/exchange", { method, points, simulation: true, idempotencyKey: crypto.randomUUID() }); apply(next); }
    } finally { setBusy(false); }
  }
  async function cancel(id: string) {
    setBusy(true);
    try {
      if (mode === "local") {
        if (!control.current.hasLock) throw new Error("計測中のタブでお試しください。このタブで計測を再開してから取り消せます。");
        const local = readLocal(); const item = local.exchanges.find(exchange => exchange.id === id);
        if (!item || item.status !== "simulated") throw new Error("このテスト申請はすでに取り消されています。");
        item.status = "cancelled"; local.account.balance += item.points;
        local.history.unshift({ id: crypto.randomUUID(), type: "refund", points: item.points, createdAt: Date.now(), description: "テスト申請の取消・ポイント返却" });
        saveLocal(local); control.current.local = local; apply(local);
      } else { const next = await request("/api/rewards/exchange", { action: "cancel", id, simulation: true }); apply(next); }
    } finally { setBusy(false); }
  }
  async function refresh() {
    if (mode === "local") { control.current.local = readLocal(); apply(control.current.local); return; }
    setBusy(true); try { apply(await request("/api/rewards")); control.current.mode = "server"; setMode("server"); setError(""); control.current.lastAttempt = 0; } catch (reason) { const failure = reason as Error & { status?: number }; if (failure.status === 401) { control.current.local = readLocal(); control.current.mode = "local"; setMode("local"); apply(control.current.local); setError(""); } else setError(failure.message); } finally { setBusy(false); }
  }
  const displayTodaySeconds = data && data.account.dayKey === clockKeys.day ? data.account.todaySeconds : 0;
  const displayMonthSeconds = data && data.account.monthKey === clockKeys.month ? data.account.monthSeconds : 0;
  return { data, mode, status, running, paused, elapsed, error, busy, ownSession, sessionSeconds, timingActive, displayTodaySeconds, displayMonthSeconds, timeCoverageNote, togglePause, exchange, cancel, refresh };
}
