// reading.js — BHAAV's body-language layer.
// Extra single-hand signs (Gen-Z / K-pop), two-hand gestures, motion gestures, hand↔face contact combos,
// and a "mentalist" read that fuses face, eyes, head and hands into a likely state with reasons.
// Pure functions over landmarks so they can be tested on photos and synthetic data.

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mid = (a, b, t = .5) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const off = (p, u, s) => ({ x: p.x + u.x * s, y: p.y + u.y * s });
const avg = ps => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length });
const TIPS = [4, 8, 12, 16, 20];

/* ------------------------------------------------------------------ face zones */
export function faceGeom(lm, W, H) {
  const P = i => ({ x: lm[i].x * W, y: lm[i].y * H });
  const A = P(234), B = P(454), top = P(10), chin = P(152);
  const fw = d2(A, B), fh = d2(top, chin);
  const up = { x: (top.x - chin.x) / fh, y: (top.y - chin.y) / fh }, side = { x: (B.x - A.x) / fw, y: (B.y - A.y) / fw };
  // A-side = image-left in the raw frame (the person's right); B-side = image-right (the person's left)
  const z = (p, r) => ({ ...p, r: r * fw });
  const zones = {
    headTop: z(off(top, up, fh * .32), .42),
    forehead: z(mid(P(10), P(9)), .3),
    templeA: z(off(P(54), side, fw * .02), .2), templeB: z(off(P(284), side, -fw * .02), .2),
    eyeA: z(mid(P(33), P(133)), .16), eyeB: z(mid(P(362), P(263)), .16),
    noseBridge: z(P(168), .11), nose: z(P(1), .13),
    mouth: z(mid(P(13), P(14)), .18),
    chin: z(off(chin, up, -fh * .06), .22),
    cheekA: z(P(205), .2), cheekB: z(P(425), .2),
    jawA: z(P(172), .18), jawB: z(P(397), .18),
    earA: z(off(A, side, -fw * .1), .2), earB: z(off(B, side, fw * .1), .2),
    neck: z(off(chin, up, -fh * .45), .3),
    chest: z(off(chin, up, -fh * 1.3), .6),
  };
  const centre = mid(A, B);
  // face coordinates: u = across the face (−1 image-left edge … +1 image-right edge), v = up the face (0 chin … 1 hairline)
  const toFace = p => ({ u: ((p.x - centre.x) * side.x + (p.y - centre.y) * side.y) / (fw / 2), v: ((p.x - chin.x) * up.x + (p.y - chin.y) * up.y) / fh });
  return { fw, fh, up, side, zones, top, chin, centre, toFace };
}

/* ------------------------------------------------------------------ hand geometry & extra shapes */
export function handGeom(h, W, H) {
  const p = h.lm.map(q => ({ x: q.x * W, y: q.y * H }));
  const pl = d2(p[0], p[9]) || 1;
  return { p, pl, palm: avg([0, 5, 9, 13, 17].map(i => p[i])), tipsC: avg(TIPS.map(i => p[i])) };
}
function dirDeg(a, b) { return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; } // 0 = right, -90 = up
const horizontal = (a, b) => { const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y); return dx > dy * 1.4; };

// Extra single-hand signs checked before the basic finger-count table. Returns a label or null.
export function extraShape(h, g) {
  const f = h.f, w = h.wlm, pw = d3(w[0], w[9]) || 1, p = g.p, pl = g.pl;
  const curled3 = !f.M && !f.R && !f.P;
  // 🤌 pinched fingers: all five tips bunched together, held away from the palm
  const tc = avg(TIPS.map(i => p[i]));
  const spread = Math.max(...TIPS.map(i => d2(p[i], tc)));
  if (spread < pl * .32 && d2(tc, p[0]) > pl * 1.05) return 'Pinched';
  // 🫰 finger heart: thumb pad rests on the index's middle joint, index half-extended, other fingers curled,
  // thumb reaching up. (Thumbs-up: thumb far from the index. Fist: index folded back, thumb tucked.)
  if (curled3 && Math.min(d3(w[4], w[7]), d3(w[4], w[6])) < pw * .45 && d3(w[4], w[7]) <= d3(w[4], w[8]) * 1.15
      && d3(w[0], w[8]) > d3(w[0], w[6]) * .75 && d3(w[0], w[12]) < d3(w[0], w[10]) * .85 && d3(w[0], w[4]) > d3(w[0], w[5]) * 1.25) return 'Finger_Heart';
  // 🤞 crossed fingers: index and middle up and crossed (tips swap sides relative to their knuckles)
  if (!f.R && !f.P && d2(p[8], p[12]) < pl * .4 && d2(p[8], p[0]) > pl * 1.2 && d2(p[12], p[0]) > pl * 1.2) {
    const ax = { x: p[17].x - p[5].x, y: p[17].y - p[5].y }, pr = q => q.x * ax.x + q.y * ax.y;
    if (Math.sign(pr(p[9]) - pr(p[5])) !== Math.sign(pr(p[12]) - pr(p[8])) && Math.abs(pr(p[12]) - pr(p[8])) > 1) return 'Crossed_Fingers';
  }
  const code = [f.T, f.I, f.M, f.R, f.P].map(Number).join('');
  // 🫵 pointing at the camera: index straight in 3D but strongly foreshortened in the image
  if ((code === '01000' || code === '11000') && d2(p[5], p[8]) < pl * .45 && d3(w[5], w[8]) > pw * .55) return 'Point_You';
  if (code === '11000' && horizontal(p[5], p[8])) return 'Finger_Gun';
  if (code === '11100' && horizontal(p[5], p[8])) return 'Finger_Gun';
  if (code === '01100' && horizontal(p[5], p[8])) return 'Peace_Side';
  if (code === '00100') return 'Middle_Finger';
  if (code === '11111' || code === '01111') {
    const g1 = d2(p[8], p[12]), g2 = d2(p[12], p[16]), g3 = d2(p[16], p[20]);
    if (g2 > 1.9 * g1 && g2 > 1.9 * g3 && g2 > pl * .35) return 'Vulcan';
  }
  return null;
}

/* ------------------------------------------------------------------ two-hand gestures */
function segCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
export function twoHand(A, B, face) {
  if (!A || !B) return null;
  const a = A.g.p, b = B.g.p, pl = (A.g.pl + B.g.pl) / 2;
  const same = l => A.label === l && B.label === l;
  const above = face ? Math.max(a[0].y, b[0].y) < face.top.y - face.fh * .1 : false;
  // 🫶 heart hands: thumb tips meet at the bottom, index tips meet at the top
  const thumbs = d2(a[4], b[4]), idx = d2(a[8], b[8]);
  if (thumbs < pl * .55 && idx < pl * .55 && (a[8].y + b[8].y) / 2 < (a[4].y + b[4].y) / 2 - pl * .25) return above ? 'Big_Heart' : 'Heart_Hands';
  // 💞 big heart over the head: both hands up above the head with fingertips touching
  if (above && Math.min(...TIPS.flatMap(i => TIPS.map(j => d2(a[i], b[j])))) < pl * .5) return 'Big_Heart';
  // 🙏 palms together
  const opened = h => h.count >= 3;
  if (opened(A) && opened(B) && d2(a[12], b[12]) < pl * .5 && d2(a[0], b[0]) < pl * 1.1 && a[12].y < a[0].y && b[12].y < b[0].y) return 'Prayer';
  // steepled fingers: matching fingertips touch, palms apart
  const tipPairs = [4, 8, 12, 16, 20].filter(i => d2(a[i], b[i]) < pl * .35).length;
  if (tipPairs >= 3 && d2(A.g.palm, B.g.palm) > pl * 1.1) return 'Steeple';
  // ✖️ crossed X: forearm lines (wrist → middle knuckle → tip) intersect at a real angle
  const la = [a[0], a[A.f.I && !A.f.M ? 8 : 12]], lb = [b[0], b[B.f.I && !B.f.M ? 8 : 12]];
  const ang = Math.abs(((dirDeg(la[0], la[1]) - dirDeg(lb[0], lb[1])) % 180 + 180) % 180);
  if (segCross(la[0], la[1], lb[0], lb[1]) && ang > 45 && ang < 135) return (A.label === 'Point' || A.label === 'Pointing_Up') ? 'X_Fingers' : 'X_Hands';
  if (same('Thumb_Up')) return 'Double_Thumbs';
  if (same('Victory') || same('Peace_Side')) return 'Double_Peace';
  if (same('Finger_Heart')) return 'Double_Finger_Heart';
  if ((A.label === 'Finger_Gun' || A.label === 'Point_You') && (B.label === 'Finger_Gun' || B.label === 'Point_You')) return 'Double_Guns';
  if (same('L_Shape') && d2(A.g.palm, B.g.palm) > pl * 2) return 'Photo_Frame';
  if (face && A.count >= 4 && B.count >= 4 && a[9].y < face.chin.y - face.fh * .3 && b[9].y < face.chin.y - face.fh * .3
      && d2(A.g.palm, face.centre) > face.fw * .7 && d2(B.g.palm, face.centre) > face.fw * .7) return 'Hands_Up';
  if (face && same('Closed_Fist') && a[0].y < face.chin.y && b[0].y < face.chin.y && d2(A.g.palm, face.centre) > face.fw * .8 && d2(B.g.palm, face.centre) > face.fw * .8) return 'Fists_Up';
  // 🤷 shrug: two open palms facing up, spread out below the face
  if (face && A.count >= 3 && B.count >= 3 && (A.palmUp || B.palmUp) && A.palmUpness + B.palmUpness > .6) {
    const qa = face.toFace(A.g.palm), qb = face.toFace(B.g.palm);
    if (qa.v < .65 && qb.v < .65 && qa.v > -2.5 && qb.v > -2.5 && Math.sign(qa.u) !== Math.sign(qb.u) && Math.min(Math.abs(qa.u), Math.abs(qb.u)) > .9) return 'Shrug';
  }
  return null;
}

// palm normal from world landmarks; returns {up, camera} ≈ how much the palm faces up / faces the camera
export function palmFacing(w, side) {
  const u = { x: w[5].x - w[0].x, y: w[5].y - w[0].y, z: w[5].z - w[0].z }, v = { x: w[17].x - w[0].x, y: w[17].y - w[0].y, z: w[17].z - w[0].z };
  let n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
  const L = Math.hypot(n.x, n.y, n.z) || 1, s = side === 'Right' ? 1 : -1; // `side` is the anatomical hand (already un-mirrored)
  n = { x: n.x / L * s, y: n.y / L * s, z: n.z / L * s };
  return { up: n.y, camera: n.z };
}

/* ------------------------------------------------------------------ hand ↔ face contact */
const PARTS = { tips: TIPS, index: [8], thumb: [4], knuckles: [5, 6, 9, 10, 13, 14, 17, 18] };
export function contacts(h, face) {
  const g = h.g, ratio = g.pl / face.fw;
  // A hand much bigger than the face is close to the camera (showing a sign), not touching the face.
  if (ratio < .28 || ratio > 1.25) return {};
  const out = {};
  for (const [zn, z] of Object.entries(face.zones)) {
    let best = 0, part = '';
    const test = (pt, pn) => { const s = clamp(1 - d2(pt, z) / z.r); if (s > best) { best = s; part = pn; } };
    test(g.palm, 'palm');
    for (const [pn, idx] of Object.entries(PARTS)) for (const i of idx) test(g.p[i], pn);
    if (best > 0) out[zn] = { s: best, part };
  }
  return out;
}

/* ------------------------------------------------------------------ hand + face combos */
// Each combo: [id, icon, name, meaning]. Meanings are what a careful observer would say, not certainties.
export const COMBOS = {
  Facepalm: ['🤦', 'Facepalm', 'Frustration or embarrassment, like "I can\'t believe this"'],
  Forehead_Think: ['🤔', 'Hand on forehead', 'Thinking hard or trying to remember something'],
  Forehead_Overwhelmed: ['😩', 'Hand on forehead, eyes shut', 'Overwhelmed, headache or "this is too much"'],
  Forehead_Oops: ['🤭', 'Hand on forehead with a smile', '"Oops, silly me", a playful mistake'],
  Temple_Think: ['🧠', 'Finger to temple', 'Recalling or concentrating. With a grin: "smart idea!"'],
  Temples_Both: ['💆', 'Both hands on temples', 'Stress, headache or mental overload'],
  Chin_Think: ['🤔', 'Hand on chin', 'Contemplating, weighing options'],
  Chin_Evaluate: ['🧐', 'Finger along cheek, thumb under chin', 'Critical evaluation: judging what they hear'],
  Chin_Rest: ['😪', 'Head resting on hand', 'Bored, tired or daydreaming'],
  Flower_Pose: ['🌸', 'Flower pose (both hands under chin)', 'Aegyo: cute, playful, "look at me"'],
  Chin_Both_Think: ['🤔', 'Both hands at chin', 'Deep in thought, or waiting expectantly'],
  Mouth_Shock: ['😱', 'Hand over mouth, eyes wide', 'Shock or a gasp: something surprising or upsetting'],
  Mouth_Giggle: ['🤭', 'Covering a smile', 'Giggling, shy or embarrassed laughter'],
  Mouth_Hold: ['🤐', 'Hand over mouth', 'Holding back words, hesitating or unsure what to say'],
  Shh: ['🤫', 'Finger on lips', '"Shh!" Be quiet, or it\'s a secret'],
  Nail_Bite: ['😬', 'Fingers at teeth', 'Nervous or anxious (nail-biting)'],
  Kiss: ['😘', 'Blowing a kiss', 'Affection, flirting, "love you"'],
  Nose_Touch: ['🤥', 'Touching nose', 'Self-soothing or uncertainty. Not a reliable lie sign'],
  Nose_Pinch: ['😩', 'Pinching bridge of nose', 'Fatigue, frustration or a headache'],
  Eye_Rub: ['😪', 'Rubbing eyes', 'Tired or sleepy, or wiping tears'],
  Cover_Eyes: ['🙈', 'Covering eyes', 'Can\'t watch, embarrassed, or playing peekaboo'],
  Peace_Eye: ['✌️', 'Peace sign by the eye', 'Playful and cute ("gyaru peace")'],
  Cheek_Poke: ['☝️', 'Finger poking cheek', 'Aegyo: acting cute, "am I cute?"'],
  Cheek_Heart: ['🫰', 'Finger heart by the cheek', 'Cute affection, K-pop style'],
  Cheek_Fond: ['🥰', 'Hand on cheek, smiling', 'Fond, charmed, "aww"'],
  Cheek_Bored: ['😑', 'Cheek resting on hand', 'Bored, daydreaming or waiting'],
  Cheeks_Shock: ['😱', 'Both hands on cheeks, mouth open', 'Shocked! ("Home Alone" face)'],
  Cheeks_Delight: ['🥰', 'Both hands on cheeks, smiling', 'Delighted, touched, "so cute!"'],
  Ear_Listen: ['👂', 'Hand cupped at ear', 'Listening closely, or "I can\'t hear you"'],
  Ears_Cover: ['🙉', 'Covering both ears', 'Too loud, or "I don\'t want to hear it"'],
  Head_Scratch: ['🤔', 'Scratching head', 'Confused or puzzled'],
  Head_Oops: ['😅', 'Hand on head, smiling', 'Embarrassed, "oops, my bad"'],
  Hands_Behind_Head: ['😎', 'Hands behind head', 'Relaxed, confident, at ease'],
  Salute: ['🫡', 'Salute', 'Respect, "yes, sir!" or "got it"'],
  Loser: ['🫲', '"L" on forehead', '"Loser!" Teasing'],
  Hand_Heart: ['🫶', 'Hand on heart', 'Sincerity, gratitude or love'],
  Fist_Chest: ['✊', 'Fist on chest', 'Determination, pride or heartfelt respect'],
  Neck_Touch: ['😣', 'Touching neck', 'Discomfort or self-soothing under stress'],
  Point_Self: ['👉', 'Pointing at self', '"Me?" or "I…"'],
  Face_Hidden: ['🙈', 'Hiding face in hands', 'Embarrassed, upset, crying or overwhelmed'],
};

export function combos(hands, face, cx) {
  if (!face) return [];
  const out = [], add = (id, conf) => conf > .35 && out.push({ id, conf: clamp(conf) });
  const T = hands.map(h => h.touch || {});
  const touching = i => Math.max(0, ...Object.values(T[i]).map(c => c.s));
  const { smile = 0, eyesClosed = 0, wide = 0, surprised = 0, frown = 0, browDown = 0, jawOpen = 0, pucker = 0, confusedBrow = 0, lowLids = 0 } = cx;
  const Q = hands.map(h => ({
    palm: face.toFace(h.g.palm), tips: face.toFace(h.g.tipsC), idx: face.toFace(h.g.p[8]), thumb: face.toFace(h.g.p[4]),
    v2: face.toFace(mid(h.g.p[8], h.g.p[12])),
  }));
  const onFace = q => Math.abs(q.u) < 1.25 && q.v > -.35 && q.v < 1.25;
  const both = hands.length === 2;

  // ---- both hands, one on each side of the face
  if (both) {
    const [a, b] = Q, opp = Math.sign(a.palm.u) !== Math.sign(b.palm.u) || Math.abs(a.palm.u - b.palm.u) > .5;
    const t0 = touching(0), t1 = touching(1);
    if (opp && t0 > .2 && t1 > .2) {
      const lvl = (a.palm.v + b.palm.v) / 2, lvlTips = (a.tips.v + b.tips.v) / 2, wideU = Math.min(Math.abs(a.palm.u), Math.abs(b.palm.u));
      if (lvl > 1.0 || (wideU > .95 && lvl > .55 && hands.every(h => h.g.palm.y < face.zones.mouth.y))) add('Hands_Behind_Head', .75);
      else if (lvlTips > .6 && lvl > .5 && wideU < .75 && Math.abs(a.tips.u - b.tips.u) < 1.2) add('Cover_Eyes', .85);
      else if (lvl > .55 && wideU > .6) add('Temples_Both', .8);
      else if (wideU > .9 && lvl > .25 && lvl < .75) add('Ears_Cover', .75);
      else if (lvl < .2 && lvl > -.5 && wideU < 1.1) add(smile > .35 ? 'Flower_Pose' : 'Chin_Both_Think', .8);
      else if (lvl >= .1 && lvl <= .6) add(jawOpen > .3 || surprised > .35 ? 'Cheeks_Shock' : smile > .3 ? 'Cheeks_Delight' : 'Cheek_Bored', .75);
    }
    if (out.length) return out;
  }

  // ---- one hand at a time: where the palm sits and where the fingertips reach
  hands.forEach((h, i) => {
    const L = h.label, q = Q[i], tch = touching(i), p = h.g.p, pl = h.g.pl;
    const open = h.count >= 3, curled = h.count <= 1;
    const idxOnly = L === 'Point' || L === 'Pointing_Up' || L === 'Point_You';
    const bunched = Math.max(...TIPS.map(k => d2(p[k], h.g.tipsC))) < pl * .45;
    // chest (below the face): hand on heart, fist on chest, pointing at self
    const depthOk = pl / face.fw > .3 && pl / face.fw < 1.25;
    if (q.palm.v < -.45 && q.palm.v > -2.4 && Math.abs(q.palm.u) < 1.3 && depthOk) {
      if (idxOnly && q.idx.v > q.palm.v - .05 && Math.abs(q.idx.u) < .8 && d2(p[8], face.zones.chest) < d2(p[5], face.zones.chest) * 1.1) add('Point_Self', .7);
      else if (L === 'Closed_Fist') add('Fist_Chest', .7);
      else if (open && !idxOnly) add('Hand_Heart', .75);
      return;
    }
    if (!tch && !(L === 'Finger_Heart' || L === 'Victory' || L === 'Peace_Side')) return;
    // symbolic shapes held by the face
    if (L === 'Finger_Heart' && (onFace(q.thumb) || tch)) return add('Cheek_Heart', .85);
    if ((L === 'Victory' || L === 'Peace_Side') && q.v2.v > .35 && q.v2.v < .85 && Math.abs(q.v2.u) < 1.6 && q.palm.v < .8) return add('Peace_Eye', .8);
    if (!tch) return;
    if (L === 'L_Shape' && q.idx.v > .75) return add('Loser', .8);
    if (L === 'L_Shape' && q.palm.v < .5) return add('Chin_Evaluate', .8);
    // index-finger touches
    if (idxOnly) {
      const iu = Math.abs(q.idx.u), iv = q.idx.v;
      if (iu < .35 && iv > .1 && iv < .42) return add(horizontal(p[5], p[8]) ? 'Mouth_Hold' : 'Shh', .85);
      if (iu < .3 && iv >= .42 && iv < .62) return add('Nose_Touch', .65);
      if (iu > .55 && iv > .62 && iv < 1.1) return add('Temple_Think', .85);
      if (iu >= .3 && iv > .12 && iv < .62) return add(smile > .25 ? 'Cheek_Poke' : 'Chin_Evaluate', .75);
      if (iv >= .62 && iv < 1.2) return add('Forehead_Think', .6);
    }
    // pinching the bridge of the nose
    if (d2(p[4], p[8]) < pl * .55 && Math.abs(q.thumb.u) < .35 && q.thumb.v > .55 && q.thumb.v < .85 && Math.abs(q.idx.u) < .35) return add('Nose_Pinch', .8);
    // salute: flat hand, fingertips at the brow, hand held out to the side
    if (h.count >= 4 && horizontal(p[5], p[8]) && q.idx.v > .72 && q.idx.v < 1.1 && Math.abs(q.palm.u) > .75) return add('Salute', .75);
    const pv = q.palm.v, pu = Math.abs(q.palm.u), tv = q.tips.v;
    const Z = zn => T[i][zn]?.s || 0;
    const inner = Math.max(Z('forehead'), Z('eyeA'), Z('eyeB'), Z('noseBridge'), Z('nose'), Z('mouth'));
    const topTip = Math.max(...[8, 12, 16].map(k => face.toFace(p[k]).v));
    const vertical = p[12].y < p[0].y && Math.abs(p[12].x - p[0].x) < Math.abs(p[12].y - p[0].y) * .8;
    if (pv > 1.15 && Z('forehead') < .4) return add(smile > .35 ? 'Head_Oops' : 'Head_Scratch', .7 + confusedBrow * .3);
    if (pu > 1.0 && pv > .25 && pv < .85 && open && inner < .3) return add('Ear_Listen', .7);
    // an open hand held upright in front of the lower face: covering the mouth, or a facepalm if it reaches the eyes
    if (open && vertical && Math.abs(q.tips.u) < .5 && tv > .1 && pv < .45 && pv > -.6) {
      if (topTip > .55 || (topTip > .4 && eyesClosed > .4)) return add('Facepalm', .7 + (frown + browDown) * .15);
      return add(wide > .3 || surprised > .35 ? 'Mouth_Shock' : smile > .25 ? 'Mouth_Giggle' : 'Mouth_Hold', .75);
    }
    // fingers at the lips (bunched), nail-biting (curled)
    if (Math.abs(q.tips.u) < .45 && tv > .1 && tv < .45 && pv < .3) {
      if (pucker > .4) return add('Kiss', .75);
      if (bunched && !curled) return add('Mouth_Hold', .7);
      if (curled || h.count <= 2) return add('Nail_Bite', .65);
    }
    // palm across the middle of the face
    if (pu < .6 && pv > .12 && pv < .62) {
      if (tv > .68 && open) return add('Facepalm', .65 + (eyesClosed + frown + browDown) * .15); // fingers up over eyes/forehead
      if (open || h.count >= 2) return add(wide > .3 || surprised > .35 ? 'Mouth_Shock' : smile > .25 ? 'Mouth_Giggle' : pucker > .4 ? 'Kiss' : 'Mouth_Hold', .75);
    }
    // eyes / forehead
    const eyeForehead = Math.max(Z('forehead'), Z('eyeA'), Z('eyeB'));
    if ((pv >= .5 && pv <= 1.15 && pu < 1.0) || (eyeForehead > .5 && pv > .35)) {
      if (curled && (eyesClosed > .4 || lowLids > .5) && tv < .85) return add('Eye_Rub', .75);
      if (pu > .6 && !open) return add('Temple_Think', .65);
      if (eyesClosed > .5 || browDown > .45) return add('Forehead_Overwhelmed', .8);
      return add(smile > .4 ? 'Forehead_Oops' : 'Forehead_Think', .8);
    }
    // chin & cheeks
    if (pv >= -.45 && pv < .2 && pu < .95) return add(lowLids > .5 ? 'Chin_Rest' : 'Chin_Think', .75);
    if (pv >= .1 && pv < .7 && pu >= .5 && pu < 1.25) return add(smile > .3 ? 'Cheek_Fond' : lowLids > .45 ? 'Chin_Rest' : 'Cheek_Bored', .65);
    if (pv > -.8 && pv < -.1 && pu < .8) return add('Neck_Touch', .6);
  });
  // keep the strongest few, one per id
  const best = {};
  for (const o of out) if (!best[o.id] || best[o.id].conf < o.conf) best[o.id] = o;
  return Object.values(best).sort((a, b) => b.conf - a.conf).slice(0, 3);
}

/* ------------------------------------------------------------------ motion gestures: wave, clap */
// One detected hand can still be a namaste: the detector often merges two pressed palms into one hand.
export function prayerSingle(h, face) {
  if (!face || h.count < 4) return false;
  const p = h.g.p, q = face.toFace(h.g.palm);
  const vertical = p[12].y < p[0].y && Math.abs(p[12].x - p[0].x) < Math.abs(p[12].y - p[0].y) * .5;
  const together = d2(p[8], p[20]) < h.g.pl * .6, depthOk = h.g.pl / face.fw > .3;
  return vertical && together && depthOk && q.v < -.15 && q.v > -2.2 && Math.abs(q.u) < 1.3;
}

export function motionTracker() {
  const st = { wave: { hist: [], last: -1e9 }, clap: { hist: [], closes: [], wasClose: false, last: -1e9 } };
  return function step(hands, t) {
    const events = [];
    // 👋 wave: an open hand swinging side to side (≥3 direction changes within 1.4 s)
    const h = hands.find(q => q.count >= 4);
    const W = st.wave;
    if (h) {
      W.hist.push({ t, x: h.g.palm.x, pl: h.g.pl });
      while (W.hist.length && t - W.hist[0].t > 1400) W.hist.shift();
      let revs = 0, dir = 0, ext = W.hist[0].x;
      for (const s of W.hist) {
        const hy = s.pl * .22;
        if (dir === 0) { if (Math.abs(s.x - ext) > hy) { dir = Math.sign(s.x - ext); ext = s.x; } } // first swing only sets direction
        else if (dir > 0) { if (s.x > ext) ext = s.x; else if (s.x < ext - hy) { revs++; dir = -1; ext = s.x; } }
        else { if (s.x < ext) ext = s.x; else if (s.x > ext + hy) { revs++; dir = 1; ext = s.x; } }
      }
      if (revs >= 2 && t - W.last > 2200) { W.last = t; W.hist = []; events.push('Wave'); }
    } else W.hist = [];
    // 👏 clap: two hands repeatedly coming together
    const C = st.clap;
    if (hands.length === 2) {
      const [a, b] = hands, pl = (a.g.pl + b.g.pl) / 2, dd = d2(a.g.palm, b.g.palm);
      const close = dd < pl * 1.0, far = dd > pl * 1.4;
      if (close && !C.wasClose) { C.closes.push(t); C.wasClose = true; }
      if (far) C.wasClose = false;
      C.closes = C.closes.filter(x => t - x < 1600);
      if (C.closes.length >= 2 && t - C.last > 1800) { C.last = t; C.closes = []; events.push('Clap'); }
    }
    return events;
  };
}

/* ------------------------------------------------------------------ the mentalist read */
// States a careful clinician would consider, each with a response hint for the person watching.
export const STATES = {
  thinking: ['🤔', 'Thinking / concentrating', 'Give them a moment. Pausing now helps more than repeating yourself.'],
  confused: ['😕', 'Confused / unsure', 'Rephrase more simply, show an example, or ask a yes/no question.'],
  anxious: ['😰', 'Anxious / nervous', 'Slow down, speak calmly, offer reassurance or a short break.'],
  stressed: ['😩', 'Stressed / overwhelmed', 'Lower the demands. Ask if they need a pause or some help.'],
  tired: ['😪', 'Tired / low energy', 'Keep it short, and suggest rest or water.'],
  bored: ['😑', 'Bored / disengaged', 'Change the activity, or ask what they would prefer.'],
  embarrassed: ['😳', 'Embarrassed / shy', 'Keep it light and don\'t put them on the spot.'],
  playful: ['😜', 'Playful / cute (aegyo)', 'They\'re in a fun mood. Match the energy.'],
  affectionate: ['🥰', 'Affectionate / loving', 'They\'re showing warmth or love. Return it.'],
  happy: ['😄', 'Happy / excited', 'Share the moment with them.'],
  surprised: ['😲', 'Surprised / shocked', 'Pause and let them process, then explain what happened.'],
  sad: ['😢', 'Sad / down', 'Check in gently: "Are you okay? Do you want to talk?"'],
  frustrated: ['😤', 'Frustrated / irritated', 'Acknowledge it ("this is annoying, isn\'t it?") and ask what isn\'t working.'],
  relaxed: ['😌', 'Relaxed / confident', 'All good. Carry on.'],
  engaged: ['👂', 'Listening / interested', 'They\'re with you. Keep going.'],
  grateful: ['🙏', 'Grateful / sincere', 'Acknowledge their thanks.'],
  pleading: ['🥺', 'Asking / pleading', 'They want something. Offer choices they can point to.'],
  refusing: ['🙅', 'Refusing / disagreeing', 'Respect the "no" and offer an alternative.'],
  agreeing: ['👍', 'Agreeing / yes', 'Go ahead.'],
  secretive: ['🤫', 'Wants quiet / privacy', 'Lower your voice, or talk privately.'],
};

// cue → [[state, weight], …]; every cue carries a human-readable reason.
const W = {
  happy: [['happy', 1]], sad: [['sad', 1]], angry: [['frustrated', 1]], surprised: [['surprised', 1]], fear: [['anxious', .9]],
  disgust: [['frustrated', .5], ['refusing', .3]], contempt: [['frustrated', .3], ['refusing', .2]], confusedFace: [['confused', 1]],
  gazeUp: [['thinking', .45]], gazeSide: [['thinking', .25], ['bored', .15], ['anxious', .1]], gazeDown: [['sad', .25], ['embarrassed', .25], ['thinking', .15]],
  blinkFast: [['anxious', .5], ['stressed', .3]], drowsy: [['tired', 1]], stressHigh: [['anxious', .55], ['stressed', .5]],
  lipPress: [['frustrated', .3], ['anxious', .25], ['thinking', .15]], lipBite: [['anxious', .45]], browFurrow: [['thinking', .35], ['frustrated', .3], ['confused', .2]],
  headTilt: [['engaged', .45], ['confused', .2], ['playful', .15]], nod: [['agreeing', 1], ['engaged', .3]], shake: [['refusing', 1]],
  yawn: [['tired', .8], ['bored', .3]], lookingAway: [['bored', .5]], polite: [['embarrassed', .15], ['anxious', .1]],
  genuine: [['happy', .5]], suppress: [['sad', .4], ['frustrated', .3], ['anxious', .2]],
  Facepalm: [['frustrated', .8], ['embarrassed', .5]], Forehead_Think: [['thinking', 1]], Forehead_Overwhelmed: [['stressed', 1], ['tired', .3]],
  Forehead_Oops: [['embarrassed', .8], ['playful', .3]], Temple_Think: [['thinking', 1]], Temples_Both: [['stressed', 1]],
  Chin_Think: [['thinking', 1]], Chin_Evaluate: [['thinking', .8], ['engaged', .4]], Chin_Rest: [['bored', .7], ['tired', .5]],
  Flower_Pose: [['playful', 1], ['happy', .4]], Chin_Both_Think: [['thinking', .8], ['engaged', .3]], Mouth_Shock: [['surprised', 1], ['anxious', .3]],
  Mouth_Giggle: [['embarrassed', .6], ['happy', .6], ['playful', .3]], Mouth_Hold: [['anxious', .5], ['thinking', .4]], Shh: [['secretive', 1]],
  Nail_Bite: [['anxious', 1]], Kiss: [['affectionate', 1]], Nose_Touch: [['anxious', .3], ['thinking', .3]], Nose_Pinch: [['stressed', .8], ['tired', .5], ['frustrated', .4]],
  Eye_Rub: [['tired', 1], ['sad', .2]], Cover_Eyes: [['embarrassed', .8], ['surprised', .3], ['playful', .2]], Peace_Eye: [['playful', 1]],
  Cheek_Poke: [['playful', 1]], Cheek_Heart: [['affectionate', .9], ['playful', .7]], Cheek_Fond: [['affectionate', .6], ['happy', .4]],
  Cheek_Bored: [['bored', .8], ['tired', .3]], Cheeks_Shock: [['surprised', 1]], Cheeks_Delight: [['happy', .8], ['affectionate', .4], ['playful', .4]],
  Ear_Listen: [['engaged', 1]], Ears_Cover: [['stressed', .6], ['refusing', .5]], Head_Scratch: [['confused', 1]], Head_Oops: [['embarrassed', 1]],
  Hands_Behind_Head: [['relaxed', 1]], Salute: [['agreeing', .6], ['playful', .3]], Loser: [['playful', .8]], Hand_Heart: [['grateful', .9], ['affectionate', .4]],
  Fist_Chest: [['grateful', .5], ['relaxed', .3]], Neck_Touch: [['anxious', .7]], Point_Self: [['engaged', .4], ['pleading', .3]],
  Face_Hidden: [['embarrassed', .6], ['sad', .5], ['stressed', .5]],
  Heart_Hands: [['affectionate', 1]], Big_Heart: [['affectionate', 1], ['happy', .4]], Finger_Heart: [['affectionate', .9]], Double_Finger_Heart: [['affectionate', 1]],
  ILoveYou: [['affectionate', 1]], Prayer: [['grateful', .7], ['pleading', .6]], X_Fingers: [['refusing', 1]], X_Hands: [['refusing', 1]],
  Thumb_Up: [['agreeing', .9]], Double_Thumbs: [['agreeing', .8], ['happy', .6]], Thumb_Down: [['refusing', .9]], OK: [['agreeing', .7], ['relaxed', .2]],
  Victory: [['happy', .5], ['playful', .4]], Double_Peace: [['happy', .6], ['playful', .7]], Peace_Side: [['playful', .8]], Hands_Up: [['happy', 1]],
  Fists_Up: [['happy', .9]], Wave: [['happy', .4], ['engaged', .3]], Clap: [['happy', .8]], Shrug: [['confused', .9]], Steeple: [['relaxed', .6], ['thinking', .5]],
  Crossed_Fingers: [['anxious', .4], ['pleading', .4]], Pinched: [['confused', .5], ['frustrated', .4]], Open_Palm: [['engaged', .2]], Closed_Fist: [['frustrated', .25]],
  Middle_Finger: [['frustrated', 1]], Vulcan: [['playful', .8]], Finger_Gun: [['playful', .6], ['agreeing', .2]], Double_Guns: [['playful', .8]], Point_You: [['engaged', .3]],
  Photo_Frame: [['playful', .7], ['happy', .3]], Rock: [['happy', .5], ['playful', .4]], Call_Me: [['relaxed', .5], ['playful', .3]],
};

export function mentalRead(c) {
  // c.cues: { name: [strength 0..1, reason] }
  const score = {}, why = {};
  for (const [cue, [v, reason]] of Object.entries(c.cues)) {
    if (!(v > .05) || !W[cue]) continue;
    for (const [st, w] of W[cue]) {
      score[st] = (score[st] || 0) + v * w;
      (why[st] = why[st] || []).push([v * w, reason]);
    }
  }
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  return ranked.slice(0, 4).map(([st, s]) => ({
    st, s, conf: clamp(s / 1.4), icon: STATES[st][0], name: STATES[st][1], tip: STATES[st][2],
    why: (why[st] || []).sort((a, b) => b[0] - a[0]).slice(0, 4).map(x => x[1]),
  }));
}

export { clamp, d2, horizontal };
