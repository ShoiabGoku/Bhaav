# BHAAV · Expression, Eye & Sign Reader

A browser app that uses the camera to read:

- **Emotions**: happy, sad, angry, surprised, fearful/anxious, disgusted, contempt, confused, neutral. Scores come from MediaPipe's 52 facial blendshapes and are compared against your own calibrated neutral face. Also shows a 60 s timeline, a valence × arousal mood map, and CSV export.
- **Stress / anxiety signs**: a transparent composite of fear-like expression, blink rate, lip press/bite, worried brows, head fidgeting and darting eyes. **Tiredness** uses eye-closure time (PERCLOS), yawns and long blinks. **Attention** measures how much of the time you face the screen.
- **Eye gestures**: blink, double blink, long blink, left/right wink, and gaze held left/right/up/down. Also shows blink rate, per-eye openness and a live eye diagram.
- **Facial actions**: 22 actions (smirk, one brow up, pucker, cheek puff, nose wrinkle, jaw sideways…) plus head pose. **Nod / shake / tilt** gestures are detected.
- **Works with beards, moustaches, masks and glasses**: the app samples skin colour at landmark points, compared against the person's own cheek tone, to detect a beard or moustache (dark, grey or stubble), a face covering (mask, niqab, scarf) or glasses. The emotion model then adapts. Beard mode amplifies mouth signals ×1.45 and weights smiling eyes more. Covering mode reads emotions from eyes, brows and cheeks only and greys out mouth actions. Glasses mode relaxes blink thresholds. Detection can be overridden in Settings. On 13 real test photos (6 beards, 3 kinds of mask, glasses, clean faces) all 13 were classified correctly. **Low-light boost** brightens dim frames before they reach the models, and tracking thresholds are lenient so partial occlusion doesn't drop the face.
- **Hand signs**: 16 built-in signs (MediaPipe's gesture model plus a finger-state classifier), and a **"teach your own sign"** k-NN trainer, so ISL/ASL signs or personal gestures can be added.
- **Speak for me**: holding a sign, nodding/shaking, or blinking types phrases into a sentence, which the browser speaks aloud. There's also a phrase board and an SOS button. Every trigger→phrase mapping can be edited.

Everything runs on-device (WebAssembly/GPU). No frames leave the browser.

## Run locally

```
node serve.js 8765
```

Then open http://localhost:8765. The camera needs `localhost` or HTTPS.

## Test hook

`window.__BHAAV` exposes the state and pipeline (`analyzePhoto(url)`, `summary()`, `eyeStep`, `headStep`, `classifyHand`, `frame`…) for testing without a camera.
