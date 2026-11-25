"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, MoonStar, Music2, Pause, Play, Sun, Sunrise, Volume1, Volume2, VolumeX, X } from "lucide-react";
import { useTokiAmbience } from "./toki-ambience-provider";
import styles from "./toki-bgm-controls.module.css";

const periods = {
  morning: { label: "朝", time: "05:00–10:59", track: "00001", Icon: Sunrise },
  daytime: { label: "昼", time: "11:00–17:59", track: "00002", Icon: Sun },
  night: { label: "夜", time: "18:00–04:59", track: "00003", Icon: MoonStar },
} as const;

/** Controls share the one audio instance mounted by the root provider. */
export function TokiBgmControls() {
  const ambience = useTokiAmbience();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const volumeId = useId();
  const period = periods[ambience.period];
  const PeriodIcon = period.Icon;
  const isPlaying = ambience.enabled && ambience.status === "playing";
  const needsResume = ambience.enabled && (ambience.status === "paused" || ambience.status === "blocked");
  const status = !ambience.ready ? "準備中" : !ambience.enabled ? "OFF" : ambience.status === "loading" ? "読込中" : ambience.status === "blocked" ? "再開待ち" : ambience.status === "error" ? "読込エラー" : ambience.status === "paused" ? "一時停止" : ambience.volume === 0 ? "ON・消音" : "ON";
  const compactStatus = !ambience.ready ? "準備" : !ambience.enabled ? "OFF" : ambience.status === "loading" ? "読込" : ambience.status === "blocked" || ambience.status === "paused" ? "待機" : ambience.status === "error" ? "エラー" : ambience.volume === 0 ? "消音" : "ON";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
    triggerRef.current?.focus();
  }

  return <>
    <button ref={triggerRef} type="button" className={styles.trigger} data-playing={isPlaying} aria-haspopup="dialog" aria-expanded={open} aria-label={`BGMの設定を開く、${status}`} onClick={() => setOpen(true)}>
      {isPlaying && ambience.volume > 0 ? <Volume2 size={18} /> : <Music2 size={18} />}
      <span>BGM</span><span className={styles.triggerState}>{compactStatus}</span>
    </button>
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }} onClose={() => { setOpen(false); triggerRef.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.content}>
        <header className={styles.header}><div><span className={styles.eyebrow}>SOUND FOR YOUR TIME</span><h2 id={titleId}>時間に寄り添うBGM</h2></div><button type="button" className={styles.close} onClick={close} aria-label="BGMの設定を閉じる"><X size={21} /></button></header>
        <section className={styles.track} aria-label="現在の曲"><span className={styles.periodIcon}><PeriodIcon size={27} /></span><div><span>{period.label}の音楽 · {period.time}</span><strong>Track {period.track}</strong><small>日本時間に合わせて切り替わります</small></div></section>
        <div className={styles.switchRow}><div><strong>BGMを流す</strong><p>{!ambience.enabled ? "ONにすると音楽が流れます。" : ambience.status === "playing" ? (ambience.volume === 0 ? "再生中です。音量は0%です。" : "お好みの音量でお楽しみください。") : ambience.status === "loading" ? "音楽を読み込んでいます。" : "再生状態を下で確認できます。"}</p></div><button type="button" role="switch" aria-checked={ambience.enabled} aria-label="BGMのON・OFF" className={styles.switch} disabled={!ambience.ready} onClick={ambience.toggle}><span>{ambience.enabled ? "ON" : "OFF"}</span><i /></button></div>
        <div className={styles.volumeHeader}><label htmlFor={volumeId}>音量</label><output htmlFor={volumeId}>{ambience.volume}%</output></div>
        <div className={styles.volumeRow}><VolumeX size={20} /><input id={volumeId} type="range" min="0" max="100" step="1" value={ambience.volume} disabled={!ambience.ready} aria-valuetext={`${ambience.volume}%`} onChange={event => ambience.setVolume(Number(event.target.value))} /><Volume2 size={21} /></div>
        <div className={styles.playState} role="status" aria-live="polite">{ambience.status === "loading" ? <LoaderCircle size={17} className={styles.loading} /> : isPlaying ? <Volume1 size={17} /> : <Pause size={17} />}<span>{!ambience.ready ? "音楽の設定を準備しています。" : !ambience.enabled ? "BGMはOFFです。音は流れていません。" : ambience.status === "loading" ? "音楽を読み込んでいます…" : ambience.status === "blocked" ? "ブラウザの操作待ちです。「再生する」を押してください。" : ambience.status === "paused" ? "音楽を一時停止しています。" : ambience.status === "error" ? "音楽を読み込めませんでした。" : `Track ${period.track} を${ambience.volume === 0 ? "消音で" : ""}再生中`}</span></div>
        {ambience.error && <p className={styles.error} role="alert">{ambience.error}</p>}
        {(needsResume || ambience.status === "error") && <button type="button" className={styles.resume} disabled={!ambience.ready} onClick={ambience.retry}><Play size={17} />{ambience.status === "error" ? "もう一度読み込む" : "再生する"}</button>}
        <p className={styles.note}>初めて開いたときはOFFです。オン・オフと音量の設定は、このブラウザに保存されます。</p>
      </div>
    </dialog>
  </>;
}
