export type TokiPeriod = "morning" | "daytime" | "night";
export type TokiAmbienceStatus = "off" | "loading" | "playing" | "paused" | "blocked" | "error";
export type TokiAmbiencePreferences = { enabled: boolean; volume: number };
export type TokiAmbienceState = TokiAmbiencePreferences & {
  period: TokiPeriod;
  status: TokiAmbienceStatus;
  ready: boolean;
  error: string | null;
};

export const TOKI_AMBIENCE_STORAGE_KEY = "toki.ambience.v1";
export const TOKI_AMBIENCE_TRACKS: Record<TokiPeriod, string> = {
  morning: "/audio/morning.mp3",
  daytime: "/audio/daytime.mp3",
  night: "/audio/night.mp3",
};
export const TOKI_THEME_COLORS: Record<TokiPeriod, string> = {
  morning: "#fff2ef",
  daytime: "#fff6eb",
  night: "#0b1830",
};
export const TOKI_AMBIENCE_DEFAULTS: TokiAmbiencePreferences = { enabled: false, volume: 30 };

const TOKYO_CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

function tokyoParts(now: number): { hour: number; minute: number; second: number } {
  const parts = TOKYO_CLOCK.formatToParts(new Date(now));
  const number = (kind: string) => Number(parts.find((part) => part.type === kind)?.value ?? "0");
  return { hour: number("hour"), minute: number("minute"), second: number("second") };
}

export function getTokiPeriod(now: number | Date = Date.now()): TokiPeriod {
  const time = now instanceof Date ? now.getTime() : now;
  const { hour } = tokyoParts(Number.isFinite(time) ? time : Date.now());
  return hour >= 5 && hour < 11 ? "morning" : hour >= 11 && hour < 18 ? "daytime" : "night";
}

/** Check at least once a minute, and within 25ms after the next JST period boundary. */
export function getNextTokiPeriodCheckDelay(now = Date.now()): number {
  const { hour, minute, second } = tokyoParts(now);
  const secondOfDay = hour * 3600 + minute * 60 + second;
  const next = [5 * 3600, 11 * 3600, 18 * 3600, 29 * 3600].find((value) => value > secondOfDay)!;
  const fraction = ((now % 1000) + 1000) % 1000;
  return Math.max(25, Math.min(60_000, (next - secondOfDay) * 1000 - fraction + 25));
}

export function normalizeTokiVolume(value: unknown, fallback = TOKI_AMBIENCE_DEFAULTS.volume): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : fallback;
}

export function parseTokiAmbiencePreferences(raw: unknown): TokiAmbiencePreferences {
  let value = raw;
  if (typeof raw === "string") { try { value = JSON.parse(raw); } catch { return { ...TOKI_AMBIENCE_DEFAULTS }; } }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...TOKI_AMBIENCE_DEFAULTS };
  const record = value as Record<string, unknown>;
  return { enabled: record.enabled === true, volume: normalizeTokiVolume(record.volume) };
}

// Fixed source-only data: this script runs before the page contents paint, without user data.
export const TOKI_THEME_INIT_SCRIPT = `(function(){try{var h=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',hourCycle:'h23'}).format(new Date()));var p=h>=5&&h<11?'morning':h>=11&&h<18?'daytime':'night';var c=${JSON.stringify(TOKI_THEME_COLORS)};document.documentElement.dataset.tokiPeriod=p;var m=document.querySelectorAll('meta[name="theme-color"]');if(!m.length){var n=document.createElement('meta');n.name='theme-color';document.head.appendChild(n);m=[n];}m.forEach(function(x){x.content=c[p];});}catch(e){}})();`;

export type TokiAmbienceControllerOptions = {
  createAudio: () => HTMLAudioElement;
  createAudioContext?: () => AudioContext | null;
  loadPreferences?: () => unknown;
  savePreferences?: (preferences: TokiAmbiencePreferences) => void;
  onChange?: (state: TokiAmbienceState) => void;
  onTheme?: (period: TokiPeriod) => void;
  now?: () => number;
  visible?: boolean;
  playbackTimeoutMs?: number;
};

/** One media element and one gain graph per root provider, independent of route changes. */
export class TokiAmbienceController {
  private options: TokiAmbienceControllerOptions;
  private state: TokiAmbienceState;
  private audio: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private graphAttempted = false;
  private resourcePeriod: TokiPeriod | null = null;
  private visible: boolean;
  private generation = 0;
  private pending = false;
  private playbackWanted = false;
  private pendingSuspension: Promise<void> | null = null;
  private disposed = false;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(options: TokiAmbienceControllerOptions) {
    this.options = options;
    this.visible = options.visible ?? true;
    let preferences = { ...TOKI_AMBIENCE_DEFAULTS };
    try { preferences = parseTokiAmbiencePreferences(options.loadPreferences?.()); } catch { /* Storage may be unavailable. */ }
    this.state = { ...preferences, period: getTokiPeriod(this.now()), status: preferences.enabled ? "paused" : "off", ready: false, error: null };
  }

  private now(): number { return this.options.now?.() ?? Date.now(); }
  getSnapshot(): TokiAmbienceState { return { ...this.state }; }
  private emit(): void { if (!this.disposed) this.options.onChange?.(this.getSnapshot()); }
  private shouldPlay(): boolean { return !this.disposed && this.state.enabled && this.visible; }
  private mayContinuePlayback(): boolean { return this.shouldPlay() && this.playbackWanted; }
  private clearPlaybackTimeout(): void { if (this.timeout !== null) { clearTimeout(this.timeout); this.timeout = null; } }
  private save(): void { try { this.options.savePreferences?.({ enabled: this.state.enabled, volume: this.state.volume }); } catch { /* Sound controls remain usable without storage. */ } }

  start(): void {
    if (this.disposed || this.state.ready) return;
    this.state.ready = true;
    this.options.onTheme?.(this.state.period);
    this.emit();
    if (this.shouldPlay()) this.play();
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.state.enabled = enabled === true;
    this.state.error = null;
    this.save();
    if (!this.state.enabled) { this.halt("off"); return; }
    const changed = this.syncPeriod();
    if (this.visible && !changed) this.play(); else if (!this.visible) this.halt("paused");
  }

  toggle(): void { this.setEnabled(!this.state.enabled); }
  retry(): void {
    if (this.disposed || !this.state.enabled) return;
    if (this.state.status === "error" || this.audio?.error) this.resourcePeriod = null;
    const changed = this.syncPeriod();
    if (this.visible && !changed) this.play();
  }

  setVolume(value: number): void {
    if (this.disposed) return;
    this.state.volume = normalizeTokiVolume(value, this.state.volume);
    this.applyVolume();
    this.save();
    this.emit();
  }

  setVisible(visible: boolean): void {
    if (this.disposed) return;
    const changed = this.visible !== visible;
    this.visible = visible;
    const periodChanged = this.syncPeriod();
    if (!visible) this.halt(this.state.enabled ? "paused" : "off");
    else if (this.state.enabled && !periodChanged && (changed || this.state.status === "paused")) this.play();
  }

  syncPeriod(now = this.now()): boolean {
    if (this.disposed) return false;
    const period = getTokiPeriod(now);
    if (period === this.state.period) return false;
    this.state.period = period;
    this.options.onTheme?.(period);
    this.emit();
    if (this.shouldPlay()) this.play();
    return true;
  }

  private ensureAudio(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const audio = this.options.createAudio();
    audio.loop = true;
    audio.preload = "none";
    audio.volume = 1;
    audio.muted = false;
    audio.addEventListener("playing", this.onPlaying);
    audio.addEventListener("waiting", this.onWaiting);
    audio.addEventListener("error", this.onMediaError);
    audio.addEventListener("pause", this.onPause);
    this.audio = audio;
    return audio;
  }

  private ensureGraph(audio: HTMLAudioElement): void {
    if (this.graphAttempted) return;
    const context = this.context ?? this.options.createAudioContext?.() ?? null;
    if (!context) { this.graphAttempted = true; this.applyVolume(); return; }
    this.context = context;
    const gain = this.gain ?? context.createGain();
    this.gain = gain;
    const source = this.source ?? context.createMediaElementSource(audio);
    this.source = source;
    source.connect(gain);
    gain.connect(context.destination);
    context.addEventListener("statechange", this.onContextStateChange);
    this.graphAttempted = true;
    this.applyVolume();
  }

  private applyVolume(): void {
    const level = this.state.volume / 100;
    if (this.gain && this.context) {
      const now = this.context.currentTime;
      this.gain.gain.cancelScheduledValues(now);
      // Exact zero remains silent; other changes receive a short smoothing ramp.
      if (level === 0) this.gain.gain.setValueAtTime(0, now);
      else this.gain.gain.setTargetAtTime(level, now, 0.015);
      if (this.audio) this.audio.volume = 1;
    } else if (this.audio) this.audio.volume = level;
  }

  /** Called synchronously from controls so resume() and play() retain user activation. */
  private play(): void {
    if (!this.shouldPlay()) return;
    if (this.audio && this.resourcePeriod === this.state.period && !this.audio.paused && (!this.context || this.context.state === "running") && this.state.status === "playing") return;
    const token = ++this.generation;
    this.clearPlaybackTimeout();
    this.pending = true;
    this.playbackWanted = true;
    this.state.status = "loading";
    this.state.error = null;
    this.emit();
    let audio: HTMLAudioElement;
    let resume: Promise<void> = Promise.resolve();
    let playback: Promise<void>;
    try {
      audio = this.ensureAudio();
      this.ensureGraph(audio);
      if (this.resourcePeriod !== this.state.period || audio.error) {
        audio.pause();
        this.resourcePeriod = this.state.period;
        audio.src = TOKI_AMBIENCE_TRACKS[this.state.period];
        audio.load();
      }
      this.applyVolume();
      // Do not await resume before calling play: both need the same gesture stack.
      const context = this.context;
      const suspension = this.pendingSuspension;
      const immediateResume = context ? context.resume() : Promise.resolve();
      // A prior OFF can still be suspending while state reports running. Queue a
      // follow-up resume after it settles, while preserving the immediate gesture call.
      resume = context && suspension ? Promise.all([immediateResume, suspension]).then(() => {
        if (token === this.generation && this.mayContinuePlayback() && context.state !== "running" && context.state !== "closed") return context.resume();
      }) : immediateResume;
      playback = Promise.resolve(audio.play());
    } catch (reason) {
      void resume.catch(() => {});
      this.fail(token, reason);
      return;
    }
    this.timeout = setTimeout(() => {
      if (token !== this.generation || this.disposed) return;
      this.fail(token, { name: this.context && this.context.state !== "running" ? "NotAllowedError" : "TimeoutError" });
    }, this.options.playbackTimeoutMs ?? 12_000);

    void Promise.all([resume, playback]).then(() => {
      if (token !== this.generation || !this.mayContinuePlayback()) {
        if (!this.mayContinuePlayback()) { audio.pause(); this.suspendContext(); }
        return;
      }
      this.pending = false;
      this.clearPlaybackTimeout();
      if (this.context && this.context.state !== "running") { this.fail(token, { name: "NotAllowedError" }); return; }
      this.state.status = audio.paused ? "paused" : "playing";
      this.state.error = null;
      this.emit();
    }).catch((reason: unknown) => {
      if (token !== this.generation || this.disposed) { if (!this.mayContinuePlayback()) audio.pause(); return; }
      this.fail(token, reason);
    });
  }

  private fail(token: number, reason: unknown): void {
    if (token !== this.generation || this.disposed) return;
    ++this.generation;
    this.pending = false;
    this.playbackWanted = false;
    this.clearPlaybackTimeout();
    this.audio?.pause();
    this.suspendContext();
    if (!this.state.enabled || !this.visible) { this.state.status = this.state.enabled ? "paused" : "off"; this.state.error = null; this.emit(); return; }
    const name = reason && typeof reason === "object" && "name" in reason ? String(reason.name) : "";
    const blocked = name === "NotAllowedError" || name === "AbortError";
    this.state.status = blocked ? "blocked" : "error";
    this.state.error = blocked ? "音楽を再生するには、再開ボタンを押してください。" : name === "TimeoutError" ? "音源の読み込みを確認できませんでした。接続を確認して再度お試しください。" : "音源を再生できませんでした。接続を確認して再度お試しください。";
    this.emit();
  }

  private suspendContext(): void {
    if (this.context && this.context.state !== "suspended" && this.context.state !== "closed") {
      const pending = this.context.suspend().catch(() => {});
      this.pendingSuspension = pending;
      void pending.then(() => { if (this.pendingSuspension === pending) this.pendingSuspension = null; });
    }
  }

  private halt(status: "off" | "paused"): void {
    ++this.generation;
    this.pending = false;
    this.playbackWanted = false;
    this.clearPlaybackTimeout();
    this.audio?.pause();
    this.suspendContext();
    this.state.status = status;
    this.state.error = null;
    this.emit();
  }

  private onPlaying = (): void => {
    if (!this.mayContinuePlayback()) { this.audio?.pause(); return; }
    if (!this.context || this.context.state === "running") { this.state.status = "playing"; this.state.error = null; this.emit(); }
  };
  private onWaiting = (): void => { if (this.mayContinuePlayback()) { this.state.status = "loading"; this.emit(); } };
  private onPause = (): void => { if (this.mayContinuePlayback() && !this.pending && this.state.status === "playing") { this.state.status = "paused"; this.emit(); } };
  private onMediaError = (): void => { if (this.mayContinuePlayback() && this.audio?.error) this.fail(this.generation, { name: "MediaError" }); };
  private onContextStateChange = (): void => {
    if (!this.mayContinuePlayback() || !this.context) return;
    if (this.context.state === "running") { if (this.audio && !this.audio.paused) this.onPlaying(); }
    else if (!this.pending && this.state.status === "playing") this.fail(this.generation, { name: "NotAllowedError" });
  };

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.pending = false;
    this.playbackWanted = false;
    this.clearPlaybackTimeout();
    const audio = this.audio;
    if (audio) {
      audio.removeEventListener("playing", this.onPlaying);
      audio.removeEventListener("waiting", this.onWaiting);
      audio.removeEventListener("error", this.onMediaError);
      audio.removeEventListener("pause", this.onPause);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (this.context) {
      this.context.removeEventListener("statechange", this.onContextStateChange);
      this.source?.disconnect();
      this.gain?.disconnect();
      if (this.context.state !== "closed") void this.context.close().catch(() => {});
    }
    this.audio = null;
  }
}
