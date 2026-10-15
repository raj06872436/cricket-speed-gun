# 🏏 Cricket Speed Gun

**Measure how fast a cricket ball is bowled — with just your phone's camera.**

No app store, no sign-up, no special equipment. Open the website on your phone, film a ball, tap two spots, and get the speed.

👉 **Open the app:** https://raj06872436.github.io/cricket-speed-gun/

---

## How to use it (3 steps)

1. **Film the ball.** Tap **Record a ball**, or tap **Use a video** to pick a video you already filmed.
   For the best accuracy, film in your camera's **Slo-mo** mode (120 or 240 fps) and use *Use a video*.
2. **Tap two spots** on the video:
   - **①** the bowler's crease (the white line the bowler's front foot lands on)
   - **②** the bottom of the batter's stumps

   The app remembers them, so if you film from the same spot next time it's one tap.
3. **Tap _Measure speed_.** The app finds the ball and shows the speed in big numbers.

Want more? Open **Detailed analysis** for:

- Speed out of the hand, average speed, and speed reaching the batter
- Where the ball pitched (yorker / full / good length / short) on a pitch map
- A speed-down-the-pitch chart
- A replay of the tracked ball path
- Accuracy (± km/h) for every reading
- Data download (CSV)

Every ball is saved in **History** (fastest, average, per bowler) and can be exported.

### Filming tips

| Do | Why |
|---|---|
| Stand **side-on**, level with the middle of the pitch, 15–25 m away | Both ends must be in view |
| Hold the phone **sideways** and **still** (lean on something / tripod) | The app looks for things that move |
| Use **Slo-mo** if your phone has it | More frames = more accurate |
| Film in **good light** | Short exposure keeps the ball sharp |

### How accurate is it?

| Video | Typical accuracy (130 km/h ball) |
|---|---|
| 30 fps | ± 2–6 km/h |
| 60 fps | ± 1–3 km/h |
| 120 fps slow-mo | ± 1–2 km/h |
| 240 fps slow-mo | ± 0.5–1 km/h |

Every result shows its own ± range. If the app can't see the ball well enough to be sure, it says so and lets you **mark the ball by hand** (frame by frame, with zoom).

### Install it like an app

On your phone, open the link, then choose **Add to Home Screen** in the browser menu. It then works offline.

### Privacy

Videos are processed **on your phone** and never uploaded anywhere.

---

## How it works

1. **Frame-accurate decoding.** The video is played back slowly and every frame is captured with its exact timestamp (`requestVideoFrameCallback`). If the browser skips any frame, the scan automatically repeats more slowly.
2. **Ball detection.** Three-frame differencing finds things that moved, using both brightness and a red-vs-green colour channel (so a red ball on green grass is still visible). Large blobs (the bowler, the bat) and thin lines are rejected.
3. **Tracking.** Dynamic programming finds the longest chain of detections that moves steadily from line ① to line ② at a realistic cricket-ball speed.
4. **Sub-frame timing.** The exact moment the ball crosses each line is interpolated between frames, so timing is accurate to a fraction of a frame.
5. **Physics.** Average speed = distance ÷ time. Like a TV speed gun, the headline number is the **release speed**: the ball slows through air drag (`v = v₀·e^(−k·s)`, with k from the ball's size, mass and drag coefficient) and loses ~10 % of its speed at the bounce (detected automatically from the ball's path), so the model works back to the speed out of the hand. Both model constants can be changed in *Settings → Advanced*.

### Project layout

```
src/core/       Pure, tested logic: detection, tracking, geometry, physics
src/video/      Camera recording and frame-accurate video scanning
src/ui/         Screens, canvas stage (line placement, zoom), charts
tests/          Unit tests incl. synthetic deliveries with known speeds
scripts/        Test-video generator and browser end-to-end test
```

## Development

```bash
npm install
npm run dev        # open the printed URL on your phone (same Wi-Fi)
npm test           # unit tests
npm run build      # production build in dist/
```

Camera access needs HTTPS (or `localhost`). The GitHub Pages site is HTTPS.

### End-to-end test

Generate a synthetic delivery with a known speed and let a real browser measure it:

```bash
npm run build
node scripts/make-test-video.mjs test-videos/d120.webm 120 140 14.5   # 120 fps, 140 km/h, bounce at 14.5 m
node scripts/make-test-video.mjs test-videos/slo.webm 240 145 13 30   # 240 fps slow-mo that plays at 30 fps
node scripts/e2e.mjs test-videos/d120.webm screenshots/
```

Results at the time of writing: 120 fps → 139.2 km/h (true 140), 240 fps slow-mo → 144.7 km/h (true 145), 30 fps → 128.8 km/h (true 130).

### Deploying

Pushing to `main` builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`.
One-time setup: in the repository go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

## License

MIT
