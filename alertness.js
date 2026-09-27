// alertness.js — sleepiness / rest assessment from measurements the app gathers.
// Live signs follow drowsiness research: PERCLOS (share of time the eyes are ≥80% closed),
// blink duration, long blinks, micro-sleeps, yawning, head nodding-off, fixed stare.
// "Did they sleep?" signs follow studies of sleep-deprived faces: hanging eyelids, dark circles,
// red eyes, drooping mouth corners. Everything is an estimate from appearance, not a sleep test.

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const N = (x, s) => clamp(x / s);

export const LEVELS = [
  // [min score, icon, name, advice]
  [85, '⚡', 'Active & energetic', 'Fully awake with plenty of energy. A good time for demanding work.'],
  [72, '🙂', 'Alert & awake', 'Awake and attentive.'],
  [58, '😐', 'A little tired', 'Energy is dipping. A short break, water, daylight or a quick walk will help.'],
  [42, '🥱', 'Sleepy', 'Clearly sleepy. Take a break, and if possible a 10–20 minute nap. Avoid driving.'],
  [25, '😪', 'Very drowsy', 'Very drowsy. Stop any risky activity (driving, machinery) and rest now.'],
  [0, '😴', 'Falling asleep', 'Falling asleep. Eyes are closing for seconds at a time. Rest immediately.'],
];

/**
 * m = {
 *   live, observedSec,              // how much live data backs the reading
 *   perclos,                        // 0..1, eyes ≥80% closed share (last 30–60 s)
 *   meanBlinkMs, longBlinks2m,      // blink duration stats
 *   yawns5m, nodOffs5m, microsleeps5m,
 *   droop,                          // 0..1 sustained upper-lid droop vs this person's own alert baseline
 *   droopKnown,                     // true when a personal baseline exists (calibrated)
 *   stare,                          // 0..1 fixed, glazed gaze
 *   dark, red, mouthDroop,          // appearance: dark circles, red eyes, drooping mouth corners (0..1)
 *   yawningNow, movement, arousal,  // instantaneous: jaw wide open + eyes squeezed; head activity; positive energy
 * }
 */
export function scoreAlertness(m) {
  const reasons = [], restReasons = [];
  const say = (arr, v, text) => { if (v > .25) arr.push(text); };

  // --- "did they sleep well?" appearance (works on a single photo)
  const droopW = m.droopKnown ? 1 : .6; // eye shapes differ; without a personal baseline, trust droop less
  const rest = clamp(.36 * m.droop * droopW + .28 * m.dark + .18 * m.red + .1 * m.mouthDroop
    + (m.live ? .08 * N(m.meanBlinkMs - 170, 250) : 0));
  say(restReasons, m.droop * droopW, m.droopKnown ? `Upper eyelids hanging ${Math.round(m.droop * 35)}% lower than your alert baseline` : 'Upper eyelids look heavy (hooded, half-lowered)');
  say(restReasons, m.dark, 'Darker, shadowed skin under the eyes (dark circles)');
  say(restReasons, m.red, 'Reddish whites of the eyes');
  say(restReasons, m.mouthDroop, 'Mouth corners turned down at rest');

  // --- live drowsiness
  let fatigue;
  if (m.live) {
    const warm = clamp(m.observedSec / 20); // dynamic signs need ~20 s of watching before they count fully
    const dyn = .24 * N(m.perclos - .05, .12) + .2 * N(m.meanBlinkMs - 150, 200) + .1 * N(m.longBlinks2m, 3)
      + .15 * N(m.yawns5m, 2) + .07 * m.stare;
    fatigue = clamp(warm * dyn + .2 * m.droop * droopW + .1 * rest
      + .35 * clamp(m.nodOffs5m) + .45 * clamp(m.microsleeps5m) + .25 * (m.yawningNow ? 1 : 0));
    say(reasons, N(m.perclos - .05, .12), `Eyes closed ${Math.round(m.perclos * 100)}% of the time recently (PERCLOS; alert people stay under ~8%)`);
    say(reasons, N(m.meanBlinkMs - 150, 200), `Slow, heavy blinks (average ${Math.round(m.meanBlinkMs)} ms, alert is ~100–150 ms)`);
    say(reasons, N(m.longBlinks2m, 3), `${m.longBlinks2m} long eye closure${m.longBlinks2m === 1 ? '' : 's'} in the last 2 minutes`);
    say(reasons, N(m.yawns5m, 2), `${m.yawns5m} yawn${m.yawns5m === 1 ? '' : 's'} in the last 5 minutes`);
    say(reasons, m.stare, 'Fixed, glazed stare: eyes barely moving');
    if (m.nodOffs5m) reasons.unshift(`💤 Head dropped forward (nodding off) ${m.nodOffs5m}× recently`);
    if (m.microsleeps5m) reasons.unshift(`😴 Micro-sleep: eyes stayed shut for 2+ seconds ${m.microsleeps5m}× recently`);
  } else {
    fatigue = clamp(.55 * m.droop * droopW + .45 * rest + .3 * (m.yawningNow ? 1 : 0));
  }
  if (m.yawningNow) reasons.unshift('🥱 Yawning right now');
  say(reasons, m.droop * droopW, 'Eyelids drooping');

  let score = Math.round(100 * (1 - fatigue));
  // "energetic" needs positive signs, not just the absence of tiredness
  if (score >= 85 && !(m.arousal > .3 || m.movement > .35)) score = Math.min(score, 84);
  // someone showing signs of sleep loss can be awake, but isn't 'energetic'
  if (rest >= .22) score = Math.min(score, 84);
  const lvl = LEVELS.find(l => score >= l[0]);
  const restVerdict = rest < .22 ? ['😊', 'Looks well-rested'] : rest < .45 ? ['😐', 'Some signs of short or poor sleep'] : ['😵‍💫', 'Looks sleep-deprived'];
  return {
    score, icon: lvl[1], level: lvl[2], advice: lvl[3], rest, restVerdict, restReasons, reasons: [...new Set(reasons)].slice(0, 6),
    measuring: m.live && m.observedSec < 20,
  };
}
