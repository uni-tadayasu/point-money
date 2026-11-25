"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getNextTokiPeriodCheckDelay, TOKI_AMBIENCE_DEFAULTS, TOKI_AMBIENCE_STORAGE_KEY, TOKI_THEME_COLORS, TokiAmbienceController, type TokiAmbienceState, type TokiPeriod } from "../lib/toki-ambience";

type AmbienceContextValue = TokiAmbienceState & {
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
  setVolume: (volume: number) => void;
  retry: () => void;
};
const AmbienceContext = createContext<AmbienceContextValue | null>(null);
const INITIAL_STATE: TokiAmbienceState = { ...TOKI_AMBIENCE_DEFAULTS, period: "daytime", status: "off", ready: false, error: null };

function applyTheme(period: TokiPeriod): void {
  document.documentElement.dataset.tokiPeriod = period;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (!metas.length) { const meta = document.createElement("meta"); meta.name = "theme-color"; meta.content = TOKI_THEME_COLORS[period]; document.head.appendChild(meta); }
  else metas.forEach((meta) => { meta.content = TOKI_THEME_COLORS[period]; });
}

export function TokiAmbienceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TokiAmbienceState>(INITIAL_STATE);
  const controller = useRef<TokiAmbienceController | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const playback = new TokiAmbienceController({
      createAudio: () => new Audio(),
      createAudioContext: () => {
        const AudioContextType = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        return AudioContextType ? new AudioContextType() : null;
      },
      loadPreferences: () => localStorage.getItem(TOKI_AMBIENCE_STORAGE_KEY),
      savePreferences: (preferences) => localStorage.setItem(TOKI_AMBIENCE_STORAGE_KEY, JSON.stringify(preferences)),
      visible: !document.hidden,
      onTheme: applyTheme,
      onChange: (next) => { if (!disposed) setState(next); },
    });
    controller.current = playback;
    playback.start();
    function schedule() {
      if (timer !== null) clearTimeout(timer);
      if (disposed) return;
      timer = setTimeout(() => { playback.syncPeriod(); schedule(); }, getNextTokiPeriodCheckDelay());
    }
    function onVisibility() { playback.setVisible(!document.hidden); schedule(); }
    function onPageHide() { playback.setVisible(false); if (timer !== null) clearTimeout(timer); }
    function onPageShow() { playback.setVisible(!document.hidden); schedule(); }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    schedule();
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      if (controller.current === playback) controller.current = null;
      playback.destroy();
    };
  }, []);

  const setEnabled = useCallback((enabled: boolean) => controller.current?.setEnabled(enabled), []);
  const toggle = useCallback(() => controller.current?.toggle(), []);
  const setVolume = useCallback((volume: number) => controller.current?.setVolume(volume), []);
  const retry = useCallback(() => controller.current?.retry(), []);
  const value = useMemo(() => ({ ...state, setEnabled, toggle, setVolume, retry }), [state, setEnabled, toggle, setVolume, retry]);
  return <AmbienceContext.Provider value={value}>{children}</AmbienceContext.Provider>;
}

export function useTokiAmbience(): AmbienceContextValue {
  const value = useContext(AmbienceContext);
  if (!value) throw new Error("useTokiAmbience must be used inside TokiAmbienceProvider.");
  return value;
}
