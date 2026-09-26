// Photo regression suite for BHAAV's gesture layer. In the browser console on the running app:
//   const { run } = await import('/tools/gesture-tests.js'); await run();
// Each case lists acceptable "primary" readings (two-hand > hand-on-face combo > single-hand sign). [] = nothing expected.
const T = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/', U = 'https://upload.wikimedia.org/wikipedia/commons/';
export const CASES = {
  fingerHeart_chuu: [U + '6/63/Chuu%27s_finger_heart.png', ['Finger_Heart', 'Cheek_Heart']],
  fingerHeart_mina: [T + 'f/f1/Twice_mina_with_finger_heart_in_2015.jpg/960px-Twice_mina_with_finger_heart_in_2015.jpg', ['Finger_Heart', 'Cheek_Heart']],
  fingerHeart_playback: [T + 'e/ea/Playback_%28South_Korea%29_member_with_finger_heart_in_2015.jpg/960px-Playback_%28South_Korea%29_member_with_finger_heart_in_2015.jpg', ['Finger_Heart', 'Cheek_Heart']],
  heartHands_1: [T + '7/74/Hand_heart.JPG/960px-Hand_heart.JPG', ['Heart_Hands']],
  heartHands_enako: [U + '1/19/Enako_as_Snow_Miku_giving_heart_hand_gesture_in_Bangkok_%288433706089%29.jpg', ['Heart_Hands']],
  heartHands_miu: [T + 'a/a1/Miu_as_Le_Viada_with_heart_hand_gesture_20190714a.jpg/960px-Miu_as_Le_Viada_with_heart_hand_gesture_20190714a.jpg', ['Heart_Hands']],
  facepalm: [T + '3/32/Facepalm.jpg/960px-Facepalm.jpg', ['Facepalm', 'Mouth_Hold']],
  namaste: [T + '3/34/Indian_krishna_conscious_woman_in_namaskar_pose_or_welcoming.jpg/960px-Indian_krishna_conscious_woman_in_namaskar_pose_or_welcoming.jpg', ['Prayer']],
  obama_fingersToLips: [T + 'b/b9/President_Obama_reflects_during_an_economic_meeting_with_advisors_in_the_Roosevelt_Room..jpg/960px-President_Obama_reflects_during_an_economic_meeting_with_advisors_in_the_Roosevelt_Room..jpg', ['Mouth_Hold', 'Chin_Think']],
  headache_handOnForehead: [T + '9/96/ChildwithHeadAche_2010.jpg/960px-ChildwithHeadAche_2010.jpg', ['Forehead_Think', 'Forehead_Overwhelmed', 'Facepalm']],
  brainFreeze_handOnForehead: [T + '5/59/Brain_freeze-01.jpg/960px-Brain_freeze-01.jpg', ['Forehead_Think', 'Forehead_Overwhelmed', 'Temple_Think']],
  handOnHeart_pledge: [U + 'd/d3/Obama_pledge.jpg', ['Hand_Heart']],
  shrug: [U + '4/42/Shrug.jpg', ['Shrug']],
  doubleThumbs: [T + 'd/de/British_Thumbs_Up.jpg/960px-British_Thumbs_Up.jpg', ['Double_Thumbs']],
  fingerGun: [T + '1/1c/Action%21_%28Unsplash%29.jpg/960px-Action%21_%28Unsplash%29.jpg', ['Finger_Gun']],
  thumbsUp: ['https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/thumbs_up.jpg', ['Thumb_Up']],
  none_portrait: ['https://storage.googleapis.com/mediapipe-assets/portrait.jpg', []],
  none_beard: [U + '2/22/Jason_Momoa_%2843055621224%29_%28cropped%29.jpg', []],
  none_glasses: [U + 'd/d9/Bill_Gates_at_the_European_Commission_-_P067383-987995_%28cropped%29_5.jpg', []],
};
export async function run() {
  const B = window.__BHAAV, out = {}; let pass = 0;
  for (const [k, [url, want]] of Object.entries(CASES)) {
    const s = await B.analyzePhoto(url);
    const primary = s.two || s.combos[0]?.split(' ')[0] || s.hands.find(h => h.label)?.label || null;
    const ok = want.length ? want.includes(primary) : (!s.two && !s.combos.length);
    if (ok) pass++;
    out[k] = `${ok ? '✓' : '✗'} ${primary} | ${s.read[0] || ''}`;
  }
  out.SCORE = `${pass}/${Object.keys(CASES).length}`;
  return out;
}
