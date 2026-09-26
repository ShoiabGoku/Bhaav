# BHAAV · Expression, Eye & Sign Reader

A browser app that uses the camera to read:

- **Emotions**: happy, sad, angry, surprised, fearful/anxious, disgusted, contempt, confused, neutral. Scores come from MediaPipe's 52 facial blendshapes and are compared against your own calibrated neutral face. Also shows a 60 s timeline, a valence × arousal mood map, and CSV export.
- **Stress / anxiety signs**: a transparent composite of fear-like expression, blink rate, lip press/bite, worried brows, head fidgeting and darting eyes. **Tiredness** uses eye-closure time (PERCLOS), yawns and long blinks. **Attention** measures how much of the time you face the screen.
- **Eye gestures**: blink, double blink, long blink, left/right wink, and gaze held left/right/up/down. Also shows blink rate, per-eye openness and a live eye diagram.
- **Facial actions**: 22 actions (smirk, one brow up, pucker, cheek puff, nose wrinkle, jaw sideways…) plus head pose. **Nod / shake / tilt** gestures are detected.
- **Works with beards, moustaches, masks and glasses**: the app samples skin colour at landmark points, compared against the person's own cheek tone, to detect a beard or moustache (dark, grey or stubble), a face covering (mask, niqab, scarf) or glasses. The emotion model then adapts. Beard mode amplifies mouth signals ×1.45 and weights smiling eyes more. Covering mode reads emotions from eyes, brows and cheeks only and greys out mouth actions. Glasses mode relaxes blink thresholds. Detection can be overridden in Settings. On 13 real test photos (6 beards, 3 kinds of mask, glasses, clean faces) all 13 were classified correctly. **Low-light boost** brightens dim frames before they reach the models, and tracking thresholds are lenient so partial occlusion doesn't drop the face.
- **Hand signs**: 16 built-in signs (MediaPipe's gesture model plus a finger-state classifier), and a **"teach your own sign"** k-NN trainer, so ISL/ASL signs or personal gestures can be added.
- **Gen-Z and K-pop signs** (`reading.js`): 🫰 Korean finger heart, 🤌, 🤞, 🫵, 🔫 finger gun, sideways ✌️ and 🖖. Two-hand gestures: 🫶 heart hands, 💞 big heart over the head, 🫰🫰, 🙏 namaste (even when the detector merges both palms into one hand), ✖️ Korean X (안돼), 👍👍, ✌️✌️, 🙌, 💪, 📸 frame, steepled fingers and 🤷 shrug. Motion gestures: 👋 wave and 👏 clap.
- **Hand + face combinations**: 40 of them, read together with the expression. Hand on forehead is thinking, or overwhelmed with eyes shut, or "oops" with a smile. Finger to temple, facepalm, hand on chin (thinker / critical evaluation / bored chin-rest), 🤫, hand over mouth (shock / giggle / holding back words), nail-biting, rubbing eyes, 🙈, gyaru peace, aegyo cheek poke, flower pose, Home-Alone cheeks, ear cup, head scratch, hands behind head, 🫡, hand on heart, hiding face in hands and more. Each hand is placed on a face coordinate map (across the face; chin 0 to hairline 1), so the reading depends on where the palm sits and where the fingertips reach. When a hand hides the face the tracker loses it, so the last face position is kept for 3 s.
- **Mentalist read**: fuses face, eyes (gaze aversion while thinking, blink rate), head (nods, tilts), hands and hand-face contact into 20 psychological states, each with its reasons and a **"how to respond"** hint. It also flags **mixed signals** (nodding with a sad face, a polite smile under stress), tells **genuine (Duchenne) from polite smiles**, and catches **micro-expressions** (60–500 ms flashes). Deliberate gestures are weighted above a resting face.
- **Speak for me**: holding a sign, nodding/shaking, or blinking types phrases into a sentence, which the browser speaks aloud. There's also a phrase board and an SOS button. Every trigger→phrase mapping can be edited.

Everything runs on-device (WebAssembly/GPU). No frames leave the browser.

## Run locally

```
node serve.js 8765
```

Then open http://localhost:8765. The camera needs `localhost` or HTTPS.

## Tests

`tools/gesture-tests.js` holds a 19-photo regression suite (finger hearts, heart hands, facepalm, namaste, forehead/temple, hand on heart, shrug, double thumbs, finger gun, plus gesture-free faces). Run it in the browser console on the running app:

```js
const { run } = await import('/tools/gesture-tests.js'); await run();   // currently 18/19
```

The one miss is a photo where the subject's face isn't detected at all, because his hand hides it and only people behind him are found.

## Test hook

`window.__BHAAV` exposes the state and pipeline (`analyzePhoto(url)`, `summary()`, `eyeStep`, `headStep`, `classifyHand`, `frame`…) for testing without a camera.
