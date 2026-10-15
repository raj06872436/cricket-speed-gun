/** Camera capture at the highest frame rate the browser offers. */

export interface CameraSession {
  stream: MediaStream;
  fps: number;
  width: number;
  height: number;
  stop(): void;
}

export async function openCamera(preview: HTMLVideoElement): Promise<CameraSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot use the camera. Try Chrome or Safari, or import a video instead.');
  }
  const attempts: MediaStreamConstraints[] = [
    { audio: false, video: { facingMode: { ideal: 'environment' }, frameRate: { ideal: 240, min: 90 }, height: { ideal: 720 } } },
    { audio: false, video: { facingMode: { ideal: 'environment' }, frameRate: { ideal: 120 }, height: { ideal: 1080 } } },
    { audio: false, video: { facingMode: { ideal: 'environment' }, frameRate: { ideal: 60 } } },
    { audio: false, video: true },
  ];
  let stream: MediaStream | undefined;
  let lastErr: unknown;
  for (const c of attempts) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(c);
      break;
    } catch (e) {
      lastErr = e;
      if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) break;
    }
  }
  if (!stream) {
    const name = lastErr instanceof DOMException ? lastErr.name : '';
    if (name === 'NotAllowedError') throw new Error('Camera permission was denied. Allow camera access in your browser settings and try again.');
    throw new Error('Could not open the camera. You can still import a video you filmed.');
  }
  const track = stream.getVideoTracks()[0];
  // Ask for more if the device can do it.
  try {
    const caps = track.getCapabilities?.() as MediaTrackCapabilities | undefined;
    const maxFps = caps?.frameRate?.max;
    if (maxFps && maxFps > (track.getSettings().frameRate ?? 0)) await track.applyConstraints({ frameRate: { ideal: maxFps } });
  } catch {
    /* keep what we have */
  }
  const s = track.getSettings();
  preview.srcObject = stream;
  preview.muted = true;
  preview.playsInline = true;
  await preview.play().catch(() => {});
  return {
    stream,
    fps: Math.round(s.frameRate ?? 30),
    width: s.width ?? preview.videoWidth,
    height: s.height ?? preview.videoHeight,
    stop: () => stream!.getTracks().forEach((t) => t.stop()),
  };
}

function pickMime(): string | undefined {
  const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  return types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
}

export class Recorder {
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  private done: Promise<Blob>;

  constructor(stream: MediaStream) {
    const mimeType = pickMime();
    this.rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 16_000_000 });
    this.done = new Promise((resolve) => {
      this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.rec.onstop = () => resolve(new Blob(this.chunks, { type: this.rec.mimeType || 'video/webm' }));
    });
  }

  start(): void {
    this.rec.start(250);
  }

  stop(): Promise<Blob> {
    if (this.rec.state !== 'inactive') this.rec.stop();
    return this.done;
  }
}
