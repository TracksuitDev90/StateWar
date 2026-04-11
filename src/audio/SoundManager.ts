// Procedural sound effects via WebAudio. No asset files needed.
// AudioContext is lazily created and resumed on first use to comply with
// browser autoplay policies.

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  public muted = false;

  private ensureCtx(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }
    try {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4;
      this.master.connect(this.ctx.destination);
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** Call once on a user gesture (pointerdown) to unlock audio on iOS/Safari. */
  unlock(): void {
    this.ensureCtx();
  }

  setMuted(m: boolean): void {
    this.muted = m;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = "sine",
    vol = 0.18,
    slideTo: number | null = null,
    delay = 0,
  ): void {
    if (this.muted) return;
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol = 0.2, delay = 0): void {
    if (this.muted) return;
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(gain).connect(this.master);
    src.start(ctx.currentTime + delay);
  }

  // ── Game sounds ──

  acquireState(): void {
    this.tone(523, 0.1, "square", 0.16);
    this.tone(659, 0.1, "square", 0.16, null, 0.08);
    this.tone(784, 0.18, "square", 0.16, null, 0.16);
  }

  loseState(): void {
    this.tone(392, 0.18, "sawtooth", 0.18, 180);
    this.tone(220, 0.25, "sawtooth", 0.16, 110, 0.1);
  }

  buildWall(): void {
    this.tone(180, 0.07, "square", 0.18);
    this.tone(160, 0.09, "square", 0.18, 130, 0.06);
  }

  moveUnits(): void {
    this.tone(520, 0.05, "triangle", 0.1);
    this.tone(620, 0.05, "triangle", 0.08, null, 0.04);
  }

  bomb(): void {
    // descending whistle then explosion
    this.tone(900, 0.35, "sine", 0.12, 120);
    this.noise(0.4, 0.35, 0.32);
    this.tone(80, 0.35, "sawtooth", 0.22, 40, 0.32);
  }

  uiTap(): void {
    this.tone(800, 0.04, "sine", 0.08);
  }

  levelComplete(): void {
    this.tone(523, 0.12, "sine", 0.2);
    this.tone(659, 0.12, "sine", 0.2, null, 0.1);
    this.tone(784, 0.12, "sine", 0.2, null, 0.2);
    this.tone(1047, 0.25, "sine", 0.25, null, 0.3);
  }

  levelFail(): void {
    this.tone(400, 0.2, "sawtooth", 0.15, 200);
    this.tone(300, 0.3, "sawtooth", 0.12, 150, 0.15);
  }
}

export const sound = new SoundManager();
