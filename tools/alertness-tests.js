// Alertness / sleep regression. In the browser console on the running app:
//   const { run } = await import('/tools/alertness-tests.js'); await run();
const T = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/', U = 'https://upload.wikimedia.org/wikipedia/commons/';
// rest: 'rested' → "Looks well-rested"; 'tired' → any sign of short sleep
export const PHOTOS = {
  portrait: ['https://storage.googleapis.com/mediapipe-assets/portrait.jpg', 'rested'],
  gates: [U + 'd/d9/Bill_Gates_at_the_European_Commission_-_P067383-987995_%28cropped%29_5.jpg', 'rested'],
  momoa_deepSetEyes: [U + '2/22/Jason_Momoa_%2843055621224%29_%28cropped%29.jpg', 'rested'],
  diljit: [U + 'e/e2/Diljit_Dosanjh.jpg', 'rested'],
  keanu: [U + 'b/b4/Keanu_Reeves_at_TIFF_2025_02_%28Cropped%29.jpg', 'rested'],
  mina: [T + 'f/f1/Twice_mina_with_finger_heart_in_2015.jpg/960px-Twice_mina_with_finger_heart_in_2015.jpg', 'rested'],
  zach: [U + 'e/e7/Zach_Galifianakis_2012_%28cropped%29.jpg', 'rested'],
  stewart: [U + '2/2b/Jon_Stewart_MFF_2016.jpg', 'rested'],
  thumbs: ['https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/thumbs_up.jpg', 'rested'],
  darkCircles: [U + '0/0a/Dark_circles.jpg', 'tired'],
  sleepDeprived: [T + '7/70/Sleep_deprived.jpg/960px-Sleep_deprived.jpg', 'tired'],
};

// Simulated live session: drives the real eye/head/temporal pipeline with synthetic blendshapes.
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // reproducible blink timing
export function session(B, { seconds, blinkEvery, blinkMs, lids, longClosures = [], microsleepAt = null, nodOffAt = null, yawnAt = null }) {
  const S = B.S, keys = Object.keys(S.bs || {}).length ? Object.keys(S.bs) : ['eyeBlinkLeft'];
  const zero = Object.fromEntries(keys.map(k => [k, 0]));
  Object.assign(S, { face: true, calibrated: true, perclos: 0, alertHist: [], yawns: [], longBlinks: [], nodOffs: [], microsleeps: [], lidDroop: 0, gazeHist: [], stressHist: [], timeline: [], lastSample: 0 });
  S.eye = { ...S.eye, state: 'open', ep: null, blinks: [], durs: [], closedHist: [], lastBlinkEnd: -1e9 };
  S.head = { yawEx: null, pitchEx: null, lastNod: -1e9, lastShake: -1e9, tiltOn: 0, hist: [] };
  S.lidRest = null; S.base = { ...zero }; S.pose = { yaw: 0, pitch: 0, roll: 0 }; S.yawn = { since: 0, fired: false };
  const t0 = performance.now() - seconds * 1000; S.camStart = t0;
  let nextBlink = t0 + 1000, closedUntil = 0, pitch = 0;
  for (let t = t0; t < t0 + seconds * 1000; t += 33) {
    const s = (t - t0) / 1000;
    if (t >= nextBlink) { closedUntil = t + blinkMs; nextBlink = t + blinkEvery * 1000 * (.7 + rnd() * .6); }
    for (const [at, ms] of longClosures) if (Math.abs(s - at) < .02) closedUntil = t + ms;
    if (microsleepAt != null && Math.abs(s - microsleepAt) < .02) closedUntil = t + 2600;
    const closed = t < closedUntil;
    const lid = closed ? .95 : lids;
    const yawning = yawnAt != null && s > yawnAt && s < yawnAt + 2.2;
    pitch = nodOffAt != null && s > nodOffAt && s < nodOffAt + .5 ? -(s - nodOffAt) * 40 : nodOffAt != null && s >= nodOffAt + .5 && s < nodOffAt + 1.5 ? -20 : 0;
    S.bs = { ...zero, eyeBlinkLeft: lid, eyeBlinkRight: lid, jawOpen: yawning ? .8 : 0, eyeSquintLeft: yawning ? .5 : 0, eyeSquintRight: yawning ? .5 : 0 };
    S.gaze = { x: Math.sin(s * 1.7) * .15, y: Math.cos(s * 1.3) * .1 };
    S.pose = { yaw: 0, pitch, roll: 0 };
    B.eyeStep(S.bs, t); B.headStep(S.pose, t); B.temporalStep(t);
    if (Math.round(t) % 150 < 33) B.alertStep(t, true);
  }
  B.alertStep(t0 + seconds * 1000, true);
  return { score: S.alert.score, level: S.alert.level, why: S.alert.reasons };
}

export async function run() {
  const B = window.__BHAAV, out = {}; let pass = 0, n = 0; seed = 1;
  for (const [k, [url, want]] of Object.entries(PHOTOS)) {
    const s = await B.analyzePhoto(url); n++;
    const rested = s.alert?.rest === 'Looks well-rested';
    const ok = want === 'rested' ? rested : !rested;
    if (ok) pass++;
    out['photo_' + k] = `${ok ? '✓' : '✗'} ${s.alert?.rest} (alertness ${s.alert?.score}) ${s.alert?.rr.join('; ')}`;
  }
  const alert = session(B, { seconds: 90, blinkEvery: 4, blinkMs: 130, lids: .08 });
  const drowsy = session(B, { seconds: 90, blinkEvery: 3, blinkMs: 420, lids: .4, longClosures: [[30, 1300], [50, 1500], [70, 1200]], microsleepAt: 80, nodOffAt: 84, yawnAt: 40 });
  const tired = session(B, { seconds: 90, blinkEvery: 3.5, blinkMs: 260, lids: .24, longClosures: [[45, 1100]], yawnAt: 60 });
  n += 3;
  const okA = alert.score >= 72, okD = drowsy.score < 42, okT = tired.score >= 40 && tired.score < 72;
  pass += okA + okD + okT;
  out.live_tired = `${okT ? '✓' : '✗'} ${tired.score} ${tired.level} | ${tired.why.join('; ')}`;
  out.live_alert = `${okA ? '✓' : '✗'} ${alert.score} ${alert.level} | ${alert.why.join('; ')}`;
  out.live_drowsy = `${okD ? '✓' : '✗'} ${drowsy.score} ${drowsy.level} | ${drowsy.why.join('; ')}`;
  out.SCORE = `${pass}/${n}`;
  return out;
}
