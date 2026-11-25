import assert from 'node:assert/strict';
import test from 'node:test';
import { getNextTokiPeriodCheckDelay, getTokiPeriod, normalizeTokiVolume, parseTokiAmbiencePreferences, TokiAmbienceController } from '../lib/toki-ambience.ts';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class FakeAudio extends EventTarget {
  src = ''; loop = false; preload = ''; volume = 1; muted = false; paused = true; error = null;
  plays = 0; loads = []; playQueue = [];
  play() {
    this.plays += 1;
    const result = this.playQueue.length ? this.playQueue.shift()() : Promise.resolve();
    return Promise.resolve(result).then(() => { this.paused = false; this.dispatchEvent(new Event('playing')); });
  }
  pause() { const changed = !this.paused; this.paused = true; if (changed) this.dispatchEvent(new Event('pause')); }
  load() { this.loads.push(this.src); this.paused = true; this.error = null; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}
class FakeContext extends EventTarget {
  state = 'suspended'; currentTime = 0; destination = {}; resumes = 0; suspends = 0; closes = 0; sources = 0; resumeQueue = [];
  gain = { value: 1, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; } };
  createGain() { return { gain: this.gain, connect() {}, disconnect() {} }; }
  createMediaElementSource() { this.sources += 1; return { connect() {}, disconnect() {} }; }
  resume() {
    this.resumes += 1;
    const result = this.resumeQueue.length ? this.resumeQueue.shift()() : Promise.resolve();
    return Promise.resolve(result).then(() => { this.state = 'running'; this.dispatchEvent(new Event('statechange')); });
  }
  suspend() { this.suspends += 1; this.state = 'suspended'; this.dispatchEvent(new Event('statechange')); return Promise.resolve(); }
  close() { this.closes += 1; this.state = 'closed'; return Promise.resolve(); }
}
function fixture(t, options = {}) {
  const audio = new FakeAudio(); const context = new FakeContext(); const updates = []; const themes = []; const saves = [];
  let created = 0; let now = Date.parse('2026-11-25T00:00:00Z');
  const controller = new TokiAmbienceController({ createAudio: () => { created += 1; return audio; }, createAudioContext: () => context, onChange: (next) => updates.push(next), onTheme: (value) => themes.push(value), savePreferences: (value) => saves.push(value), now: () => now, ...options });
  t.after(() => controller.destroy());
  return { controller, audio, context, updates, themes, saves, get created() { return created; }, setTime(value) { now = Date.parse(value); } };
}

test('Tokyo periods switch at 05:00, 11:00 and 18:00 and remain night across midnight', () => {
  for (const [instant, expected] of [
    ['2026-11-24T19:59:59.999Z', 'night'], ['2026-11-24T20:00:00.000Z', 'morning'],
    ['2026-11-25T01:59:59.999Z', 'morning'], ['2026-11-25T02:00:00.000Z', 'daytime'],
    ['2026-11-25T08:59:59.999Z', 'daytime'], ['2026-11-25T09:00:00.000Z', 'night'],
    ['2026-11-25T14:59:59.999Z', 'night'], ['2026-11-25T15:00:00.000Z', 'night'],
  ]) assert.equal(getTokiPeriod(Date.parse(instant)), expected, instant);
  assert.equal(getNextTokiPeriodCheckDelay(Date.parse('2026-11-25T01:59:59.990Z')), 35);
  assert.equal(getNextTokiPeriodCheckDelay(Date.parse('2026-11-25T01:00:00.000Z')), 60_000);
});

test('device UTC and other local timezones cannot change the Tokyo period', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      assert.equal(getTokiPeriod(new Date('2026-11-25T02:00:00Z')), 'daytime');
      assert.equal(getTokiPeriod(new Date('2026-11-25T20:00:00Z')), 'morning');
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test('saved preferences require a real boolean and clamp only finite numeric volume', () => {
  for (const value of [undefined, null, '{bad json', [], true, 'null']) assert.deepEqual(parseTokiAmbiencePreferences(value), { enabled: false, volume: 30 });
  assert.deepEqual(parseTokiAmbiencePreferences('{"enabled":true,"volume":0}'), { enabled: true, volume: 0 });
  assert.deepEqual(parseTokiAmbiencePreferences({ enabled: 'true', volume: '80' }), { enabled: false, volume: 30 });
  assert.equal(normalizeTokiVolume(-20), 0);
  assert.equal(normalizeTokiVolume(101), 100);
  assert.equal(normalizeTokiVolume(45.6), 46);
  assert.equal(normalizeTokiVolume(NaN), 30);
  assert.equal(normalizeTokiVolume(Infinity), 30);
});

test('default OFF loads no music; ON issues gesture-time resume/play and gain controls zero to full volume', async (t) => {
  const f = fixture(t); f.controller.start();
  assert.equal(f.created, 0);
  assert.equal(f.controller.getSnapshot().status, 'off');
  f.controller.setEnabled(true);
  assert.equal(f.context.resumes, 1, 'resume must be called before yielding the click handler');
  assert.equal(f.audio.plays, 1, 'play must be called before yielding the click handler');
  assert.equal(f.audio.preload, 'none');
  assert.equal(f.audio.loop, true);
  assert.equal(f.audio.src, '/audio/morning.mp3');
  await flush();
  assert.equal(f.controller.getSnapshot().status, 'playing');
  f.controller.setVolume(0); assert.equal(f.context.gain.value, 0);
  f.controller.setVolume(73); assert.equal(f.context.gain.value, 0.73); assert.equal(f.audio.volume, 1);
  f.controller.setEnabled(true); assert.equal(f.audio.plays, 1); assert.equal(f.created, 1);
  f.controller.setEnabled(false); assert.equal(f.audio.paused, true); assert.equal(f.controller.getSnapshot().status, 'off');
  assert.deepEqual(f.saves.at(-1), { enabled: false, volume: 73 });
});

test('saved ON blocked by autoplay remains honestly blocked and user retry reuses the same audio graph', async (t) => {
  const f = fixture(t, { loadPreferences: () => ({ enabled: true, volume: 45 }) });
  f.audio.playQueue.push(() => Promise.reject(Object.assign(new Error('gesture required'), { name: 'NotAllowedError' })));
  f.controller.start(); await flush();
  assert.equal(f.controller.getSnapshot().enabled, true);
  assert.equal(f.controller.getSnapshot().status, 'blocked');
  assert.equal(f.audio.paused, true);
  f.controller.retry(); await flush();
  assert.equal(f.controller.getSnapshot().status, 'playing');
  assert.equal(f.created, 1); assert.equal(f.context.sources, 1); assert.equal(f.context.gain.value, 0.45);
});

test('hidden state and period boundaries load only the next needed track and preserve a single element', async (t) => {
  const f = fixture(t); f.controller.start(); f.controller.setEnabled(true); await flush();
  f.controller.setVisible(false);
  assert.equal(f.audio.paused, true); assert.equal(f.controller.getSnapshot().status, 'paused');
  f.setTime('2026-11-25T02:00:00Z'); f.controller.syncPeriod();
  assert.equal(f.controller.getSnapshot().period, 'daytime');
  assert.equal(f.audio.src, '/audio/morning.mp3', 'do not fetch a new track while hidden');
  f.controller.setVisible(true); await flush();
  assert.equal(f.audio.src, '/audio/daytime.mp3'); assert.equal(f.audio.plays, 2);
  f.setTime('2026-11-25T09:00:00Z'); f.controller.syncPeriod(); await flush();
  assert.equal(f.audio.src, '/audio/night.mp3'); assert.equal(f.audio.plays, 3);
  assert.equal(f.created, 1); assert.equal(f.context.sources, 1);
  assert.deepEqual(f.themes, ['morning', 'daytime', 'night']);
});

test('turning OFF or hiding during pending resume/play prevents delayed sound from restarting', async (t) => {
  for (const action of ['off', 'hide']) {
    const f = fixture(t); const resume = deferred(); const play = deferred();
    f.context.resumeQueue.push(() => resume.promise); f.audio.playQueue.push(() => play.promise);
    f.controller.start(); f.controller.setEnabled(true);
    if (action === 'off') f.controller.setEnabled(false); else f.controller.setVisible(false);
    play.resolve(); resume.resolve(); await flush();
    assert.equal(f.audio.paused, true, action);
    assert.equal(f.controller.getSnapshot().status, action === 'off' ? 'off' : 'paused');
    assert.equal(f.context.state, 'suspended');
  }
});

test('an old play completion cannot stop a newer period or resurrect an old track', async (t) => {
  const f = fixture(t); const firstPlay = deferred();
  f.audio.playQueue.push(() => firstPlay.promise);
  f.controller.start(); f.controller.setEnabled(true);
  f.setTime('2026-11-25T02:00:00Z'); f.controller.syncPeriod(); await flush();
  assert.equal(f.audio.src, '/audio/daytime.mp3');
  assert.equal(f.controller.getSnapshot().status, 'playing');
  firstPlay.resolve(); await flush();
  assert.equal(f.audio.paused, false);
  assert.equal(f.audio.src, '/audio/daytime.mp3');
  assert.equal(f.controller.getSnapshot().status, 'playing');
  assert.equal(f.created, 1);
});

test('interrupted AudioContext is paused and requires an honest resume instead of false playing status', async (t) => {
  const f = fixture(t); f.controller.start(); f.controller.setEnabled(true); await flush();
  f.context.state = 'interrupted'; f.context.dispatchEvent(new Event('statechange'));
  assert.equal(f.controller.getSnapshot().status, 'blocked'); assert.equal(f.audio.paused, true);
  f.controller.retry(); await flush();
  assert.equal(f.controller.getSnapshot().status, 'playing');
});

test('cleanup invalidates delayed play and never interferes with a replacement provider', async (t) => {
  const old = fixture(t); const pending = deferred(); old.audio.playQueue.push(() => pending.promise);
  old.controller.start(); old.controller.setEnabled(true); old.controller.destroy();
  const replacement = fixture(t); replacement.controller.start(); replacement.controller.setEnabled(true); await flush();
  pending.resolve(); await flush();
  assert.equal(old.audio.paused, true); assert.equal(old.audio.src, '');
  assert.equal(replacement.audio.paused, false); assert.equal(replacement.controller.getSnapshot().status, 'playing');
});

test('storage failure does not prevent user sound controls', async (t) => {
  const f = fixture(t, { loadPreferences: () => { throw new Error('storage unavailable'); }, savePreferences: () => { throw new Error('storage unavailable'); } });
  f.controller.start(); f.controller.setEnabled(true); await flush();
  f.controller.setVolume(0); assert.equal(f.context.gain.value, 0);
  f.controller.setVolume(100); assert.equal(f.context.gain.value, 1);
  f.controller.setEnabled(false); assert.equal(f.audio.paused, true);
});

test('same-track retry reloads a failed media resource, while a delayed old success cannot resurrect it', async (t) => {
  const f = fixture(t); const pending = deferred(); f.audio.playQueue.push(() => pending.promise);
  f.controller.start(); f.controller.setEnabled(true); await flush();
  f.audio.error = { code: 4 }; f.audio.dispatchEvent(new Event('error'));
  assert.equal(f.controller.getSnapshot().status, 'error');
  pending.resolve(); await flush();
  assert.equal(f.audio.paused, true); assert.equal(f.controller.getSnapshot().status, 'error');
  const previousLoads = f.audio.loads.length;
  f.controller.retry(); await flush();
  assert.equal(f.audio.loads.length, previousLoads + 1);
  assert.equal(f.audio.error, null); assert.equal(f.controller.getSnapshot().status, 'playing');
  assert.equal(f.context.sources, 1); assert.equal(f.created, 1);
});

test('old rejected play after OFF then ON cannot cancel the new successful playback', async (t) => {
  const f = fixture(t); const old = deferred(); f.audio.playQueue.push(() => old.promise);
  f.controller.start(); f.controller.setEnabled(true); f.controller.setEnabled(false); f.controller.setEnabled(true); await flush();
  assert.equal(f.controller.getSnapshot().status, 'playing');
  old.reject(Object.assign(new Error('old play was aborted'), { name: 'AbortError' })); await flush();
  assert.equal(f.audio.paused, false); assert.equal(f.controller.getSnapshot().status, 'playing');
  assert.equal(f.created, 1);
});

test('ON immediately after an asynchronous OFF suspension resumes after that suspension finishes', async (t) => {
  const f = fixture(t); f.controller.start(); f.controller.setEnabled(true); await flush();
  const suspension = deferred();
  f.context.suspend = () => { f.context.suspends += 1; return suspension.promise.then(() => { f.context.state = 'suspended'; f.context.dispatchEvent(new Event('statechange')); }); };
  f.controller.setEnabled(false);
  assert.equal(f.context.state, 'running', 'mock models suspend that has not yet completed');
  const resumesBefore = f.context.resumes;
  f.controller.setEnabled(true);
  assert.equal(f.context.resumes, resumesBefore + 1, 'the new ON still calls resume synchronously');
  suspension.resolve(); await flush();
  assert.equal(f.context.state, 'running');
  assert.equal(f.audio.paused, false);
  assert.equal(f.controller.getSnapshot().status, 'playing');
});
