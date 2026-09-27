// BHAAV — on-device expression, eye-gesture, head-gesture and hand-sign reader.
import { FilesetResolver, FaceLandmarker, GestureRecognizer, DrawingUtils }
  from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs';
import { scoreAlertness } from './alertness.js';
import { faceGeom, handGeom, extraShape, twoHand, palmFacing, contacts, combos, COMBOS, motionTracker, mentalRead, STATES, prayerSingle } from './reading.js';

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
  Call_Me: '🤙 Shaka / call me', Rock: '🤘 Rock on', Three: '3️⃣ Three', Four: '4️⃣ Four', L_Shape: '🫲 L-shape', Pinky: '🤙 Pinky', Pinch: '🤏 Pinch',
  Finger_Heart: '🫰 Finger heart', Pinched: '🤌 Pinched fingers', Crossed_Fingers: '🤞 Fingers crossed', Point_You: '🫵 Pointing at you',
  Finger_Gun: '🔫 Finger gun', Peace_Side: '✌️ Sideways peace', Vulcan: '🖖 Vulcan salute', Middle_Finger: '🖕 Middle finger',
};
const TWO_HAND = {
  Heart_Hands: '🫶 Heart hands', Big_Heart: '💞 Big heart over head', Double_Finger_Heart: '🫰🫰 Double finger heart', Prayer: '🙏 Palms together',
  X_Fingers: '✖️ Crossed-finger X (안돼)', X_Hands: '🙅 Crossed hands X', Double_Thumbs: '👍👍 Double thumbs up', Double_Peace: '✌️✌️ Double peace',
  Double_Guns: '👉👉 Double finger guns', Photo_Frame: '📸 Photo frame', Hands_Up: '🙌 Hands up', Fists_Up: '💪 Fists up',
  Steeple: '🔺 Steepled fingers', Shrug: '🤷 Shrug', Wave: '👋 Wave', Clap: '👏 Clap',
};
const COMBO_NAMES = Object.fromEntries(Object.entries(COMBOS).map(([k, [ic, n]]) => [k, `${ic} ${n}`]));
const GESTURE_MEANING = {
  Thumb_Up: 'Approval, yes, good job', Thumb_Down: 'Disapproval, no', Closed_Fist: 'Strength, or "help" in this app', Open_Palm: 'Hello, stop, or high-five',
  Pointing_Up: 'Wait, one moment, or an idea', Point: 'Pointing something out', Victory: 'Peace or victory (V-sign)', ILoveYou: 'ASL "I love you"', OK: 'Okay, perfect',
  Call_Me: 'Hang loose (shaka) or "call me"', Rock: 'Rock on, excitement', L_Shape: 'The letter L, or "loser" on the forehead',
  Finger_Heart: 'Korean finger heart (손가락 하트): love and thanks', Pinched: '🤌 "What do you mean?!" or "perfection" (Italian)', Crossed_Fingers: 'Hoping for luck',
  Point_You: '"You!" Pointing at the viewer', Finger_Gun: 'Playful "gotcha", "you got it"', Peace_Side: 'Sideways peace: playful, cute', Vulcan: 'Live long and prosper',
  Middle_Finger: 'Rude insult: strong anger', Heart_Hands: 'Love, "I heart you"', Big_Heart: 'Korean arm heart over the head: big love (사랑해)',
  Double_Finger_Heart: 'Extra love, fan service', Prayer: 'Please, thank you, namaste or sorry', X_Fingers: 'Korean X: no, not allowed (안돼)', X_Hands: 'No, stop, not okay',
  Double_Thumbs: 'Super approval', Double_Peace: 'Hype, happy photo pose', Double_Guns: '"Ayy!" Playful', Photo_Frame: 'Framing a shot, "picture this"',
  Hands_Up: 'Celebration, hooray', Fists_Up: 'Victory, "let\'s go!"', Steeple: 'Confidence, evaluating', Shrug: '"I don\'t know" or "whatever"', Wave: 'Hello or goodbye', Clap: 'Applause, well done',
};
const EYE_HEAD = {
  Nod: '↕ Head nod', Shake: '↔ Head shake', Long_Blink: '😌 Long blink (1 s)', Double_Blink: '👀 Double blink',
  Wink_Left: '😉 Wink (your left)', Wink_Right: '😉 Wink (your right)', Tilt_Left: '↖ Head tilt left', Tilt_Right: '↗ Head tilt right',
  Look_Up: '⬆ Look up (hold)', Yawn: '🥱 Yawn', Microsleep: '😴 Micro-sleep (eyes shut 2 s+)', Nod_Off: '💤 Nodding off',
};
const DEFAULT_MAP = {
  Thumb_Up: 'Yes', Thumb_Down: 'No', Closed_Fist: 'I need help', Open_Palm: 'Hello', Pointing_Up: 'Wait, please',
  Point: 'That one', Victory: 'Thank you', ILoveYou: 'I love you', OK: "I'm okay", Call_Me: 'Please call my family',
  Rock: 'That is great', Three: 'I want water', Four: 'I am hungry', L_Shape: 'I need the bathroom', Pinky: 'I am in pain', Pinch: 'A little',
  Nod: 'Yes', Shake: 'No', Long_Blink: '[speak]', Double_Blink: '', Wink_Left: '', Wink_Right: '[undo]',
  Tilt_Left: '', Tilt_Right: '', Look_Up: '', Yawn: '',
  Finger_Heart: 'I love you', Pinched: 'What do you mean?', Crossed_Fingers: 'Wish me luck', Point_You: 'You',
  Heart_Hands: 'I love you', Big_Heart: 'I love you so much', Double_Finger_Heart: 'Love you!', Prayer: 'Please',
  X_Fingers: 'No, stop', X_Hands: 'No, stop', Double_Thumbs: 'That is great!', Hands_Up: 'Yay!', Fists_Up: "Let's go!",
  Shrug: "I don't know", Wave: 'Hello', Clap: 'Well done!',
  Forehead_Think: 'Let me think', Forehead_Overwhelmed: 'I have a headache', Facepalm: 'Oh no', Temples_Both: 'I am stressed',
  Chin_Think: 'Hmm, let me think', Mouth_Shock: 'Oh my god!', Shh: 'Please be quiet', Nail_Bite: 'I am nervous', Kiss: 'Love you',
  Eye_Rub: 'I am sleepy', Cover_Eyes: "I can't look", Ear_Listen: "I can't hear you", Ears_Cover: 'It is too loud',
  Head_Scratch: "I don't understand", Hand_Heart: 'Thank you from my heart', Point_Self: 'Me?',
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
  scene: { two: null, combos: [] }, motion: motionTracker(), recent: {}, readEma: {}, read: [], micro: [], microSt: {}, smileType: '', mixed: [],
  alert: null, alertHist: [], lidDroop: 0, gazeHist: [], nodOffs: [], microsleeps: [],
  src: null, look: null, lower: 'none', glasses: false, lastLook: 0, light: { L: 128, boost: 1 },
  set: { alarm: store.get('alarm', false), lowLight: store.get('lowLight', true), cover: store.get('cover', 'auto'), glassesSet: store.get('glassesSet', 'auto'),
         hold: store.get('hold', 900), strict: store.get('strict', 0.9), rate: store.get('rate', 0.95), voice: store.get('voice', ''),
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
      baseOptions: { modelAssetPath: FACE_MODEL, delegate }, runningMode: 'VIDEO', numFaces: 2,
      // lenient thresholds keep tracking through beards, masks, glasses, hands near the face
      outputFaceBlendshapes: true, minFaceDetectionConfidence: .35, minFacePresenceConfidence: .35, minTrackingConfidence: .35,
    });
    gestV = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: GEST_MODEL, delegate }, runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: .4, minHandPresenceConfidence: .4, minTrackingConfidence: .4,
    });
  };
  try { await make('GPU'); } catch (e) { console.warn('GPU delegate failed, using CPU', e); await make('CPU'); }
  pill('models: ready', 'ok');
}
async function loadImageModels() {
  if (faceI) return;
  pill('models: loading…', 'warn');
  fileset = fileset || await FilesetResolver.forVisionTasks(WASM);
  faceI = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 2, outputFaceBlendshapes: true, minFaceDetectionConfidence: .35, minFacePresenceConfidence: .35 });
  gestI = await GestureRecognizer.createFromOptions(fileset, { baseOptions: { modelAssetPath: GEST_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', numHands: 2, minHandDetectionConfidence: .35, minHandPresenceConfidence: .35 });
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
  // In dim light, feed the models a brightened copy of the frame (and brighten the preview to match)
  let src = video;
  const boost = S.set.lowLight && S.light.boost > 1.05 ? S.light.boost : 1;
  if (boost > 1) {
    if (procCanvas.width !== video.videoWidth) { procCanvas.width = video.videoWidth; procCanvas.height = video.videoHeight; }
    pctx.filter = `brightness(${boost.toFixed(2)}) contrast(1.15)`;
    pctx.drawImage(video, 0, 0); src = procCanvas;
  }
  video.style.filter = boost > 1 ? `brightness(${boost.toFixed(2)}) contrast(1.15)` : '';
  S.src = src;
  const fr = faceV.detectForVideo(src, t);
  const gr = gestV.recognizeForVideo(src, t);
  frame(fr, gr, t, true);
}
const procCanvas = document.createElement('canvas'), pctx = procCanvas.getContext('2d');

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
  S.src = photo; S.look = null;
  const fr = faceI.detect(img), gr = gestI.recognize(img);
  frame(fr, gr, now(), false);
  return summary();
}

/* ------------------------------------------------------------------ per-frame pipeline */
function frame(fr, gr, t, live) {
  const dt = S.lastT ? clamp(t - S.lastT, 1, 250) : 33;
  S.lastT = t; S.fps = S.fps * .9 + (1000 / dt) * .1;
  // with several people in view, follow the person making the gestures (face nearest the hands), else the largest face
  const fw = lm => Math.abs(lm[454].x - lm[234].x) || 1e-3;
  const handPts = (gr.landmarks || []).map(h => h[9]);
  const maxW = Math.max(0, ...(fr.faceLandmarks || []).map(fw));
  // size dominates, the detector's most confident face gets a bonus, closeness to the hands breaks ties
  const faceScore = (lm, i) => 2 * fw(lm) / (maxW || 1) + (i === 0 ? .6 : 0)
    - (handPts.length ? Math.min(8, Math.min(...handPts.map(p => Math.hypot(p.x - (lm[234].x + lm[454].x) / 2, p.y - lm[1].y))) / fw(lm)) / 8 : 0);
  const fi = (fr.faceLandmarks || []).reduce((b, lm, i, all) => faceScore(lm, i) > faceScore(all[b], b) ? i : b, 0);
  const face = fr.faceBlendshapes?.[fi] ? {
    bs: Object.fromEntries(fr.faceBlendshapes[fi].categories.map(c => [c.categoryName, c.score])),
    lm: fr.faceLandmarks[fi],
  } : null;
  const hands = (gr.landmarks || []).map((lm, i) => ({
    lm, wlm: gr.worldLandmarks[i],
    // MediaPipe labels handedness assuming a mirrored selfie image; raw webcam frames are not mirrored.
    side: (gr.handedness?.[i]?.[0]?.categoryName === 'Left') ? 'Right' : 'Left',
    model: gr.gestures?.[i]?.[0] || { categoryName: 'None', score: 0 },
  }));
  // a hand over the face would look like a mask or beard to the appearance sampler, so pause it then
  S.handOnFace = !!face && hands.some(h => {
    const L = face.lm, x0 = Math.min(L[234].x, L[454].x), x1 = Math.max(L[234].x, L[454].x), m = (x1 - x0) * .15;
    return h.lm.some(p => p.x > x0 - m && p.x < x1 + m && p.y > L[10].y - m && p.y < L[152].y + m);
  });
  analyzeFace(face, t, dt, live);
  analyzeHands(hands, t, live);
  analyzeScene(face, t, live);
  if (!live || t - (S.lastRead || 0) > 150) { S.lastRead = t; alertStep(t, live); readMind(t, live); }
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
/* ---- appearance: beard / moustache / face mask / glasses, and scene brightness.
   Samples small colour patches at landmark positions and compares the lower face with the
   upper-cheek skin, so the emotion model can lean on whatever parts of the face are visible. */
const sampCanvas = document.createElement('canvas'), sctx = sampCanvas.getContext('2d', { willReadFrequently: true });
function grab(src) {
  const W = src.videoWidth || src.width, H = src.videoHeight || src.height; if (!W || !H) return null;
  const w = 360, h = Math.round(w * H / W);
  sampCanvas.width = w; sampCanvas.height = h;
  sctx.filter = 'none'; sctx.drawImage(src, 0, 0, w, h);
  return { d: sctx.getImageData(0, 0, w, h).data, w, h };
}
function patch(img, p, r) {
  const cx = Math.round(p.x * img.w), cy = Math.round(p.y * img.h);
  let n = 0, sL = 0, sL2 = 0, sB = 0, sR = 0;
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
    const i = (y * img.w + x) * 4, R = img.d[i], G = img.d[i + 1], B = img.d[i + 2];
    const L = .299 * R + .587 * G + .114 * B;
    n++; sL += L; sL2 += L * L; sB += -.169 * R - .331 * G + .5 * B; sR += .5 * R - .419 * G - .081 * B;
  }
  if (!n) return { L: 0, sd: 0, cb: 0, cr: 0 };
  const L = sL / n;
  return { L, sd: Math.sqrt(Math.max(0, sL2 / n - L * L)), cb: sB / n, cr: sR / n };
}
const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const avgP = ps => { const o = { L: 0, sd: 0, cb: 0, cr: 0 }; for (const p of ps) for (const k in o) o[k] += p[k] / ps.length; return o; };
function profileBand(img, a, b, n = 14) { // dark/bright band strength along a segment (glasses frames)
  const v = []; for (let i = 0; i <= n; i++) v.push(patch(img, lerpP(a, b, i / n), 1).L);
  const s = [...v].sort((x, y) => x - y), med = s[n >> 1] || 1;
  let grad = 0; for (let i = 1; i < v.length; i++) grad = Math.max(grad, Math.abs(v[i] - v[i - 1]));
  return { dark: (med - s[0]) / med, grad: grad / med };
}
function measureLook(src, lm) {
  const img = grab(src); if (!img) return null;
  const faceW = Math.abs(lm[454].x - lm[234].x) * img.w, r = Math.max(2, Math.round(faceW * .035));
  const P = i => lm[i];
  const skin = avgP([118, 347, 50, 280].map(i => patch(img, P(i), r)));
  const moustache = avgP([lerpP(P(2), P(0), .55), lerpP(P(2), P(61), .6), lerpP(P(2), P(291), .6)].map(p => patch(img, p, r)));
  const chin = avgP([lerpP(P(17), P(152), .55), lerpP(P(61), P(150), .55), lerpP(P(291), P(379), .55)].map(p => patch(img, p, r)));
  const nose = patch(img, P(1), r);
  const lip = patch(img, lerpP(P(14), P(17), .5), Math.max(1, r >> 1));
  // Colour is compared relative to this person's own skin tone, so it works across complexions.
  const skinSat = Math.max(15, Math.hypot(skin.cb, skin.cr));
  const rel = p => Math.hypot(p.cb - skin.cb, p.cr - skin.cr) / skinSat, dL = p => p.L / (skin.L + 1);
  // Mask vs beard: a mask covers the nose tip (colour unlike skin), and it is one piece of fabric, so the
  // lower-lip spot matches the upper-lip spot. With a beard the nose stays skin and the lip stands out from the moustache.
  const d = (a, b) => Math.hypot((a.L - b.L) / (skin.L + 1) * 1.5, Math.hypot(a.cb - b.cb, a.cr - b.cr) / skinSat);
  const noseCovered = clamp((rel(nose) - .35) / .25);
  const sameFabric = clamp((.35 - d(lip, moustache)) / .12) * clamp((.45 - d(lip, nose)) / .12);
  const chinDiff = Math.max(clamp((rel(chin) - .3) / .25), clamp((Math.abs(dL(chin) - 1) - .2) / .1));
  const mask = Math.max(noseCovered, sameFabric) * chinDiff;
  // hair = darker than skin (dark beards) OR colour shifted from skin OR washed-out + textured (grey / stubble).
  // Colour cues only count when the skin itself has measurable colour (not in grey or very pale footage).
  const colourTrust = clamp((Math.hypot(skin.cb, skin.cr) - 12) / 10);
  const hairy = p => Math.max(
    clamp((.8 - dL(p)) / .25),
    colourTrust * clamp((rel(p) - .3) / .25),
    colourTrust * clamp((.8 - Math.hypot(p.cb, p.cr) / skinSat) / .15) * clamp((p.sd / (skin.sd + 4) - .8) / .4),
  ) * (1 - mask);
  // glasses: a dark/bright bar across the nose bridge between the eyes (a mask's top edge can mimic it, so be stricter then)
  const bridge = profileBand(img, P(168), lerpP(P(168), P(6), .6));
  const glasses = clamp((bridge.dark - (mask > .5 ? .55 : .22)) / .2);
  // under-eye darkness vs mid-cheek, sampled straight "down the face" from each lower lid
  const dn = (() => { const dx = (P(152).x - P(10).x) * img.w, dy = (P(152).y - P(10).y) * img.h, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; })();
  const eyeW = Math.hypot((P(133).x - P(33).x) * img.w, (P(133).y - P(33).y) * img.h);
  const at = (i, k) => ({ x: P(i).x + dn.x * k * eyeW / img.w, y: P(i).y + dn.y * k * eyeW / img.h });
  const rr = Math.max(1, Math.round(eyeW * .1));
  const under = avgP([at(145, .32), at(374, .32)].map(p => patch(img, p, rr)));
  const cheek = avgP([at(145, 1.15), at(374, 1.15)].map(p => patch(img, p, rr)));
  // upper-lid / crease reference, the same distance above the eye
  const upper = avgP([at(159, -.3), at(386, -.3)].map(p => patch(img, p, rr)));
  // Overhead light shadows a deep-set eye above AND below; dark circles darken only below the eye.
  // So: under-eye darker than the cheek, and not matched by a shadow over the upper lid.
  const uR = under.L / (cheek.L + 1), dUp = (upper.L - under.L) / (cheek.L + 1);
  const dark = clamp((.85 - uR) / .2) * clamp((dUp + .15) / .2) * (1 - mask);
  // sclera between iris and eye corners; only trusted when it is actually bright (not lids or lashes)
  const scl = [lerpP(P(468), P(33), .6), lerpP(P(468), P(133), .6), lerpP(P(473), P(263), .6), lerpP(P(473), P(362), .6)].map(p => patch(img, p, 1));
  const white = scl.filter(s => s.L > skin.L * .95);
  const red = white.length >= 2 ? clamp((white.reduce((s, w) => s + w.cr, 0) / white.length - .7 * Math.max(0, skin.cr) - 2) / 8) : 0;
  return { beard: hairy(chin), moustache: hairy(moustache), mask, glasses, skinL: skin.L, dark, red,
    raw: { skin, moustache, chin, nose, lip, bridge, under, cheek, upper, scl: scl.map(s => [Math.round(s.L), Math.round(s.cr)]), rel: { nose: rel(nose), chin: rel(chin) } } };
}
function applyLookMode() {
  const L = S.look || { mask: 0, beard: 0, moustache: 0, glasses: 0 };
  const autoLower = L.mask > .55 ? 'mask' : (L.beard > .5 || L.moustache > .55) ? 'beard' : 'none';
  S.lower = S.set.cover === 'auto' ? autoLower : S.set.cover;
  S.glasses = S.set.glassesSet === 'auto' ? L.glasses > .5 : S.set.glassesSet === 'yes';
}
function updateLook(face, t, live) {
  if (!S.src || !face) return;
  if (S.handOnFace) { if (!live) { S.look = null; applyLookMode(); } return; }
  if (live && t - S.lastLook < 600) return;
  S.lastLook = t;
  const m = measureLook(S.src, face.lm); if (!m) return;
  if (!S.look || !live) S.look = m;
  else for (const k of ['beard', 'moustache', 'mask', 'glasses', 'skinL', 'dark', 'red']) S.look[k] += .35 * (m[k] - S.look[k]);
  S.look.raw = m.raw;
  // brightness: boost toward a comfortable face luminance (measured on the un-boosted frame)
  if (live) {
    const faceL = S.look.skinL / (S.light.boost || 1);
    S.light.L = faceL;
    const want = faceL < 75 ? clamp(115 / Math.max(faceL, 8), 1, 2.6) : 1;
    S.light.boost += .4 * (want - S.light.boost);
  }
  const prevLower = S.lower, prevG = S.glasses;
  applyLookMode();
  if (live && prevLower !== S.lower) {
    const msg = S.lower === 'mask' ? '😷 Face covering detected. Reading emotions from eyes & brows' :
      S.lower === 'beard' ? '🧔 Beard / moustache detected. Mouth signals boosted, eyes weighted more' : '🙂 Lower face fully visible';
    log('emo', msg); toast(msg.split('.')[0]);
  }
  if (live && prevG !== S.glasses) log('eye', S.glasses ? '👓 Glasses detected. Eye thresholds relaxed' : '👓 No glasses');
}

const act = k => clamp(((S.bs?.[k] ?? 0) - (S.base[k] ?? .02)) / (1 - (S.base[k] ?? .02)));
const act2 = k => (act(k + 'Left') + act(k + 'Right')) / 2;

function emotionScores() {
  // Beard/moustache: lip landmarks move less visibly, so mouth signals get more gain and smiling eyes count more.
  // Face covering: mouth signals are guesses, so they are dropped and emotions come from eyes, brows and cheeks.
  const mode = S.lower, mg = mode === 'beard' ? 1.45 : 1, mo = mode === 'mask' ? 0 : 1;
  const M = (x, s) => mo * N(x * mg, s);
  const sm = M(act2('mouthSmile'), .6), fr = M(act2('mouthFrown'), .35), bd = N(act2('browDown'), .45), bi = N(act('browInnerUp'), .5),
    bo = N(act2('browOuterUp'), .45), wide = N(act2('eyeWide'), S.glasses ? .3 : .35), jaw = M(act('jawOpen'), .5), str = M(act2('mouthStretch'), .35),
    press = M(act2('mouthPress'), .4), sneer = N(act2('noseSneer'), .35) * (mode === 'mask' ? .5 : 1), up = M(act2('mouthUpperUp'), .4), shrug = M(act('mouthShrugLower'), .4),
    chk = N(act2('cheekSquint'), .4), sq = N(act2('eyeSquint'), .5);
  const smileAsym = M(Math.abs(act('mouthSmileLeft') - act('mouthSmileRight')), .3);
  const dimpleAsym = M(Math.abs(act('mouthDimpleLeft') - act('mouthDimpleRight')), .3);
  const browAsym = N(Math.abs(act('browOuterUpLeft') - act('browOuterUpRight')) + Math.abs(act('browDownLeft') - act('browDownRight')), .35);
  if (mode === 'mask') {
    const eyeSmile = clamp(chk * .75 + sq * .35 * (1 - bd) - bi * .2);
    const e = {
      happy: eyeSmile,
      sad: clamp(bi * .75 * (1 - bo) - eyeSmile * .5),
      angry: clamp(bd * .85 + sq * .15 - bi * .2 - eyeSmile * .3),
      surprised: clamp((bi + bo) / 2 * .7 + wide * .5 - bd * .5),
      fear: clamp(bi * .55 + wide * .55 + bd * .15 - bo * .2 - eyeSmile * .5),
      disgust: clamp(sneer * .8 + bd * sq * .3),
      contempt: 0,
      confused: clamp(browAsym * .7 + bd * bi * .8),
    };
    return finishEmotions(e);
  }
  const e = {
    happy: clamp(sm * .9 + chk * (mode === 'beard' ? .4 : .25) + (mode === 'beard' ? sq * .12 * (1 - bd) : 0)),
    sad: clamp(fr * .6 + bi * .35 * (1 - bo) + shrug * .3 - sm * .8),
    angry: clamp(bd * .75 + press * .2 + sneer * .2 + sq * .15 - sm * .6 - bi * .2),
    surprised: clamp((bi + bo) / 2 * .55 + wide * .35 + jaw * .45 - bd * .5 - sm * .3),
    fear: clamp(bi * .4 + wide * .4 + str * .55 + bd * .1 - sm * .6 - jaw * .15),
    disgust: clamp(sneer * .65 + up * .45 - sm * .4),
    contempt: clamp(smileAsym * .7 * (1 - sm * .8) + dimpleAsym * .3),
    confused: clamp(browAsym * .6 + bd * bi * .8 + M(act('mouthLeft') + act('mouthRight'), .4) * .2 - sm * .5),
  };
  return finishEmotions(e);
}
function finishEmotions(e) {
  e.neutral = clamp(1 - Math.max(...Object.values(e)) * 1.6);
  let sum = 0;
  for (const k in e) { e[k] = Math.pow(e[k] + .002, 1.6); sum += e[k]; }
  for (const k in e) e[k] /= sum;
  return e;
}

const MG = () => S.lower === 'beard' ? 1.45 : 1; // beard gain, as in emotionScores
const FACE_ACTIONS = [
  ['Smile', '😊', () => act2('mouthSmile') * MG(), .35, 'mouth'],
  ['Big grin', '😁', () => Math.min(act2('mouthSmile') * MG(), act('jawOpen') * 2), .3, 'mouth'],
  ['Smirk', '😏', () => Math.abs(act('mouthSmileLeft') - act('mouthSmileRight')) * 2 * MG(), .5, 'mouth'],
  ['Frown', '☹️', () => act2('mouthFrown') * 1.6 * MG(), .45, 'mouth'],
  ['Brows raised', '🤨', () => Math.max(act('browInnerUp'), act2('browOuterUp')), .35],
  ['One brow up', '🧐', () => Math.abs(act('browOuterUpLeft') - act('browOuterUpRight')) * 1.8, .45],
  ['Brows furrowed', '😣', () => act2('browDown') * 1.4, .4],
  ['Mouth open', '😮', () => act('jawOpen'), .25, 'mouth'],
  ['"O" lips', '😯', () => act('mouthFunnel') * 1.5, .4, 'mouth'],
  ['Pucker / kiss', '😗', () => act('mouthPucker'), .5, 'mouth'],
  ['Lips pressed', '😬', () => act2('mouthPress') * 1.5, .45, 'mouth'],
  ['Lip bite / roll', '🫦', () => Math.max(act('mouthRollLower'), act('mouthRollUpper')) * 1.4, .45, 'mouth'],
  ['Chin raised', '🥺', () => act('mouthShrugLower') * 1.4, .45, 'mouth'],
  ['Cheeks puffed', '🐡', () => act('cheekPuff') * 1.5, .35, 'mouth'],
  ['Nose wrinkle', '😖', () => act2('noseSneer') * 1.6, .4],
  ['Upper lip raised', '😒', () => act2('mouthUpperUp') * 1.4, .45, 'mouth'],
  ['Lips stretched', '😬', () => act2('mouthStretch') * 1.8, .4, 'mouth'],
  ['Jaw sideways', '😜', () => Math.max(act('jawLeft'), act('jawRight')) * 2, .35, 'mouth'],
  ['Mouth sideways', '🫤', () => Math.max(act('mouthLeft'), act('mouthRight')) * 2, .4, 'mouth'],
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
  updateLook(face, t, live);

  const e = emotionScores();
  if (live) microStep(e, t);
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

/* ---- micro-expressions (Ekman): a strong expression that flashes for 1/15–1/2 s and vanishes,
   different from what the face is otherwise showing. Measured on the unsmoothed per-frame scores. */
function microStep(raw, t) {
  const M = S.microSt;
  for (const k of ['happy', 'sad', 'angry', 'surprised', 'fear', 'disgust', 'contempt']) {
    const st = M[k];
    if (!st && raw[k] > .55 && S.emo[k] < .3 && S.eye.state === 'open') M[k] = { start: t, peak: raw[k] };
    else if (st) {
      st.peak = Math.max(st.peak, raw[k]);
      if (raw[k] < .3) {
        const dur = t - st.start; delete M[k];
        if (dur >= 60 && dur <= 500 && S.emo[k] < .35) {
          S.micro.unshift({ k, dur: Math.round(dur), t });
          S.micro.length = Math.min(S.micro.length, 6);
          log('emo', `⚡ Micro-expression: a ${Math.round(dur)} ms flash of ${EMO[k].name.toLowerCase()}`);
        }
      } else if (t - st.start > 600) delete M[k]; // lasted too long: a real expression, not a micro one
    }
  }
}

/* ---- alertness & sleep: gather measurements, score them in alertness.js */
function alertStep(t, live) {
  if (!S.face) return;
  const within = (arr, ms) => arr.filter(x => t - x < ms).length;
  const durs = (S.eye.durs || []).filter(d => t - d.t < 60000 && d.dur < 2000);
  const g = S.gazeHist, gm = k => g.reduce((s, x) => s + x[k], 0) / (g.length || 1);
  const gsd = g.length > 20 ? Math.sqrt(g.reduce((s, x) => s + (x[1] - gm(1)) ** 2 + (x[2] - gm(2)) ** 2, 0) / g.length) : 1;
  const H = S.stressHist, speed = H.length ? H.reduce((s, h) => s + h.speed, 0) / H.length : 0;
  const yawningNow = act('jawOpen') > .5 && act2('eyeSquint') + act2('eyeBlink') > .5 && act2('mouthSmile') < .3;
  const photoDroop = clamp((act2('eyeBlink') - .2) / .35); // single photo: can't tell a blink from droop, so modest
  const L = S.look || {};
  const m = {
    live, observedSec: live && S.camStart ? (t - S.camStart) / 1000 : 0,
    perclos: S.perclos || 0, meanBlinkMs: durs.length ? durs.reduce((s, d) => s + d.dur, 0) / durs.length : 130,
    longBlinks2m: within(S.longBlinks, 120000), yawns5m: within(S.yawns, 300000), nodOffs5m: within(S.nodOffs, 300000), microsleeps5m: within(S.microsleeps, 300000),
    droop: live ? clamp((S.lidDroop - .12) / .4) : photoDroop, droopKnown: live && S.calibrated,
    stare: live && S.eye.state === 'open' ? clamp((.03 - gsd) / .02) * clamp((12 - blinkRate()) / 8) : 0,
    dark: L.dark || 0, red: L.red || 0, mouthDroop: S.lower === 'mask' ? 0 : clamp((act2('mouthFrown') - .1) / .3) * (1 - S.emo.sad),
    yawningNow, movement: clamp(speed / 25), arousal: S.emo.happy + S.emo.surprised,
  };
  S.alertM = m;
  S.alert = scoreAlertness(m);
  S.drowsy = 100 - S.alert.score;
  if (live && t - (S.alertHist.at(-1)?.t || 0) > 2000) { S.alertHist.push({ t, s: S.alert.score }); while (S.alertHist.length > 300) S.alertHist.shift(); }
}
function wakeAlarm(why) {
  if (!S.set.alarm) return;
  const st = $('#stage'); st.classList.add('alarm'); setTimeout(() => st.classList.remove('alarm'), 1600);
  try {
    const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sawtooth'; o.connect(g); g.connect(ac.destination); g.gain.value = .12;
    for (let i = 0; i < 8; i++) o.frequency.setValueAtTime(i % 2 ? 520 : 980, ac.currentTime + i * .15);
    o.start(); o.stop(ac.currentTime + 1.2);
  } catch {}
  speak('Wake up! ' + why + ' detected.');
}

/* ---- the mentalist read: fuse every cue into likely states, with reasons and a response hint */
function readMind(t, live) {
  const cues = {};
  // deliberate signals (gestures, hand-on-face) outweigh a resting face, as they would for a clinician
  const cue = (k, v, why, weight = 1) => { if (v > .05) cues[k] = [clamp(v) * weight, why]; };
  if (S.face) {
    for (const k of ['happy', 'sad', 'angry', 'surprised', 'fear', 'disgust', 'contempt'])
      cue(k, (S.emo[k] - .15) / .6, `Face shows ${EMO[k].name.toLowerCase()} (${Math.round(S.emo[k] * 100)}%)`);
    cue('confusedFace', (S.emo.confused - .15) / .5, `Puzzled brows (${Math.round(S.emo.confused * 100)}%)`);
    const g = S.gaze;
    cue('gazeUp', (g.y - .12) / .3, 'Eyes drift upward, which often happens while retrieving a thought');
    cue('gazeSide', (Math.abs(g.x) - .22) / .3, 'Looking away to the side');
    cue('gazeDown', (-g.y - .3) / .3, 'Eyes lowered');
    const br = blinkRate(); cue('blinkFast', (br - 24) / 16, `Blinking fast (${Math.round(br)}/min vs ~15 normal)`);
    cue('drowsy', (S.drowsy - 25) / 50, S.alert?.reasons[0] || 'Eyelids heavy, long closures or yawns');
    cue('stressHigh', (S.stress - 35) / 35, `Several stress signs together (score ${Math.round(S.stress)})`);
    if (S.lower !== 'mask') {
      cue('lipPress', (act2('mouthPress') * 1.5 - .35) / .4, 'Lips pressed together');
      cue('lipBite', (act('mouthRollLower') * 1.4 - .35) / .4, 'Lip biting / lips rolled in');
      cue('suppress', Math.min(act('mouthShrugLower') * 1.4, act2('mouthPress') * 1.5) - .3, 'Chin pushed up with pressed lips: holding an emotion back');
    }
    cue('browFurrow', (act2('browDown') * 1.4 - .35) / .4, 'Brows knitted together');
    if (S.pose) cue('headTilt', (Math.abs(S.pose.roll) - 9) / 12, 'Head tilted to one side');
    if (S.mode === 'camera') cue('lookingAway', (50 - S.attn) / 40, 'Mostly not facing the screen');
    // Duchenne vs social smile: a felt smile also lifts the cheeks and narrows the eyes
    const sm = act2('mouthSmile') * MG(), duch = act2('cheekSquint') + act2('eyeSquint') * .5;
    S.smileType = S.lower === 'mask' ? (S.emo.happy > .4 ? 'eyes are smiling' : '') : sm > .35 ? (duch > .22 ? 'genuine' : 'polite') : '';
    if (S.smileType === 'genuine') cue('genuine', .8, 'Genuine (Duchenne) smile: the eyes smile too');
    if (S.smileType === 'polite') cue('polite', .7, 'Polite smile that doesn\'t reach the eyes');
  }
  const ago = k => t - (S.recent[k] || -1e9);
  if (ago('Nod') < 3000) cue('nod', 1, 'Nodded');
  if (ago('Shake') < 3000) cue('shake', 1, 'Shook head');
  if (ago('Yawn') < 10000) cue('yawn', 1, 'Yawned');
  if (ago('Wave') < 3000) cue('Wave', 1, 'Waving');
  if (ago('Clap') < 3000) cue('Clap', 1, 'Clapping');
  const partLabels = ['Pinched', 'Closed_Fist', 'Open_Palm', 'Four', 'Three', 'Point', 'Pointing_Up', 'Peace_Side', 'Victory', 'L_Shape', 'Pinch', 'Call_Me', 'Thumb_Down', 'Crossed_Fingers'];
  for (const h of S.hands) if (h.label && !h.label.startsWith('custom:') && !S.scene.two && !(S.scene.combos.length && partLabels.includes(h.label))) cue(h.label, h.conf, `${labelName(h.label)}: ${GESTURE_MEANING[h.label] || ''}`, 1.15);
  if (S.scene.two) cue(S.scene.two, 1, `${TWO_HAND[S.scene.two]}: ${GESTURE_MEANING[S.scene.two] || ''}`, 1.4);
  for (const c of S.scene.combos) cue(c.id, c.conf, `${COMBO_NAMES[c.id]}: ${COMBOS[c.id][2]}`, 1.4);

  const ranked = mentalRead({ cues });
  // smooth state scores so the read doesn't flicker
  const a = live ? .3 : 1, E = S.readEma;
  for (const k in E) E[k] *= (1 - a);
  for (const r of ranked) E[r.st] = (E[r.st] || 0) + a * r.s;
  const why = Object.fromEntries(ranked.map(r => [r.st, r.why]));
  S.read = Object.entries(E).filter(([, v]) => v > .12).sort((x, y) => y[1] - x[1]).slice(0, 3)
    .map(([st, v]) => ({ st, conf: clamp(v / 1.4), icon: STATES[st][0], name: STATES[st][1], tip: STATES[st][2], why: why[st] || S.read.find(r => r.st === st)?.why || [] }));

  // mixed signals: when the channels disagree, a good clinician says so rather than picking one
  const mixed = [], neg = ['sad', 'angry', 'disgust', 'contempt'].filter(k => S.emo[k] > .35);
  const posGesture = S.hands.some(h => ['Thumb_Up', 'OK'].includes(h.label)) || S.scene.two === 'Double_Thumbs';
  if (S.face && ago('Nod') < 3000 && neg.length) mixed.push(`Nodding "yes", but the face looks ${EMO[neg[0]].name.toLowerCase()}. They may be agreeing reluctantly.`);
  if (S.face && posGesture && (S.emo.sad > .35 || S.stress > 55)) mixed.push('Positive hand sign, but the face shows sadness or stress. They may be putting on a brave face.');
  if (S.smileType === 'polite' && S.stress > 45) mixed.push('Smiling, but with several stress signs. This could be masking discomfort.');
  if (S.face && ago('Shake') < 3000 && S.emo.happy > .4) mixed.push('Shaking the head while smiling. Probably a playful "no way!", or disbelief.');
  S.mixed = mixed;
}

/* ---- eyes: blink / double / long blink / wink / gaze holds */
function eyeStep(bs, t) {
  const E = S.eye;
  const bL = act('eyeBlinkLeft'), bR = act('eyeBlinkRight');
  // lenses and frames soften the lid signal, so glasses wearers get slightly lower thresholds
  // resting lid level: follows the lids down fast and up slowly, so heavy, sleepy lids still count as 'open'
  const lidNow = (bL + bR) / 2;
  S.lidRest = S.lidRest == null ? lidNow : S.lidRest + (lidNow < S.lidRest ? .2 : .002) * (lidNow - S.lidRest);
  const CLOSE = Math.min(.85, Math.max(S.glasses ? .44 : .5, S.lidRest + .3)), OPEN = Math.min(.7, Math.max(S.glasses ? .28 : .32, S.lidRest + .1));
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
      E.durs = (E.durs || []).filter(d => t - d.t < 120000); E.durs.push({ t, dur });
      if (dur >= 1000 && dur < 2000 && !ep.micro) { fire('Long_Blink', t); S.longBlinks.push(t); }
      else if (dur >= 2000) S.longBlinks.push(t);
      else if (dur < 600) {
        if (t - E.lastBlinkEnd < 650) { fire('Double_Blink', t); E.lastBlinkEnd = -1e9; }
        else E.lastBlinkEnd = t;
      }
    } else if (!ep.both && dur >= 140 && dur <= 2500) {
      if (ep.L && !ep.R) fire('Wink_Left', t);
      else if (ep.R && !ep.L) fire('Wink_Right', t);
    }
  }
  // micro-sleep: both eyes shut for 2 s or more (a deliberate long blink is 1–2 s)
  if (E.ep && E.ep.both && !E.ep.micro && st === 'closed' && t - E.ep.start >= 2000) { E.ep.micro = true; S.microsleeps.push(t); fire('Microsleep', t); wakeAlarm('Micro-sleep'); }
  // sustained upper-lid droop between blinks, relative to this person's calibrated resting lids
  S.lidDroop = S.lidRest;
  S.gazeHist.push([t, S.gaze.x, S.gaze.y]); while (S.gazeHist.length && t - S.gazeHist[0][0] > 10000) S.gazeHist.shift();
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
  const past = Hd.hist.find(h => t - h.t <= 800);
  if (past && past.pitch - p.pitch > 14 && act2('eyeBlink') > .3 && t - (Hd.lastNodOff || -1e9) > 4000) {
    Hd.lastNodOff = t; S.nodOffs.push(t); fire('Nod_Off', t); wakeAlarm('Nodding off');
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
  if (S.lower === 'mask') { delete comp['Lip press / bite']; delete w['Lip press / bite']; }
  const wSum = Object.values(w).reduce((a, b) => a + b, 0);
  S.stressComp = comp;
  S.stress = 100 * Object.keys(w).reduce((s, k) => s + w[k] * comp[k], 0) / wSum;
  const cl = S.eye.closedHist, perclos = cl.length ? cl.reduce((s, c) => s + c[1], 0) / cl.length : 0;
  const recentY = S.yawns.filter(y => t - y < 120000).length, recentL = S.longBlinks.filter(y => t - y < 120000).length;
  S.perclos = perclos;
  if (!S.alert) S.drowsy = 100 * clamp(N(perclos, .2) * .6 + recentY * .15 + recentL * .08);
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
  const g = handGeom(h, overlay.width || 1280, overlay.height || 720);
  const pf = palmFacing(h.wlm, h.side);
  const base = { ...h, f, g, palmUp: pf.up > .55, palmUpness: pf.up, palmCamera: pf.camera, count: [f.T, f.I, f.M, f.R, f.P].filter(Boolean).length };
  let label = null, src = '', conf = 0;
  const extra = extraShape(base, g);
  if (cm) { label = 'custom:' + cm.c.id; src = 'your sign'; conf = clamp(1 - cm.d / S.set.strict * .6); }
  else if (extra) { label = extra; src = 'hand shape'; conf = .75; }
  else if (h.model.categoryName !== 'None' && h.model.score > .55) { label = h.model.categoryName; src = 'model'; conf = h.model.score; }
  else { const s = shapeGesture(h.wlm, h.lm, f); if (s) { label = s; src = 'hand shape'; conf = .7; } }
  return { ...base, feat, label, src, conf };
}
const labelName = l => l?.startsWith('custom:') ? '✋ ' + (S.custom.find(c => 'custom:' + c.id === l)?.name || 'custom')
  : (HAND_SIGNS[l] || TWO_HAND[l] || COMBO_NAMES[l] || l || '—');

function analyzeHands(hands, t, live) {
  S.hands = hands.map(classifyHand);
  if (S.rec && S.hands.length) {
    if (t > S.rec.start) S.rec.samples.push(S.hands[0].feat);
    if (t > S.rec.start + 3000) finishRecording();
  }
}

/* ---- scene: two-hand gestures, hand↔face combos, motion; then hold-to-type on the strongest label */
function comboContext() {
  if (!S.bs) return {};
  const smile = S.lower === 'mask' ? S.emo.happy : act2('mouthSmile') * MG();
  return { smile, eyesClosed: act2('eyeBlink'), lowLids: act2('eyeBlink') * 1.3, wide: act2('eyeWide') * 1.6, surprised: S.emo.surprised,
    frown: act2('mouthFrown') * 1.6, browDown: act2('browDown') * 1.4, jawOpen: act('jawOpen'), pucker: act('mouthPucker'), confusedBrow: S.emo.confused };
}
function analyzeScene(face, t, live) {
  let fg = face ? faceGeom(face.lm, overlay.width, overlay.height) : null;
  if (fg) { S.lastFg = fg; S.lastFgT = t; S.lastCx = comboContext(); }
  // Hands over the face often make the face tracker lose it. For a moment, keep using where the face was.
  const occluded = !fg && live && S.lastFg && t - S.lastFgT < 3000 && S.hands.some(h => {
    const q = S.lastFg.toFace(h.g.palm); return Math.abs(q.u) < 1.1 && q.v > -.2 && q.v < 1.2 && h.g.pl / S.lastFg.fw > .3;
  });
  if (occluded) fg = S.lastFg;
  for (const h of S.hands) h.touch = fg ? contacts(h, fg) : {};
  let two = S.hands.length === 2 ? twoHand(S.hands[0], S.hands[1], fg) : null;
  if (!two && S.hands.length === 1 && prayerSingle(S.hands[0], fg)) two = 'Prayer';
  let cmb = fg && S.hands.length ? combos(S.hands, fg, face ? comboContext() : S.lastCx || {}) : [];
  if (two) cmb = []; // the hands are busy making a two-hand sign
  // with the face hidden, expression-based readings are guesses; hiding the face is the signal
  if (occluded) cmb = [{ id: 'Face_Hidden', conf: .8 }];
  S.scene = { fg, two, combos: cmb };
  const prev = S.lastScene || {};
  if (two && two !== prev.two) log('hand', `${TWO_HAND[two]}: ${GESTURE_MEANING[two] || ''}`);
  if (cmb[0] && cmb[0].id !== prev.combo) log('emo', `${COMBO_NAMES[cmb[0].id]}: ${COMBOS[cmb[0].id][2]}`);
  S.lastScene = { two, combo: cmb[0]?.id };
  if (!live) return;
  for (const ev of S.motion(S.hands, t)) { S.recent[ev] = t; fire(ev, t); }
  // priority: two-hand gesture > hand-on-face combo > single-hand sign
  const primary = S.hands.find(h => h.label);
  holdStep(two || (cmb[0]?.conf > .5 ? cmb[0].id : null) || primary?.label || null, t);
}
function holdStep(label, t) {
  const H = S.hold;
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
  const isHand = trigger in HAND_SIGNS || trigger in TWO_HAND || trigger in COMBOS || trigger.startsWith('custom:');
  let phrase = '', name;
  if (trigger.startsWith('custom:')) { const c = S.custom.find(c => 'custom:' + c.id === trigger); phrase = c?.phrase || ''; name = '✋ ' + (c?.name || 'custom sign'); }
  else { phrase = S.map[trigger] || ''; name = labelName(trigger) !== trigger ? labelName(trigger) : EYE_HEAD[trigger] || trigger; }
  S.recent[trigger] = t;
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
  // hand-on-face contact: ring the touched zone, name the combo above the head
  const fg = S.scene.fg;
  if (fg && S.scene.combos.length) {
    for (const h of S.hands) for (const [zn, c] of Object.entries(h.touch || {})) {
      if (c.s < .35) continue;
      const z = fg.zones[zn];
      octx.strokeStyle = `rgba(167,139,250,${.35 + c.s * .6})`; octx.lineWidth = 3 * sc;
      octx.beginPath(); octx.arc(z.x, z.y, z.r * .8, 0, Math.PI * 2); octx.stroke();
    }
    const c = S.scene.combos[0], hp = fg.zones.headTop;
    drawText(hp.x - 120 * sc, hp.y - 10 * sc, COMBO_NAMES[c.id], '#c4b5fd', 26 * sc);
  }
  if (S.scene.two && S.hands.length === 2) {
    const m = S.hands.map(h => h.g.palm), x = (m[0].x + m[1].x) / 2, y = Math.min(...S.hands.flatMap(h => h.g.p.map(p => p.y)));
    drawText(x - 110 * sc, y - 44 * sc, TWO_HAND[S.scene.two], '#5eead4', 28 * sc);
  }
}

/* ------------------------------------------------------------------ UI updates */
function updateUI(t) {
  const hud = [];
  if (S.mode === 'camera') hud.push(`${Math.round(S.fps)} fps`);
  hud.push(S.face ? 'face ✓' : 'no face'); hud.push(`${S.hands.length} hand${S.hands.length === 1 ? '' : 's'}`);
  if (!S.calibrated && S.mode === 'camera') hud.push('not calibrated');
  if (S.face && S.lower === 'beard') hud.push('🧔 beard mode');
  if (S.face && S.lower === 'mask') hud.push('😷 eyes-only mode');
  if (S.face && S.glasses) hud.push('👓');
  if (S.mode === 'camera' && S.light.boost > 1.05) hud.push(`💡 boost ×${S.light.boost.toFixed(1)}`);
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
  $('#chips').innerHTML = FACE_ACTIONS.map(([n, ic, f, thr, part]) => {
    if (S.lower === 'mask' && part === 'mouth') return `<div class="chip hidden" title="Hidden by face covering">${ic} ${n}<small> · covered</small></div>`;
    const v = S.bs ? clamp(f()) : 0;
    return `<div class="chip ${v > thr ? 'on' : ''}">${ic} ${n}<div class="m" style="width:${(v * 100).toFixed(0)}%"></div></div>`;
  }).join('');
  renderLook();

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
  drawCircumplex(); drawTimeline(); renderMind(); renderAlert();
  const tot = Object.values(S.sessionCounts).reduce((a, b) => a + b, 0);
  if (tot) $('#sessionSum').textContent = 'Session: ' + Object.entries(S.sessionCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${EMO[k].icon} ${Math.round(v / tot * 100)}%`).join(' · ');
}

function renderLook() {
  const L = S.look, on = S.face && L;
  const items = [
    ['🧔', 'Beard', L?.beard, S.lower === 'beard' && L?.beard > .5], ['👨', 'Moustache', L?.moustache, S.lower === 'beard' && L?.moustache > .55],
    ['😷', 'Mask / covering', L?.mask, S.lower === 'mask'], ['👓', 'Glasses', L?.glasses, S.glasses],
    ['💡', S.light.boost > 1.05 ? `Low light · boost ×${S.light.boost.toFixed(1)}` : 'Lighting OK', on ? clamp(S.light.L / 160) : 0, S.light.boost > 1.05],
  ];
  $('#looks').innerHTML = items.map(([ic, n, v, flag]) => `<div class="look ${on && flag ? 'on' : ''}">${ic} ${n}<div class="track"><i style="width:${on ? Math.round(clamp(v || 0) * 100) : 0}%"></i></div></div>`).join('');
  const src = S.set.cover === 'auto' ? 'auto-detected' : 'set manually';
  $('#lookMode').textContent = !on ? '—' : S.lower === 'mask' ? 'eyes & brows mode' : S.lower === 'beard' ? 'beard-adapted' : 'full face';
  $('#lookNote').textContent = !on ? 'Shows what the camera can see of the face, and how the reading adapts.' :
    S.lower === 'mask' ? `Mouth covered (${src}). Emotions are read from eyes, brows and cheeks: smiling eyes, raised or knitted brows, widened eyes. Mouth actions are greyed out.` :
    S.lower === 'beard' ? `Beard or moustache (${src}). Lip movement is harder to see, so mouth signals are amplified ×1.45 and smiling-eye cues count more. Calibrate your neutral face for best results.` :
    'Whole face visible. All mouth, eye and brow signals are in use.' + (S.glasses ? ' Glasses detected, so blink thresholds are relaxed.' : '');
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
function renderAlert() {
  const A = S.alert, on = S.face && A;
  $('#nEnergy').textContent = on ? A.icon + ' ' + A.level : '—';
  $('#nEnergyS').textContent = on ? 'alertness ' + A.score + '/100' + (A.measuring ? ' · measuring…' : '') : '';
  $('#aIcon').textContent = on ? A.icon : '·';
  $('#aScore').textContent = on ? A.score : '–';
  $('#aLevel').textContent = on ? A.level + (A.measuring ? ' (still measuring, give it ~20 s)' : '') : 'Waiting for a face…';
  $('#aAdvice').textContent = on ? A.advice : '';
  $('#aBar').style.width = on ? A.score + '%' : '0';
  $('#aBar').style.background = !on ? '' : A.score >= 72 ? 'var(--teal)' : A.score >= 58 ? 'var(--lime)' : A.score >= 42 ? 'var(--amber)' : 'var(--rose)';
  $('#aWhy').innerHTML = on && A.reasons.length ? A.reasons.map(r => '<div>' + esc(r) + '</div>').join('') : on ? '<div>No drowsiness signs right now.</div>' : '';
  $('#aRest').textContent = on ? A.restVerdict[0] + ' ' + A.restVerdict[1] : '—';
  $('#aRestWhy').innerHTML = on ? (A.restReasons.length ? A.restReasons : ['Eyelids open normally, no dark circles or redness detected']).map(r => '<div>' + esc(r) + '</div>').join('') : '';
  const m = S.alertM || {}, lv = on && m.live;
  const sig = [
    ['Eyes-closed time (PERCLOS)', m.perclos / .3, on ? Math.round((m.perclos || 0) * 100) + '%' : '–'],
    ['Average blink length', ((m.meanBlinkMs || 0) - 100) / 400, lv ? Math.round(m.meanBlinkMs) + ' ms' : '–'],
    ['Long closures (2 min)', (m.longBlinks2m || 0) / 5, lv ? m.longBlinks2m : '–'],
    ['Yawns (5 min)', (m.yawns5m || 0) / 4, lv ? m.yawns5m : '–'],
    ['Eyelid droop', m.droop, on ? Math.round((m.droop || 0) * 100) + '%' : '–'],
    ['Dark circles', m.dark, on ? Math.round((m.dark || 0) * 100) + '%' : '–'],
    ['Red eyes', m.red, on ? Math.round((m.red || 0) * 100) + '%' : '–'],
    ['Glazed stare', m.stare, lv ? Math.round((m.stare || 0) * 100) + '%' : '–'],
    ['Nod-offs / micro-sleeps (5 min)', ((m.nodOffs5m || 0) + (m.microsleeps5m || 0)) / 2, lv ? m.nodOffs5m + ' / ' + m.microsleeps5m : '–'],
  ];
  $('#aSigns').innerHTML = sig.map(([k, v, txt]) => '<div class="bar"><span>' + k + '</span><div class="track"><div class="fill" style="width:' + (on ? clamp(v || 0) * 100 : 0) + '%;background:var(--sky)"></div></div><span class="pct">' + txt + '</span></div>').join('');
  // alertness over the session
  const c = $('#aHist'), w = c.clientWidth, h = c.clientHeight; if (!w) return;
  const dpr = devicePixelRatio || 1; if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
  const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  for (const [lvl, col] of [[72, '#2dd4bf55'], [42, '#f5b45455']]) { x.fillStyle = col; x.fillRect(0, h - lvl / 100 * h, w, 1); }
  const Hh = S.alertHist; if (Hh.length < 2) return;
  x.beginPath(); Hh.forEach((p, i) => { const px = i / (Hh.length - 1) * w, py = h - p.s / 100 * h; i ? x.lineTo(px, py) : x.moveTo(px, py); });
  x.strokeStyle = '#60a5fa'; x.lineWidth = 2; x.stroke();
}
function renderMind() {
  const r = S.read, top = r[0], any = S.face || S.hands.length;
  $('#mIcon').textContent = top && any ? top.icon : '·';
  $('#mName').textContent = top && any ? top.name : any ? 'Calm, neutral baseline' : 'Waiting for a face or hands…';
  $('#mTip').textContent = top && any ? '💬 ' + top.tip : any ? 'Nothing stands out right now.' : 'Face, eyes, head and hands are read together, the way a clinician would.';
  $('#mConf').textContent = top && any ? `${Math.round(top.conf * 100)}% confidence` : '—';
  $('#mWhy').innerHTML = top && any ? top.why.map(w => `<div>${esc(w)}</div>`).join('') : '';
  $('#mMixed').innerHTML = any && S.mixed.length ? '⚠️ <b>Mixed signals.</b> ' + S.mixed.map(esc).join(' ') : '';
  $('#mAlt').innerHTML = any && r.length > 1 ? 'Also possible: ' + r.slice(1).map(x => `<span>${x.icon} ${esc(x.name)} ${Math.round(x.conf * 100)}%</span>`).join('') : '';
  const chips = [];
  if (S.scene.two) chips.push(`<span>${TWO_HAND[S.scene.two]}</span>`);
  for (const c of S.scene.combos) chips.push(`<span class="combo">${COMBO_NAMES[c.id]}</span>`);
  const parts = ['Pinched', 'Closed_Fist', 'Open_Palm', 'Four', 'Three', 'Point', 'Pointing_Up', 'L_Shape', 'Pinch', 'Call_Me', 'Thumb_Down', 'Crossed_Fingers'];
  for (const h of S.hands) if (h.label && !(S.scene.two && h.label !== S.scene.two) && !(S.scene.combos.length && parts.includes(h.label))) chips.push(`<span>${esc(labelName(h.label))}</span>`);
  $('#mGest').innerHTML = chips.join('');
  $('#sceneRow').innerHTML = chips.join('') || '<span class="sub" style="margin:0">No two-hand or hand-on-face gesture right now.</span>';
  $('#mSmile').textContent = S.smileType === 'genuine' ? '😊 Genuine (Duchenne) smile' : S.smileType === 'polite' ? '🙂 Polite / social smile' : S.smileType ? '😊 Smiling eyes' : '';
  const m = S.micro.filter(x => now() - x.t < 20000);
  $('#mMicro').textContent = m.length ? '⚡ Micro-expressions: ' + m.map(x => `${EMO[x.k].icon} ${x.dur} ms`).join(', ') : '';
}
function renderGuide() {
  const sec = (title, set, meaning) => `<h4>${title}</h4>` + Object.entries(set).map(([k, n]) => `<div><b>${n}</b><span>${esc(meaning(k) || '')}</span></div>`).join('');
  $('#guide').innerHTML = sec('One hand', HAND_SIGNS, k => GESTURE_MEANING[k]) + sec('Two hands & motion', TWO_HAND, k => GESTURE_MEANING[k])
    + sec('Hand + face (read with the expression)', COMBO_NAMES, k => COMBOS[k][2]) + sec('Eyes & head', EYE_HEAD, () => '');
}
function renderMap() {
  const rows = [['Hand signs', HAND_SIGNS], ['Two hands & motion', TWO_HAND], ['Hand + face', COMBO_NAMES], ['Eye & head', EYE_HEAD]].map(([title, set]) =>
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
    face: S.face, emotion: S.emoTop, lower: S.lower, glasses: S.glasses,
    look: S.look && Object.fromEntries(['beard', 'moustache', 'mask', 'glasses'].map(k => [k, +S.look[k].toFixed(2)])), emo: Object.fromEntries(Object.entries(S.emo).map(([k, v]) => [k, +v.toFixed(3)])),
    pose: S.pose && Object.fromEntries(Object.entries(S.pose).map(([k, v]) => [k, +v.toFixed(1)])),
    actions: S.bs ? FACE_ACTIONS.filter(([, , f, thr]) => f() > thr).map(a => a[0]) : [],
    hands: S.hands.map(h => ({ side: h.side, label: h.label, src: h.src, model: h.model.categoryName, fingers: h.f, palmUp: h.palmUp,
      touch: Object.entries(h.touch || {}).filter(([, c]) => c.s > .3).map(([z, c]) => `${z}:${c.part}:${c.s.toFixed(2)}`).join(' ') })),
    two: S.scene.two, combos: S.scene.combos.map(c => c.id + ' ' + c.conf.toFixed(2)),
    alert: S.alert && { score: S.alert.score, level: S.alert.level, rest: S.alert.restVerdict[1], rr: S.alert.restReasons, why: S.alert.reasons, dark: +S.alertM.dark.toFixed(2), red: +S.alertM.red.toFixed(2), droop: +S.alertM.droop.toFixed(2) },
    read: S.read.map(r => `${r.name} ${Math.round(r.conf * 100)}%`), mixed: S.mixed, smile: S.smileType,
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
  const sel = (id, key) => { const el = $(id); el.value = S.set[key]; el.onchange = () => { S.set[key] = el.value; store.set(key, el.value); applyLookMode(); updateUI(now()); }; };
  sel('#sCover', 'cover'); sel('#sGlasses', 'glassesSet');
  $('#sLow').checked = S.set.lowLight;
  $('#aAlarm').checked = S.set.alarm;
  $('#aAlarm').onchange = e => { S.set.alarm = e.target.checked; store.set('alarm', S.set.alarm); if (S.set.alarm) toast('Wake-up alarm on'); };
  $('#sLow').onchange = e => { S.set.lowLight = e.target.checked; store.set('lowLight', S.set.lowLight); if (!S.set.lowLight) S.light.boost = 1; };
  $('#sVoice').onchange =e => { S.set.voice = e.target.value; store.set('voice', S.set.voice); };
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
  renderMap(); renderGuide(); renderCustom(); renderSentence(); $('#sentence').innerHTML = $('#sentence').innerHTML.replace('Sentence is empty.', 'Hold a hand sign (👍 = Yes, ✊ = I need help, ✌️ = Thank you…), nod or shake your head, or tap a phrase below.');
  updateUI(now());
}
wire();

// Test/automation hook
window.__BHAAV = { S, alertStep, temporalStep, computeIndicators, scoreAlertness, readMind, analyzeScene, holdStep, microStep, analyzePhoto, summary, fire, classifyHand, shapeGesture, fingerStates, eyeStep, headStep, emotionScores, act, frame, startCalibration, finishCalibration };
