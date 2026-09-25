// BHAAV — on-device expression, eye-gesture, head-gesture and hand-sign reader.
import { FilesetResolver, FaceLandmarker, GestureRecognizer, DrawingUtils }
  from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const GEST_MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

const $ = s => document.querySelector(s);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const N = (x, s) => clamp(x / s);
const now = () => performance.now();
const store = {
  get(k, d) { try { const v = localStorage.getItem('bhaav.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bhaav.' + k, JSON.stringify(v)); } catch {} },
};

/* ------------------------------------------------------------------ constants */
const EMOTIONS = [
  { k: 'happy', name: 'Happy', icon: '😊' },
  { k: 'sad', name: 'Sad', icon: '😢' },
  { k: 'angry', name: 'Angry', icon: '😠' },
  { k: 'surprised', name: 'Surprised', icon: '😲' },
  { k: 'fear', name: 'Fearful / anxious', icon: '😨' },
  { k: 'disgust', name: 'Disgusted', icon: '🤢' },
  { k: 'contempt', name: 'Contempt / smirk', icon: '😏' },
  { k: 'confused', name: 'Confused', icon: '🤔' },
  { k: 'neutral', name: 'Neutral', icon: '😐' },
];
const EMO = Object.fromEntries(EMOTIONS.map(e => [e.k, e]));
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const EMO_COLOR = Object.fromEntries(EMOTIONS.map(e => [e.k, cssVar('--' + e.k) || '#888']));

// Typical resting blendshape values; replaced by the user's own after calibration.
const DEFAULT_BASE = {
  eyeBlinkLeft: .08, eyeBlinkRight: .08, eyeSquintLeft: .12, eyeSquintRight: .12, eyeLookDownLeft: .12, eyeLookDownRight: .12,
  browDownLeft: .04, browDownRight: .04, mouthShrugLower: .12, mouthShrugUpper: .12, mouthRollLower: .04, mouthRollUpper: .03,
  mouthPressLeft: .08, mouthPressRight: .08, mouthClose: .03, cheekSquintLeft: .03, cheekSquintRight: .03,
};

const HAND_SIGNS = {
  Thumb_Up: '👍 Thumbs up', Thumb_Down: '👎 Thumbs down', Closed_Fist: '✊ Fist', Open_Palm: '🖐 Open palm',
  Pointing_Up: '☝️ Point up', Point: '👉 Pointing', Victory: '✌️ Victory', ILoveYou: '🤟 I love you', OK: '👌 OK',
  Call_Me: '🤙 Call me', Rock: '🤘 Rock on', Three: '3️⃣ Three', Four: '4️⃣ Four', L_Shape: '🫲 L-shape', Pinky: '🤙 Pinky', Pinch: '🤏 Pinch',
};
const EYE_HEAD = {
  Nod: '↕ Head nod', Shake: '↔ Head shake', Long_Blink: '😌 Long blink (1 s)', Double_Blink: '👀 Double blink',
  Wink_Left: '😉 Wink (your left)', Wink_Right: '😉 Wink (your right)', Tilt_Left: '↖ Head tilt left', Tilt_Right: '↗ Head tilt right',
  Look_Up: '⬆ Look up (hold)', Yawn: '🥱 Yawn',
};
const DEFAULT_MAP = {
  Thumb_Up: 'Yes', Thumb_Down: 'No', Closed_Fist: 'I need help', Open_Palm: 'Hello', Pointing_Up: 'Wait, please',
  Point: 'That one', Victory: 'Thank you', ILoveYou: 'I love you', OK: "I'm okay", Call_Me: 'Please call my family',
  Rock: 'That is great', Three: 'I want water', Four: 'I am hungry', L_Shape: 'I need the bathroom', Pinky: 'I am in pain', Pinch: 'A little',
  Nod: 'Yes', Shake: 'No', Long_Blink: '[speak]', Double_Blink: '', Wink_Left: '', Wink_Right: '[undo]',
  Tilt_Left: '', Tilt_Right: '', Look_Up: '', Yawn: '',
};
const QUICK = ['Yes', 'No', 'Hello', 'Thank you', 'Please', 'I need help', 'I am in pain', 'I want water', 'I am hungry',
  'I need the bathroom', 'I am tired', 'I feel cold', 'I feel hot', 'Call my family', 'I am okay', 'Wait, please'];

/* ------------------------------------------------------------------ state */
const S = {
  running: false, mode: 'none', lastT: 0, fps: 0, lastVT: -1,
  base: { ...DEFAULT_BASE }, pose0: { yaw: 0, pitch: 0, roll: 0 }, gaze0: { x: 0, y: 0 }, calibrated: false,
  calib: null,
  bs: null, face: false, pose: null, gaze: { x: 0, y: 0 }, open: { L: 1, R: 1 },
  emo: Object.fromEntries(EMOTIONS.map(e => [e.k, e.k === 'neutral' ? 1 : 0])), emoTop: 'neutral', emoAnnounced: 'neutral', emoSince: 0,
  timeline: [], lastSample: 0, sessionCounts: {}, stressHist: [],
  eye: { state: 'open', ep: null, blinks: [], lastBlinkEnd: -1e9, blinkTotal: 0, lastBlinkDur: 0, gazeDir: 'center', gazeSince: 0, gazeFired: false, closedHist: [], wideOn: false, squintOn: false },
  head: { yawEx: null, pitchEx: null, lastNod: -1e9, lastShake: -1e9, tiltOn: 0, hist: [] },
  yawn: { since: 0, fired: false }, yawns: [], longBlinks: [],
  hands: [], hold: { label: null, since: 0, fired: false, handSeen: 0 },
  sentence: [], map: { ...DEFAULT_MAP, ...store.get('map', {}) }, custom: store.get('custom', []),
  rec: null, events: [], stress: 0, drowsy: 0, attn: 0,
  set: { hold: store.get('hold', 900), strict: store.get('strict', 0.9), rate: store.get('rate', 0.95), voice: store.get('voice', ''),
         typing: true, eyeCmd: true, auto: false, mesh: true, handsDraw: true, mirror: true },
};

/* ------------------------------------------------------------------ models */
let fileset, faceV, gestV, faceI, gestI;
async function loadVideoModels() {
  if (faceV) return;
  pill('models: loading…', 'warn');
  fileset = fileset || await FilesetResolver.forVisionTasks(WASM);
  const make = async delegate => {
    faceV = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate }, runningMode: 'VIDEO', numFaces: 1,
      outputFaceBlendshapes: true, minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5, minTrackingConfidence: .5,
    });
    gestV = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: GEST_MODEL, delegate }, runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5,
    });
  };
  try { await make('GPU'); } catch (e) { console.warn('GPU delegate failed, using CPU', e); await make('CPU'); }
  pill('models: ready', 'ok');
}
async function loadImageModels() {
  if (faceI) return;
  pill('models: loading…', 'warn');
  fileset = fileset || await FilesetResolver.forVisionTasks(WASM);
  faceI = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1, outputFaceBlendshapes: true });
  gestI = await GestureRecognizer.createFromOptions(fileset, { baseOptions: { modelAssetPath: GEST_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', numHands: 2 });
  pill('models: ready', 'ok');
}
function pill(t, cls) { const p = $('#modelPill'); p.textContent = t; p.className = 'pill ' + (cls || ''); }

/* ------------------------------------------------------------------ camera */
const video = $('#video'), overlay = $('#overlay'), photo = $('#photo'), stage = $('#stage');
const octx = overlay.getContext('2d'), draw = new DrawingUtils(octx);
let stream = null;

async function startCamera(deviceId) {
  const empty = $('#empty');
  empty.querySelector('p').innerHTML = '<span class="spin"></span> Loading face & hand models (about 12 MB, first time only)…';
  try {
    await loadVideoModels();
    stopStream();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) {
    console.error(e);
    empty.querySelector('p').innerHTML = `<b style="color:var(--rose)">Couldn't start: ${e.name || ''}</b><br>${e.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow it in the address bar and try again.' : (e.message || e)}`;
    return;
  }
  video.srcObject = stream;
  await video.play();
  sizeTo(video.videoWidth, video.videoHeight);
  S.mode = 'camera'; S.running = true; S.lastVT = -1; S.camStart = S.camStart || now();
  stage.classList.remove('photo'); stage.classList.toggle('mirror', S.set.mirror);
  empty.style.display = 'none'; $('#bigemo').style.display = 'flex';
  $('#camBtn').style.display = ''; $('#photoBtn2').style.display = '';
  fillCameraList();
  if (!S.calibrated) startCalibration();
  requestAnimationFrame(loop);
}
function stopStream() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; }
function stopCamera() {
  S.running = false; stopStream(); video.srcObject = null;
  octx.clearRect(0, 0, overlay.width, overlay.height);
  $('#camBtn').style.display = 'none';
  const empty = $('#empty'); empty.style.display = 'flex';
  empty.querySelector('p').innerHTML = 'Camera stopped. Start it again whenever you like.';
}
async function fillCameraList() {
  const sel = $('#camSel');
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    if (cams.length < 2) { sel.style.display = 'none'; return; }
    const cur = stream?.getVideoTracks()[0]?.getSettings().deviceId;
    sel.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}" ${c.deviceId === cur ? 'selected' : ''}>${c.label || 'Camera ' + (i + 1)}</option>`).join('');
    sel.style.display = '';
  } catch {}
}
function sizeTo(w, h) {
  overlay.width = w; overlay.height = h;
  stage.style.aspectRatio = `${w} / ${h}`;
}

function loop() {
  if (!S.running) return;
  requestAnimationFrame(loop);
  if (video.readyState < 2 || video.currentTime === S.lastVT) return;
  S.lastVT = video.currentTime;
  if (overlay.width !== video.videoWidth) sizeTo(video.videoWidth, video.videoHeight);
  const t = now();
  const fr = faceV.detectForVideo(video, t);
  const gr = gestV.recognizeForVideo(video, t);
  frame(fr, gr, t, true);
}

/* ------------------------------------------------------------------ photo */
async function analyzePhoto(src) {
  const img = new Image(); img.crossOrigin = 'anonymous';
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not load image')); img.src = src; });
  $('#empty').querySelector('p').innerHTML = '<span class="spin"></span> Loading models…';
  await loadImageModels();
  if (S.running) stopCamera();
  photo.width = img.naturalWidth; photo.height = img.naturalHeight;
  photo.getContext('2d').drawImage(img, 0, 0);
  sizeTo(img.naturalWidth, img.naturalHeight);
  S.mode = 'photo';
  stage.classList.add('photo'); stage.classList.remove('mirror');
  $('#empty').style.display = 'none'; $('#bigemo').style.display = 'flex'; $('#photoBtn2').style.display = '';
  const fr = faceI.detect(img), gr = gestI.recognize(img);
  frame(fr, gr, now(), false);
  return summary();
}

/* ------------------------------------------------------------------ per-frame pipeline */
function frame(fr, gr, t, live) {
  const dt = S.lastT ? clamp(t - S.lastT, 1, 250) : 33;
  S.lastT = t; S.fps = S.fps * .9 + (1000 / dt) * .1;
  const face = fr.faceBlendshapes?.length ? {
    bs: Object.fromEntries(fr.faceBlendshapes[0].categories.map(c => [c.categoryName, c.score])),
    lm: fr.faceLandmarks[0],
  } : null;
  const hands = (gr.landmarks || []).map((lm, i) => ({
    lm, wlm: gr.worldLandmarks[i],
    // MediaPipe labels handedness assuming a mirrored selfie image; raw webcam frames are not mirrored.
    side: (gr.handedness?.[i]?.[0]?.categoryName === 'Left') ? 'Right' : 'Left',
    model: gr.gestures?.[i]?.[0] || { categoryName: 'None', score: 0 },
  }));
  analyzeFace(face, t, dt, live);
  analyzeHands(hands, t, live);
  render(face, hands);
  if (!live || t - (S.lastUI || 0) > 80) { S.lastUI = t; updateUI(t); }
}

/* ------------------------------------------------------------------ face analysis */
function headPose(lm, W, H) {
  const P = i => ({ x: lm[i].x * W, y: lm[i].y * H, z: lm[i].z * W });
  const a = P(234), b = P(454), top = P(10), chin = P(152), eL = P(33), eR = P(263);
  // + yaw = turned toward the person's own left, + pitch = looking up, + roll = tilted toward own left shoulder
  const yaw = Math.atan2(b.z - a.z, b.x - a.x) * 180 / Math.PI;
  const pitch = Math.atan2(top.z - chin.z, chin.y - top.y) * 180 / Math.PI;
  const roll = Math.atan2(eR.y - eL.y, eR.x - eL.x) * 180 / Math.PI;
  return { yaw, pitch, roll };
}
function gazeOf(bs) {
  // + x = looking toward the person's own left, + y = looking up
  return {
    x: ((bs.eyeLookOutLeft + bs.eyeLookInRight) - (bs.eyeLookInLeft + bs.eyeLookOutRight)) / 2,
    y: ((bs.eyeLookUpLeft + bs.eyeLookUpRight) - (bs.eyeLookDownLeft + bs.eyeLookDownRight)) / 2,
  };
}
const act = k => clamp(((S.bs?.[k] ?? 0) - (S.base[k] ?? .02)) / (1 - (S.base[k] ?? .02)));
const act2 = k => (act(k + 'Left') + act(k + 'Right')) / 2;

function emotionScores() {
  const sm = N(act2('mouthSmile'), .6), fr = N(act2('mouthFrown'), .35), bd = N(act2('browDown'), .45), bi = N(act('browInnerUp'), .5),
    bo = N(act2('browOuterUp'), .45), wide = N(act2('eyeWide'), .35), jaw = N(act('jawOpen'), .5), str = N(act2('mouthStretch'), .35),
    press = N(act2('mouthPress'), .4), sneer = N(act2('noseSneer'), .35), up = N(act2('mouthUpperUp'), .4), shrug = N(act('mouthShrugLower'), .4),
    chk = N(act2('cheekSquint'), .4), sq = N(act2('eyeSquint'), .5);
  const smileAsym = N(Math.abs(act('mouthSmileLeft') - act('mouthSmileRight')), .3);
  const dimpleAsym = N(Math.abs(act('mouthDimpleLeft') - act('mouthDimpleRight')), .3);
  const browAsym = N(Math.abs(act('browOuterUpLeft') - act('browOuterUpRight')) + Math.abs(act('browDownLeft') - act('browDownRight')), .35);
  const e = {
    happy: clamp(sm * .9 + chk * .25),
    sad: clamp(fr * .6 + bi * .35 * (1 - bo) + shrug * .3 - sm * .8),
    angry: clamp(bd * .75 + press * .2 + sneer * .2 + sq * .15 - sm * .6 - bi * .2),
    surprised: clamp((bi + bo) / 2 * .55 + wide * .35 + jaw * .45 - bd * .5 - sm * .3),
    fear: clamp(bi * .4 + wide * .4 + str * .55 + bd * .1 - sm * .6 - jaw * .15),
    disgust: clamp(sneer * .65 + up * .45 - sm * .4),
    contempt: clamp(smileAsym * .7 * (1 - sm * .8) + dimpleAsym * .3),
    confused: clamp(browAsym * .6 + bd * bi * .8 + N(act('mouthLeft') + act('mouthRight'), .4) * .2 - sm * .5),
  };
  e.neutral = clamp(1 - Math.max(...Object.values(e)) * 1.6);
  let sum = 0;
  for (const k in e) { e[k] = Math.pow(e[k] + .002, 1.6); sum += e[k]; }
  for (const k in e) e[k] /= sum;
  return e;
}

const FACE_ACTIONS = [
  ['Smile', '😊', () => act2('mouthSmile'), .35],
  ['Big grin', '😁', () => Math.min(act2('mouthSmile'), act('jawOpen') * 2), .3],
  ['Smirk', '😏', () => Math.abs(act('mouthSmileLeft') - act('mouthSmileRight')) * 2, .5],
  ['Frown', '☹️', () => act2('mouthFrown') * 1.6, .45],
  ['Brows raised', '🤨', () => Math.max(act('browInnerUp'), act2('browOuterUp')), .35],
  ['One brow up', '🧐', () => Math.abs(act('browOuterUpLeft') - act('browOuterUpRight')) * 1.8, .45],
  ['Brows furrowed', '😣', () => act2('browDown') * 1.4, .4],
  ['Mouth open', '😮', () => act('jawOpen'), .25],
  ['"O" lips', '😯', () => act('mouthFunnel') * 1.5, .4],
  ['Pucker / kiss', '😗', () => act('mouthPucker'), .5],
  ['Lips pressed', '😬', () => act2('mouthPress') * 1.5, .45],
  ['Lip bite / roll', '🫦', () => Math.max(act('mouthRollLower'), act('mouthRollUpper')) * 1.4, .45],
  ['Chin raised', '🥺', () => act('mouthShrugLower') * 1.4, .45],
  ['Cheeks puffed', '🐡', () => act('cheekPuff') * 1.5, .35],
  ['Nose wrinkle', '😖', () => act2('noseSneer') * 1.6, .4],
  ['Upper lip raised', '😒', () => act2('mouthUpperUp') * 1.4, .45],
  ['Lips stretched', '😬', () => act2('mouthStretch') * 1.8, .4],
  ['Jaw sideways', '😜', () => Math.max(act('jawLeft'), act('jawRight')) * 2, .35],
  ['Mouth sideways', '🫤', () => Math.max(act('mouthLeft'), act('mouthRight')) * 2, .4],
  ['Eyes wide', '😳', () => act2('eyeWide') * 1.6, .4],
  ['Squinting', '😑', () => act2('eyeSquint') * 1.3, .45],
  ['Eyes closed', '😌', () => act2('eyeBlink'), .55],
];

function analyzeFace(face, t, dt, live) {
  S.face = !!face;
  if (!face) { S.bs = null; if (S.hold.label == null) {} return; }
  S.bs = face.bs;
  const W = overlay.width, H = overlay.height;
  const rawPose = headPose(face.lm, W, H), rawGaze = gazeOf(face.bs);

  if (S.calib) {
    S.calib.samples.push({ bs: face.bs, pose: rawPose, gaze: rawGaze });
    if (S.calib.samples.length >= 45) finishCalibration();
  }
  S.pose = { yaw: rawPose.yaw - S.pose0.yaw, pitch: rawPose.pitch - S.pose0.pitch, roll: rawPose.roll - S.pose0.roll };
  S.gaze = { x: rawGaze.x - S.gaze0.x, y: rawGaze.y - S.gaze0.y };
  S.open = { L: 1 - act('eyeBlinkLeft'), R: 1 - act('eyeBlinkRight') };

  const e = emotionScores();
  if (!live) { S.emo = e; }
  else { const a = 1 - Math.exp(-dt / 220); for (const k in e) S.emo[k] += a * (e[k] - S.emo[k]); }
  const top = Object.entries(S.emo).sort((x, y) => y[1] - x[1])[0][0];
  if (top !== S.emoTop) { S.emoTop = top; S.emoSince = t; }
  if (live && top !== S.emoAnnounced && t - S.emoSince > 1200) {
    S.emoAnnounced = top;
    log('emo', `${EMO[top].icon} Expression changed to ${EMO[top].name.toLowerCase()}`);
  }
  if (!live) return;

  eyeStep(face.bs, t);
  headStep(S.pose, t);
  temporalStep(t);
}

/* ---- eyes: blink / double / long blink / wink / gaze holds */
function eyeStep(bs, t) {
  const E = S.eye;
  const bL = act('eyeBlinkLeft'), bR = act('eyeBlinkRight');
  const CLOSE = .5, OPEN = .32;
  let st;
  if (bL > CLOSE && bR > CLOSE) st = 'closed';
  else if (bL > CLOSE && bR < OPEN && bL - bR > .35) st = 'winkL';
  else if (bR > CLOSE && bL < OPEN && bR - bL > .35) st = 'winkR';
  else if (bL < OPEN && bR < OPEN) st = 'open';
  else st = E.state; // hysteresis band
  if (st !== 'open' && !E.ep) E.ep = { start: t, both: false, L: false, R: false };
  if (E.ep) { if (st === 'closed') E.ep.both = true; if (st === 'winkL') E.ep.L = true; if (st === 'winkR') E.ep.R = true; }
  if (st === 'open' && E.ep) {
    const dur = t - E.ep.start, ep = E.ep; E.ep = null;
    if (ep.both && dur >= 50) {
      E.blinkTotal++; E.blinks.push(t); E.lastBlinkDur = dur;
      if (dur >= 1000) { fire('Long_Blink', t); S.longBlinks.push(t); }
      else if (dur < 600) {
        if (t - E.lastBlinkEnd < 650) { fire('Double_Blink', t); E.lastBlinkEnd = -1e9; }
        else E.lastBlinkEnd = t;
      }
    } else if (!ep.both && dur >= 140 && dur <= 2500) {
      if (ep.L && !ep.R) fire('Wink_Left', t);
      else if (ep.R && !ep.L) fire('Wink_Right', t);
    }
  }
  E.state = st;
  E.closedHist.push([t, (bL + bR) / 2 > .65 ? 1 : 0]);
  while (E.closedHist.length && t - E.closedHist[0][0] > 30000) E.closedHist.shift();
  while (E.blinks.length && t - E.blinks[0] > 60000) E.blinks.shift();

  // gaze direction held ≥ 500 ms (ignored while the lids are closing)
  const g = S.gaze;
  let dir = 'center';
  if ((bL + bR) / 2 < .4) {
    if (g.x > .28) dir = 'left'; else if (g.x < -.28) dir = 'right';
    else if (g.y > .22) dir = 'up'; else if (g.y < -.3) dir = 'down';
  } else dir = E.gazeDir;
  if (dir !== E.gazeDir) { E.gazeDir = dir; E.gazeSince = t; E.gazeFired = false; }
  else if (dir !== 'center' && !E.gazeFired && t - E.gazeSince > 500) {
    E.gazeFired = true;
    if (dir === 'up') fire('Look_Up', t); else log('eye', `👁 Looking ${dir === 'left' || dir === 'right' ? 'to your ' + dir : dir}`);
  }
  const wide = act2('eyeWide') > .3, sq = act2('eyeSquint') > .45;
  if (wide && !E.wideOn) log('eye', '😳 Eyes widened'); E.wideOn = wide;
  if (sq && !E.squintOn && (bL + bR) / 2 < .4) log('eye', '😑 Squinting'); E.squintOn = sq;
}

/* ---- head: nod / shake via direction reversals, tilt */
function reversalTracker(tr, v, t, hyst) {
  if (!tr) return { ext: v, dir: 0, revs: [] };
  if (tr.dir === 0) { // first clear movement only sets the direction
    if (Math.abs(v - tr.ext) > hyst) { tr.dir = Math.sign(v - tr.ext); tr.ext = v; }
  } else if (tr.dir > 0) {
    if (v > tr.ext) tr.ext = v; else if (v < tr.ext - hyst) { tr.revs.push({ t }); tr.dir = -1; tr.ext = v; }
  } else {
    if (v < tr.ext) tr.ext = v; else if (v > tr.ext + hyst) { tr.revs.push({ t }); tr.dir = 1; tr.ext = v; }
  }
  tr.revs = tr.revs.filter(r => t - r.t < 1400);
  return tr;
}
function headStep(p, t) {
  const Hd = S.head;
  Hd.hist.push({ t, ...p });
  while (Hd.hist.length && t - Hd.hist[0].t > 1400) Hd.hist.shift();
  Hd.pitchEx = reversalTracker(Hd.pitchEx, p.pitch, t, 5);
  Hd.yawEx = reversalTracker(Hd.yawEx, p.yaw, t, 7);
  const range = k => { const v = Hd.hist.map(h => h[k]); return Math.max(...v) - Math.min(...v); };
  if (Hd.pitchEx.revs.length >= 2 && t - Hd.lastNod > 1500 && range('pitch') > range('yaw') * 1.3 && range('pitch') > 8) {
    Hd.lastNod = t; Hd.pitchEx.revs = []; fire('Nod', t);
  }
  if (Hd.yawEx.revs.length >= 2 && t - Hd.lastShake > 1500 && range('yaw') > range('pitch') * 1.3 && range('yaw') > 12) {
    Hd.lastShake = t; Hd.yawEx.revs = []; fire('Shake', t);
  }
  const tilt = p.roll > 16 ? 1 : p.roll < -16 ? -1 : 0;
  if (tilt !== Hd.tiltOn) { Hd.tiltOn = tilt; if (tilt) fire(tilt > 0 ? 'Tilt_Left' : 'Tilt_Right', t); }
}

/* ---- rolling indicators: stress, tiredness, attention, timeline */
function temporalStep(t) {
  const jaw = act('jawOpen');
  if (jaw > .55) { if (!S.yawn.since) S.yawn.since = t; if (!S.yawn.fired && t - S.yawn.since > 1500) { S.yawn.fired = true; S.yawns.push(t); fire('Yawn', t); } }
  else { S.yawn.since = 0; S.yawn.fired = false; }
  if (t - S.lastSample < 200) return;
  const prev = S.stressHist[S.stressHist.length - 1];
  const dA = prev ? Math.hypot(S.pose.yaw - prev.yaw, S.pose.pitch - prev.pitch) / ((t - prev.t) / 1000) : 0;
  S.stressHist.push({ t, fear: S.emo.fear, press: (act2('mouthPress') + act('mouthRollLower')) / 2, bi: act('browInnerUp'),
    yaw: S.pose.yaw, pitch: S.pose.pitch, speed: dA, gaze: S.eye.gazeDir, face: 1,
    facing: Math.abs(S.pose.yaw) < 20 && Math.abs(S.pose.pitch) < 20 ? 1 : 0 });
  while (S.stressHist.length && t - S.stressHist[0].t > 20000) S.stressHist.shift();
  S.lastSample = t;
  S.timeline.push({ t, ...S.emo });
  while (S.timeline.length && t - S.timeline[0].t > 60000) S.timeline.shift();
  S.sessionCounts[S.emoTop] = (S.sessionCounts[S.emoTop] || 0) + 1;
  S.csv = S.csv || [];
  S.csv.push([new Date().toISOString(), S.emoTop, ...EMOTIONS.map(e => S.emo[e.k].toFixed(3)), S.pose.yaw.toFixed(1), S.pose.pitch.toFixed(1), S.pose.roll.toFixed(1), S.eye.gazeDir, blinkRate().toFixed(1), Math.round(S.stress)]);
  computeIndicators(t);
}
function blinkRate() {
  const B = S.eye.blinks; if (!S.camStart) return 0;
  const span = Math.min(60, (now() - S.camStart) / 1000);
  return span < 8 ? 0 : B.length * 60 / span;
}
function computeIndicators(t) {
  const H = S.stressHist; if (!H.length) return;
  const avg = k => H.reduce((s, h) => s + h[k], 0) / H.length;
  let shifts = 0; for (let i = 1; i < H.length; i++) if (H[i].gaze !== H[i - 1].gaze && H[i].gaze !== 'center') shifts++;
  const span = Math.max(4, (H[H.length - 1].t - H[0].t) / 1000);
  const comp = {
    'Fear-like face': N(avg('fear'), .35),
    'Fast blinking': N(blinkRate() - 16, 24),
    'Lip press / bite': N(avg('press'), .35),
    'Worried brows': N(avg('bi'), .4),
    'Fidgety head': N(avg('speed') - 4, 30),
    'Darting eyes': N(shifts * 60 / span - 8, 40),
  };
  const w = { 'Fear-like face': .32, 'Fast blinking': .2, 'Lip press / bite': .15, 'Worried brows': .11, 'Fidgety head': .11, 'Darting eyes': .11 };
  S.stressComp = comp;
  S.stress = 100 * Object.keys(w).reduce((s, k) => s + w[k] * comp[k], 0);
  const cl = S.eye.closedHist, perclos = cl.length ? cl.reduce((s, c) => s + c[1], 0) / cl.length : 0;
  const recentY = S.yawns.filter(y => t - y < 120000).length, recentL = S.longBlinks.filter(y => t - y < 120000).length;
  S.perclos = perclos;
  S.drowsy = 100 * clamp(N(perclos, .2) * .6 + recentY * .15 + recentL * .08);
  S.attn = 100 * avg('facing');
}

/* ------------------------------------------------------------------ hand analysis */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function straightness(w, a, b, c) { // cosine between segments a→b and b→c
  const u = { x: w[b].x - w[a].x, y: w[b].y - w[a].y, z: w[b].z - w[a].z }, v = { x: w[c].x - w[b].x, y: w[c].y - w[b].y, z: w[c].z - w[b].z };
  return (u.x * v.x + u.y * v.y + u.z * v.z) / (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z) + 1e-9);
}
function fingerStates(w) {
  const palm = dist(w[0], w[9]);
  const fing = (mcp, pip, dip, tip) => straightness(w, mcp, pip, dip) > .55 && straightness(w, pip, dip, tip) > .4 && dist(w[0], w[tip]) > dist(w[0], w[pip]) * 1.1;
  const thumb = straightness(w, 2, 3, 4) > .7 && dist(w[4], w[5]) > palm * .55 && dist(w[4], w[9]) > palm * .7;
  return { T: thumb, I: fing(5, 6, 7, 8), M: fing(9, 10, 11, 12), R: fing(13, 14, 15, 16), P: fing(17, 18, 19, 20), palm };
}
function shapeGesture(w, lm, f) {
  const pinch = dist(w[4], w[8]) < f.palm * .35;
  if (pinch && f.M && f.R && f.P) return 'OK';
  const code = [f.T, f.I, f.M, f.R, f.P].map(Number).join('');
  if (pinch && !f.M && !f.R && !f.P) return 'Pinch';
  const up = lm[4].y < lm[2].y - .04, down = lm[4].y > lm[2].y + .04;
  switch (code) {
    case '00000': return 'Closed_Fist';
    case '11111': return 'Open_Palm';
    case '01111': return 'Four';
    case '01110': case '11100': return 'Three';
    case '01100': return 'Victory';
    case '01000': return lm[8].y < lm[5].y - .05 && Math.abs(lm[8].x - lm[5].x) < Math.abs(lm[8].y - lm[5].y) ? 'Pointing_Up' : 'Point';
    case '11000': return 'L_Shape';
    case '10001': return 'Call_Me';
    case '01001': return 'Rock';
    case '11001': return 'ILoveYou';
    case '00001': return 'Pinky';
    case '10000': return up ? 'Thumb_Up' : down ? 'Thumb_Down' : null;
  }
  return null;
}
function handFeature(w, side) {
  const palm = dist(w[0], w[9]) || 1, flip = side === 'Left' ? -1 : 1, out = [];
  for (let i = 1; i < 21; i++) out.push(flip * (w[i].x - w[0].x) / palm, (w[i].y - w[0].y) / palm, (w[i].z - w[0].z) / palm);
  return out;
}
function matchCustom(feat) {
  if (!S.custom.length) return null;
  const all = [];
  for (const c of S.custom) for (const s of c.samples) {
    let d = 0; for (let i = 0; i < feat.length; i++) d += (feat[i] - s[i]) ** 2;
    all.push({ c, d: Math.sqrt(d / feat.length) * 6 });
  }
  all.sort((a, b) => a.d - b.d);
  const k = all.slice(0, 5), votes = {};
  for (const n of k) votes[n.c.id] = (votes[n.c.id] || 0) + 1;
  const win = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  const best = k.find(n => n.c.id === win);
  return best.d < S.set.strict ? { c: best.c, d: best.d } : null;
}
function classifyHand(h) {
  const f = fingerStates(h.wlm);
  const feat = handFeature(h.wlm, h.side);
  const cm = matchCustom(feat);
  let label = null, src = '', conf = 0;
  if (cm) { label = 'custom:' + cm.c.id; src = 'your sign'; conf = clamp(1 - cm.d / S.set.strict * .6); }
  else if (h.model.categoryName !== 'None' && h.model.score > .55) { label = h.model.categoryName; src = 'model'; conf = h.model.score; }
  else { const s = shapeGesture(h.wlm, h.lm, f); if (s) { label = s; src = 'hand shape'; conf = .7; } }
  return { ...h, f, feat, label, src, conf, count: [f.T, f.I, f.M, f.R, f.P].filter(Boolean).length };
}
const labelName = l => l?.startsWith('custom:') ? '✋ ' + (S.custom.find(c => 'custom:' + c.id === l)?.name || 'custom') : (HAND_SIGNS[l] || l || '—');

function analyzeHands(hands, t, live) {
  S.hands = hands.map(classifyHand);
  if (S.rec && S.hands.length) {
    if (t > S.rec.start) S.rec.samples.push(S.hands[0].feat);
    if (t > S.rec.start + 3000) finishRecording();
  }
  if (!live) return;
  const H = S.hold, primary = S.hands.find(h => h.label);
  const label = primary?.label || null;
  if (S.hands.length) H.handSeen = t;
  if (label !== H.label) {
    // brief tracking dropouts shouldn't reset a hold
    if (!label && t - H.lastLabelT < 250) return;
    H.label = label; H.since = t; H.fired = false;
  }
  if (label) H.lastLabelT = t;
  H.progress = label && !H.fired ? clamp((t - H.since) / S.set.hold) : 0;
  if (label && !H.fired && t - H.since >= S.set.hold) { H.fired = true; fire(label, t); }
}

/* ------------------------------------------------------------------ triggers → words */
function fire(trigger, t) {
  const isHand = trigger in HAND_SIGNS || trigger.startsWith('custom:');
  let phrase = '', name;
  if (trigger.startsWith('custom:')) { const c = S.custom.find(c => 'custom:' + c.id === trigger); phrase = c?.phrase || ''; name = '✋ ' + (c?.name || 'custom sign'); }
  else { phrase = S.map[trigger] || ''; name = HAND_SIGNS[trigger] || EYE_HEAD[trigger] || trigger; }
  const cls = isHand ? 'hand' : /Nod|Shake|Tilt/.test(trigger) ? 'head' : trigger === 'Yawn' ? 'emo' : 'eye';
  const enabled = isHand ? S.set.typing : S.set.eyeCmd;
  log(cls, name + (phrase && enabled ? ` → “${phrase}”` : ''));
  if (!phrase || !enabled) return;
  if (phrase === '[speak]') return speakSentence();
  if (phrase === '[undo]') { S.sentence.pop(); return renderSentence(); }
  if (phrase === '[clear]') { S.sentence = []; return renderSentence(); }
  addWord(phrase);
}
function addWord(w) {
  S.sentence.push(w); renderSentence(); toast(w);
  if (S.set.auto) speak(w);
}
function renderSentence() {
  const el = $('#sentence');
  el.innerHTML = S.sentence.length ? S.sentence.map(w => `<span class="word">${esc(w)}</span>`).join('') : '<span class="ph">Sentence is empty.</span>';
}
function speakSentence() {
  if (!S.sentence.length) return;
  const text = S.sentence.join('. ').replace(/\.\./g, '.');
  speak(text); log('say', '🔊 Spoke: “' + text + '”');
}
let voices = [];
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = voices.find(v => v.voiceURI === S.set.voice); if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = S.set.rate;
  speechSynthesis.speak(u);
}
function sos() {
  addWord('HELP! I need help now');
  speak('Help! I need help now. Please help me.');
  try {
    const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.connect(g); g.connect(ac.destination); g.gain.value = .08;
    for (let i = 0; i < 6; i++) o.frequency.setValueAtTime(i % 2 ? 660 : 880, ac.currentTime + i * .25);
    o.start(); o.stop(ac.currentTime + 1.5);
  } catch {}
}

/* ------------------------------------------------------------------ calibration & custom signs */
function startCalibration() {
  if (S.mode !== 'camera') { toast('Start the camera first'); return; }
  S.calib = { samples: [] }; $('#calibMsg').classList.add('show');
}
function finishCalibration() {
  const sm = S.calib.samples; S.calib = null; $('#calibMsg').classList.remove('show');
  const med = arr => { const a = [...arr].sort((x, y) => x - y); return a[a.length >> 1]; };
  const base = {};
  for (const k in sm[0].bs) base[k] = clamp(med(sm.map(s => s.bs[k])), 0, .6);
  S.base = base;
  S.pose0 = { yaw: med(sm.map(s => s.pose.yaw)), pitch: med(sm.map(s => s.pose.pitch)), roll: med(sm.map(s => s.pose.roll)) };
  S.gaze0 = { x: med(sm.map(s => s.gaze.x)), y: med(sm.map(s => s.gaze.y)) };
  S.calibrated = true; S.camStart = S.camStart || now();
  S.emo = Object.fromEntries(EMOTIONS.map(e => [e.k, e.k === 'neutral' ? 1 : 0]));
  toast('Calibrated ✓'); log('emo', '◎ Neutral face calibrated');
}
function startRecording() {
  const name = $('#tName').value.trim(), phrase = $('#tPhrase').value.trim() || name;
  if (!name) { $('#tStatus').textContent = 'Give the sign a name first.'; return; }
  if (S.mode !== 'camera') { $('#tStatus').textContent = 'Start the camera first.'; return; }
  S.rec = { name, phrase, samples: [], start: now() + 1200 };
  $('#tStatus').textContent = 'Get ready… recording starts in 1 s. Hold the sign and move it slightly.';
  $('#tRec').disabled = true;
}
function finishRecording() {
  const r = S.rec; S.rec = null; $('#tRec').disabled = false;
  if (r.samples.length < 15) { $('#tStatus').textContent = `Only caught ${r.samples.length} frames with a hand. Keep your hand in view and try again.`; return; }
  const samples = r.samples.filter((_, i) => i % 2 === 0).slice(0, 60).map(s => s.map(v => +v.toFixed(3)));
  const existing = S.custom.find(c => c.name.toLowerCase() === r.name.toLowerCase());
  if (existing) { existing.samples.push(...samples); existing.samples = existing.samples.slice(-150); existing.phrase = r.phrase; }
  else S.custom.push({ id: Date.now().toString(36), name: r.name, phrase: r.phrase, samples });
  store.set('custom', S.custom);
  $('#tStatus').textContent = `Learned “${r.name}” from ${samples.length} poses. Record again to add more examples.`;
  $('#tName').value = ''; $('#tPhrase').value = '';
  renderCustom(); log('hand', `✋ Learned new sign “${r.name}”`);
}
function renderCustom() {
  $('#customList').innerHTML = S.custom.map(c => `<div><b>${esc(c.name)}</b><span style="color:var(--dim)">“${esc(c.phrase)}” · ${c.samples.length} poses</span><button class="btn sm" data-del="${c.id}">Delete</button></div>`).join('')
    || '<span class="sub" style="margin:0">No custom signs yet. You could teach signs from ISL/ASL, or any personal gesture.</span>';
}

/* ------------------------------------------------------------------ drawing */
const FL = FaceLandmarker;
function drawText(x, y, txt, color = '#fff', size = 22) {
  octx.save();
  octx.translate(x, y);
  if (S.mode === 'camera' && S.set.mirror) octx.scale(-1, 1);
  octx.font = `600 ${size}px Space Grotesk, sans-serif`;
  const w = octx.measureText(txt).width;
  octx.fillStyle = 'rgba(5,8,11,.78)'; octx.beginPath(); octx.roundRect(-6, -size, w + 12, size + 10, 8); octx.fill();
  octx.fillStyle = color; octx.fillText(txt, 0, 0);
  octx.restore();
}
function render(face, hands) {
  const W = overlay.width, H = overlay.height, sc = W / 1280;
  octx.clearRect(0, 0, W, H);
  if (face && S.set.mesh) {
    const lm = face.lm;
    draw.drawConnectors(lm, FL.FACE_LANDMARKS_TESSELATION, { color: 'rgba(45,212,191,.10)', lineWidth: 1 });
    draw.drawConnectors(lm, FL.FACE_LANDMARKS_FACE_OVAL, { color: 'rgba(45,212,191,.5)', lineWidth: 1.5 * sc });
    draw.drawConnectors(lm, FL.FACE_LANDMARKS_LIPS, { color: EMO_COLOR[S.emoTop], lineWidth: 2 * sc });
    for (const c of [FL.FACE_LANDMARKS_LEFT_EYEBROW, FL.FACE_LANDMARKS_RIGHT_EYEBROW]) draw.drawConnectors(lm, c, { color: '#f5b454', lineWidth: 2 * sc });
    for (const c of [FL.FACE_LANDMARKS_LEFT_EYE, FL.FACE_LANDMARKS_RIGHT_EYE]) draw.drawConnectors(lm, c, { color: '#60a5fa', lineWidth: 1.5 * sc });
    for (const c of [FL.FACE_LANDMARKS_LEFT_IRIS, FL.FACE_LANDMARKS_RIGHT_IRIS]) draw.drawConnectors(lm, c, { color: '#fff', lineWidth: 1.5 * sc });
  }
  if (face) {
    const top = face.lm[10];
    const e = EMO[S.emoTop];
    drawText(top.x * W - 60 * sc, top.y * H - 24 * sc, `${e.icon} ${e.name} ${Math.round(S.emo[S.emoTop] * 100)}%`, EMO_COLOR[S.emoTop], 26 * sc);
  }
  hands.forEach((h, i) => {
    const ch = S.hands[i]; const col = h.side === 'Left' ? '#f5b454' : '#a78bfa';
    if (S.set.handsDraw) {
      draw.drawConnectors(h.lm, GestureRecognizer.HAND_CONNECTIONS, { color: col, lineWidth: 3 * sc });
      draw.drawLandmarks(h.lm, { color: '#fff', fillColor: col, lineWidth: 1, radius: 3.5 * sc });
    }
    const xs = h.lm.map(p => p.x * W), ys = h.lm.map(p => p.y * H);
    const x = Math.min(...xs), y = Math.min(...ys);
    if (ch?.label) drawText(x, y - 14 * sc, labelName(ch.label), col, 24 * sc);
    // hold-to-type progress ring
    if (ch?.label && ch === S.hands.find(q => q.label) && S.hold.progress > 0 && S.set.typing) {
      const cx = h.lm[9].x * W, cy = h.lm[9].y * H, r = 34 * sc;
      octx.lineWidth = 6 * sc; octx.strokeStyle = 'rgba(255,255,255,.15)';
      octx.beginPath(); octx.arc(cx, cy, r, 0, Math.PI * 2); octx.stroke();
      octx.strokeStyle = '#2dd4bf'; octx.beginPath(); octx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * S.hold.progress); octx.stroke();
    }
  });
  if (S.rec && now() > S.rec.start) drawText(20 * sc, H - 30 * sc, `● Recording “${S.rec.name}” (${S.rec.samples.length})`, '#fb7185', 26 * sc);
}

/* ------------------------------------------------------------------ UI updates */
function updateUI(t) {
  const hud = [];
  if (S.mode === 'camera') hud.push(`${Math.round(S.fps)} fps`);
  hud.push(S.face ? 'face ✓' : 'no face'); hud.push(`${S.hands.length} hand${S.hands.length === 1 ? '' : 's'}`);
  if (!S.calibrated && S.mode === 'camera') hud.push('not calibrated');
  $('#hud').innerHTML = hud.map(h => `<span>${h}</span>`).join('');

  const e = EMO[S.emoTop], ep = Math.round(S.emo[S.emoTop] * 100);
  $('#bigemoIcon').textContent = S.face ? e.icon : '·';
  $('#bigemoName').textContent = S.face ? e.name : 'No face';
  $('#bigemoConf').textContent = S.face ? `${ep}% match` : '';
  $('#nEmo').textContent = S.face ? `${e.icon} ${e.name}` : '—';
  const second = Object.entries(S.emo).sort((a, b) => b[1] - a[1])[1];
  $('#nEmoS').textContent = S.face ? `${ep}% · then ${EMO[second[0]].name.toLowerCase()} ${Math.round(second[1] * 100)}%` : '';

  // emotion bars
  const sorted = EMOTIONS.map(x => x.k);
  $('#emoBars').innerHTML = sorted.map(k => {
    const v = S.face ? S.emo[k] : 0;
    return `<div class="bar ${k === S.emoTop && S.face ? 'top' : ''}"><span class="lbl">${EMO[k].icon} ${EMO[k].name.split(' /')[0]}</span><div class="track"><div class="fill" style="width:${(v * 100).toFixed(1)}%;background:${EMO_COLOR[k]}"></div></div><span class="pct">${Math.round(v * 100)}%</span></div>`;
  }).join('');

  // eyes
  const E = S.eye, eyeTxt = !S.face ? '—' : E.state === 'closed' ? 'Closed' : E.state === 'winkL' ? 'Winking (L)' : E.state === 'winkR' ? 'Winking (R)' : E.gazeDir === 'center' ? 'Open · center' : 'Looking ' + E.gazeDir;
  $('#nEye').textContent = eyeTxt;
  $('#nEyeS').textContent = S.face ? `${E.blinkTotal} blinks · ${blinkRate() ? Math.round(blinkRate()) + '/min' : '…'}` : '';
  $('#eBlinks').textContent = E.blinkTotal;
  $('#eRate').textContent = blinkRate() ? Math.round(blinkRate()) : '–';
  $('#eGaze').textContent = S.face ? E.gazeDir : '–';
  $('#eOpenL').textContent = S.face ? Math.round(S.open.L * 100) + '%' : '–';
  $('#eOpenR').textContent = S.face ? Math.round(S.open.R * 100) + '%' : '–';
  $('#ePerclos').textContent = S.perclos != null ? Math.round(S.perclos * 100) + '%' : '–';
  drawEyes();

  // head
  const p = S.pose;
  if (S.face && p) {
    const yawTxt = Math.abs(p.yaw) < 12 ? 'Facing forward' : `Turned ${p.yaw > 0 ? 'left' : 'right'}`;
    const pitchTxt = p.pitch > 12 ? ' · up' : p.pitch < -12 ? ' · down' : '';
    $('#nHead').textContent = yawTxt + pitchTxt;
    $('#nHeadS').textContent = `yaw ${p.yaw.toFixed(0)}° pitch ${p.pitch.toFixed(0)}° roll ${p.roll.toFixed(0)}°`;
    $('#hYaw').textContent = p.yaw.toFixed(0) + '°'; $('#hPitch').textContent = p.pitch.toFixed(0) + '°'; $('#hRoll').textContent = p.roll.toFixed(0) + '°';
  } else { $('#nHead').textContent = '—'; $('#nHeadS').textContent = ''; }

  // facial action chips
  $('#chips').innerHTML = FACE_ACTIONS.map(([n, ic, f, thr]) => {
    const v = S.bs ? clamp(f()) : 0;
    return `<div class="chip ${v > thr ? 'on' : ''}">${ic} ${n}<div class="m" style="width:${(v * 100).toFixed(0)}%"></div></div>`;
  }).join('');

  // hands
  const hs = S.hands;
  $('#nHand').textContent = hs.length ? hs.map(h => labelName(h.label).split(' ')[0]).join(' ') || '✋' : '—';
  $('#nHandS').textContent = hs.length ? hs.map(h => `${h.side[0]}: ${h.label ? labelName(h.label).replace(/^\S+ /, '') : h.count + ' fingers'}`).join(' · ') : 'no hands';
  const cards = ['Left', 'Right'].map(side => {
    const h = hs.find(x => x.side === side);
    if (!h) return `<div class="hcard"><div class="meta">Your ${side.toLowerCase()} hand</div><div class="g" style="color:var(--faint)">not in view</div></div>`;
    const fs = [['T', 'thumb'], ['I', 'index'], ['M', 'middle'], ['R', 'ring'], ['P', 'pinky']].map(([k, n]) => `<span class="${h.f[k] ? 'x' : ''}">${n}</span>`).join('');
    return `<div class="hcard" style="border-color:${side === 'Left' ? '#6b5222' : '#4c3d7a'}"><div class="meta">Your ${side.toLowerCase()} hand · ${h.count} finger${h.count === 1 ? '' : 's'} up</div>
      <div class="g">${labelName(h.label)}</div><div class="meta">${h.label ? `${h.src} · ${Math.round(h.conf * 100)}%` : 'no sign recognised'}</div>
      <div class="meta">says: ${esc(h.label ? (h.label.startsWith('custom:') ? S.custom.find(c => 'custom:' + c.id === h.label)?.phrase : S.map[h.label]) || '(nothing)' : '—')}</div><div class="fingers">${fs}</div></div>`;
  });
  $('#handCards').innerHTML = cards.join('');

  // indicators
  if (S.stressComp && S.face) {
    const st = Math.round(S.stress), lv = st < 20 ? ['Calm', 'var(--teal)'] : st < 40 ? ['Mild', 'var(--lime)'] : st < 60 ? ['Elevated', 'var(--amber)'] : ['High', 'var(--rose)'];
    $('#stressV').textContent = st; $('#stressL').textContent = lv[0]; $('#stressL').style.color = lv[1];
    $('#stressBars').innerHTML = Object.entries(S.stressComp).map(([k, v]) => `<div class="bar"><span>${k}</span><div class="track"><div class="fill" style="width:${v * 100}%;background:var(--violet)"></div></div><span class="pct">${Math.round(v * 100)}</span></div>`).join('');
    const d = Math.round(S.drowsy), dl = d < 25 ? ['Alert', 'var(--teal)'] : d < 55 ? ['A bit tired', 'var(--amber)'] : ['Drowsy', 'var(--rose)'];
    $('#drowsyV').textContent = d; $('#drowsyL').textContent = dl[0]; $('#drowsyL').style.color = dl[1];
    $('#drowsyS').textContent = `eyes closed ${Math.round((S.perclos || 0) * 100)}% of last 30 s · ${S.yawns.length} yawn${S.yawns.length === 1 ? '' : 's'} · ${S.longBlinks.length} long blinks`;
    const a = Math.round(S.attn), al = a > 80 ? ['Focused', 'var(--teal)'] : a > 50 ? ['Partly', 'var(--amber)'] : ['Looking away', 'var(--rose)'];
    $('#attnV').textContent = a + '%'; $('#attnL').textContent = al[0]; $('#attnL').style.color = al[1];
  }
  drawCircumplex(); drawTimeline();
  const tot = Object.values(S.sessionCounts).reduce((a, b) => a + b, 0);
  if (tot) $('#sessionSum').textContent = 'Session: ' + Object.entries(S.sessionCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${EMO[k].icon} ${Math.round(v / tot * 100)}%`).join(' · ');
}

function drawEyes() {
  const el = $('#eyeSvg'), g = S.gaze, show = S.face;
  const eye = (cx, open, label) => {
    const h = 34 * (show ? clamp(open, .04, 1) : 1);
    // pupils drawn as a mirror would show them: the person's left appears on screen left
    const px = cx - (show ? clamp(g.x * 70, -26, 26) : 0), py = 60 - (show ? clamp(g.y * 60, -16, 16) : 0);
    return `<clipPath id="c${cx}"><ellipse cx="${cx}" cy="60" rx="62" ry="${h}"/></clipPath>
      <ellipse cx="${cx}" cy="60" rx="62" ry="${h}" fill="#e6edf3"/>
      <g clip-path="url(#c${cx})"><circle cx="${px}" cy="${py}" r="21" fill="#2dd4bf"/><circle cx="${px}" cy="${py}" r="9" fill="#05080b"/><circle cx="${px + 6}" cy="${py - 6}" r="3.5" fill="#fff"/></g>
      <ellipse cx="${cx}" cy="60" rx="62" ry="${h}" fill="none" stroke="#8b9bb0" stroke-width="2"/>
      <text x="${cx}" y="116" fill="#8b9bb0" font-size="12" text-anchor="middle" font-family="Space Grotesk">${label}</text>`;
  };
  el.innerHTML = eye(85, S.open.L, 'your left') + eye(255, S.open.R, 'your right');
}
function drawCircumplex() {
  const e = S.emo;
  const val = clamp(e.happy - .8 * (e.sad + e.angry + e.fear) - .7 * e.disgust - .4 * e.contempt + .1 * e.surprised, -1, 1);
  const aro = clamp(.9 * e.surprised + .8 * e.fear + .7 * e.angry + .4 * e.happy + .2 * e.disgust - .5 * e.sad - .4 * e.neutral - S.drowsy / 200, -1, 1);
  const q = (x, y, t) => `<text x="${x}" y="${y}" fill="#56657a" font-size="10" text-anchor="middle" font-family="Space Grotesk">${t}</text>`;
  $('#circ').innerHTML = `<circle r="96" fill="#0a1017" stroke="#233142"/><line x1="-96" x2="96" stroke="#233142"/><line y1="-96" y2="96" stroke="#233142"/>
    ${q(0, -80, 'energised')}${q(0, 88, 'calm / low')}${q(-62, 4, 'unpleasant')}${q(64, 4, 'pleasant')}
    ${q(-55, -55, 'tense')}${q(55, -55, 'excited')}${q(-55, 62, 'down')}${q(55, 62, 'content')}
    ${S.face ? `<circle cx="${val * 86}" cy="${-aro * 86}" r="9" fill="${EMO_COLOR[S.emoTop]}" stroke="#fff" stroke-width="2"/>` : ''}`;
}
function drawTimeline() {
  const c = $('#timeline'), dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
  const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  const T = S.timeline; if (T.length < 2) return;
  const tEnd = T[T.length - 1].t, X = t => w - (tEnd - t) / 60000 * w;
  const order = EMOTIONS.map(e => e.k);
  let lower = T.map(() => 0);
  for (const k of order) {
    const upper = T.map((s, i) => lower[i] + s[k]);
    x.beginPath();
    T.forEach((s, i) => { const px = X(s.t), py = h - upper[i] * h; i ? x.lineTo(px, py) : x.moveTo(px, py); });
    for (let i = T.length - 1; i >= 0; i--) x.lineTo(X(T[i].t), h - lower[i] * h);
    x.closePath(); x.fillStyle = EMO_COLOR[k] + (k === 'neutral' ? '55' : 'cc'); x.fill();
    lower = upper;
  }
}

/* ------------------------------------------------------------------ log & toast */
function log(cls, msg) {
  const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  S.events.unshift({ cls, msg, ts }); S.events.length = Math.min(S.events.length, 200);
  const row = `<div class="${cls}"><time>${ts}</time><span>${esc(msg)}</span></div>`;
  $('#logFeed').insertAdjacentHTML('afterbegin', row);
  if (cls === 'eye') $('#eyeFeed').insertAdjacentHTML('afterbegin', row);
  if (cls === 'head') $('#headFeed').insertAdjacentHTML('afterbegin', row);
  for (const id of ['#logFeed', '#eyeFeed', '#headFeed']) { const f = $(id); while (f.children.length > 120) f.lastChild.remove(); }
}
let toastT;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1400); }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------------ settings UI */
function renderMap() {
  const rows = [['Hand signs', HAND_SIGNS], ['Eye & head', EYE_HEAD]].map(([title, set]) =>
    `<tr><td colspan="2" style="color:var(--teal);padding-top:10px;font-weight:600">${title}</td></tr>` +
    Object.entries(set).map(([k, n]) => `<tr><td>${n}</td><td><input data-map="${k}" value="${esc(S.map[k] || '')}"></td></tr>`).join('')).join('');
  $('#mapTable').innerHTML = rows;
}
function fillVoices() {
  voices = speechSynthesis.getVoices();
  const sel = $('#sVoice');
  sel.innerHTML = '<option value="">System default</option>' + voices.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === S.set.voice ? 'selected' : ''}>${esc(v.name)} (${v.lang})</option>`).join('');
}
function summary() {
  return {
    face: S.face, emotion: S.emoTop, emo: Object.fromEntries(Object.entries(S.emo).map(([k, v]) => [k, +v.toFixed(3)])),
    pose: S.pose && Object.fromEntries(Object.entries(S.pose).map(([k, v]) => [k, +v.toFixed(1)])),
    actions: S.bs ? FACE_ACTIONS.filter(([, , f, thr]) => f() > thr).map(a => a[0]) : [],
    hands: S.hands.map(h => ({ side: h.side, label: h.label, src: h.src, model: h.model.categoryName, fingers: h.f })),
  };
}

function wire() {
  $('#startBtn').onclick = () => startCamera();
  $('#camBtn').onclick = stopCamera;
  $('#camSel').onchange = e => startCamera(e.target.value);
  $('#calibBtn').onclick = startCalibration;
  const onPhoto = e => { const f = e.target.files[0]; if (f) analyzePhoto(URL.createObjectURL(f)).catch(err => toast(err.message)); e.target.value = ''; };
  $('#photoIn').onchange = onPhoto; $('#photoIn2').onchange = onPhoto;
  $('#optMesh').onchange = e => S.set.mesh = e.target.checked;
  $('#optHands').onchange = e => S.set.handsDraw = e.target.checked;
  $('#optMirror').onchange = e => { S.set.mirror = e.target.checked; stage.classList.toggle('mirror', S.set.mirror && S.mode === 'camera'); };
  $('#optTyping').onchange = e => S.set.typing = e.target.checked;
  $('#optEyeCmd').onchange = e => S.set.eyeCmd = e.target.checked;
  $('#optAuto').onchange = e => S.set.auto = e.target.checked;
  $('#speakBtn').onclick = speakSentence;
  $('#backBtn').onclick = () => { S.sentence.pop(); renderSentence(); };
  $('#clearBtn').onclick = () => { S.sentence = []; renderSentence(); };
  $('#phrases').innerHTML = '<button class="sos" data-sos>🆘 HELP</button>' + QUICK.map(q => `<button data-q="${esc(q)}">${esc(q)}</button>`).join('');
  $('#phrases').onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.sos != null) sos(); else addWord(b.dataset.q); };
  $('#tabs').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('act', x === b));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('act', p.id === 'p-' + b.dataset.p));
    updateUI(now());
  };
  $('#tRec').onclick = startRecording;
  $('#customList').onclick = e => { const id = e.target.dataset.del; if (!id) return; S.custom = S.custom.filter(c => c.id !== id); store.set('custom', S.custom); renderCustom(); };
  $('#logClear').onclick = () => { $('#logFeed').innerHTML = ''; };
  const rng = (id, key, fmt, after) => { const el = $(id); el.value = S.set[key]; const show = () => $(id + 'V').textContent = fmt(+el.value); show();
    el.oninput = () => { S.set[key] = +el.value; store.set(key, S.set[key]); show(); after?.(); }; };
  const holdPill = () => $('#holdPill').textContent = `hold ${(S.set.hold / 1000).toFixed(1)} s to type`;
  rng('#sHold', 'hold', v => (v / 1000).toFixed(1) + ' s', holdPill); holdPill();
  rng('#sStrict', 'strict', v => v.toFixed(2));
  rng('#sRate', 'rate', v => v.toFixed(2));
  $('#sVoice').onchange = e => { S.set.voice = e.target.value; store.set('voice', S.set.voice); };
  $('#mapTable').oninput = e => { const k = e.target.dataset.map; if (!k) return; S.map[k] = e.target.value; store.set('map', S.map); };
  $('#mapReset').onclick = () => { S.map = { ...DEFAULT_MAP }; store.set('map', {}); renderMap(); };
  $('#csvBtn').onclick = () => {
    const head = ['time', 'dominant', ...EMOTIONS.map(e => e.k), 'yaw', 'pitch', 'roll', 'gaze', 'blinks_per_min', 'stress'];
    const csv = [head, ...(S.csv || [])].map(r => r.join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `bhaav-session-${new Date().toISOString().slice(0, 16).replace(':', '')}.csv`; a.click();
  };
  $('#legend').innerHTML = EMOTIONS.map(e => `<span><i style="background:${EMO_COLOR[e.k]}"></i>${e.name.split(' /')[0]}</span>`).join('');
  if ('speechSynthesis' in window) { fillVoices(); speechSynthesis.onvoiceschanged = fillVoices; }
  renderMap(); renderCustom(); renderSentence(); $('#sentence').innerHTML = $('#sentence').innerHTML.replace('Sentence is empty.', 'Hold a hand sign (👍 = Yes, ✊ = I need help, ✌️ = Thank you…), nod or shake your head, or tap a phrase below.');
  updateUI(now());
}
wire();

// Test/automation hook
window.__BHAAV = { S, analyzePhoto, summary, fire, classifyHand, shapeGesture, fingerStates, eyeStep, headStep, emotionScores, act, frame, startCalibration, finishCalibration };
