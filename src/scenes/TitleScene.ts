import Phaser from "phaser";
import { stateData } from "../data/states";
import { progressManager } from "../ui/ProgressManager";
import { sound } from "../audio/SoundManager";

const DPR = Math.min(window.devicePixelRatio || 1, 2);
const FONT = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export class TitleScene extends Phaser.Scene {
  constructor() {
    super({ key: "TitleScene" });
  }

  create(): void {
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);

    sound.setMuted(!progressManager.isSoundEnabled());
    this.cameras.main.setBackgroundColor(0x0f172a);

    // Subtle US map silhouette in background
    const mapGfx = this.add.graphics().setAlpha(0.04);
    mapGfx.fillStyle(0x3b82f6, 1);
    for (const state of stateData) {
      if (state.id === "AK" || state.id === "HI") continue;
      for (const poly of state.polygons) {
        if (poly.length < 3) continue;
        mapGfx.beginPath();
        mapGfx.moveTo(poly[0][0] * DPR, poly[0][1] * DPR);
        for (let i = 1; i < poly.length; i++) mapGfx.lineTo(poly[i][0] * DPR, poly[i][1] * DPR);
        mapGfx.closePath();
        mapGfx.fillPath();
      }
    }

    // Ambient floating particles
    for (let i = 0; i < 15; i++) {
      const px = Math.random() * W;
      const py = Math.random() * H;
      const r = (1 + Math.random() * 1.5) * DPR;
      const dot = this.add.circle(px, py, r, 0x3b82f6, 0.12 + Math.random() * 0.08);
      this.tweens.add({
        targets: dot,
        y: py - (40 + Math.random() * 60) * DPR,
        alpha: 0,
        duration: 5000 + Math.random() * 5000,
        repeat: -1,
        delay: Math.random() * 4000,
        onRepeat: () => {
          dot.setPosition(Math.random() * W, H + 20 * DPR);
          dot.setAlpha(0.12 + Math.random() * 0.08);
        },
      });
    }

    // Title
    const title = this.add.text(W / 2, H * 0.3, "STATE WAR", {
      fontSize: `${Math.round(54 * DPR)}px`,
      color: "#ffffff",
      fontFamily: FONT,
      fontStyle: "bold",
      stroke: "#1e40af",
      strokeThickness: 5 * DPR,
      shadow: { offsetX: 0, offsetY: 3 * DPR, color: "#1e3a5f", blur: 16 * DPR, fill: true },
    }).setOrigin(0.5);
    this.tweens.add({
      targets: title,
      y: title.y - 4 * DPR,
      duration: 2500,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Subtitle
    this.add.text(W / 2, H * 0.3 + 46 * DPR, "Conquer America", {
      fontSize: `${Math.round(18 * DPR)}px`,
      color: "#fbbf24",
      fontFamily: FONT,
      fontStyle: "bold",
      stroke: "#000",
      strokeThickness: 2 * DPR,
    }).setOrigin(0.5);

    // PLAY button
    this.makeButton(W / 2, H * 0.56, "PLAY", 220 * DPR, 54 * DPR, 0x2563eb, () => {
      sound.unlock();
      sound.uiTap();
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.time.delayedCall(300, () => this.scene.start("LevelSelectScene"));
    });

    // Sound toggle (top-right)
    const sOn = progressManager.isSoundEnabled();
    const sBtn = this.add.text(W - 14 * DPR, 14 * DPR, sOn ? "Sound: ON" : "Sound: OFF", {
      fontSize: `${Math.round(12 * DPR)}px`,
      color: sOn ? "#22c55e" : "#64748b",
      fontFamily: FONT,
      fontStyle: "bold",
      backgroundColor: "#1e293b",
      padding: { x: 8 * DPR, y: 5 * DPR },
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    sBtn.on("pointerdown", () => {
      const on = !progressManager.isSoundEnabled();
      progressManager.setSoundEnabled(on);
      sound.setMuted(!on);
      sBtn.setText(on ? "Sound: ON" : "Sound: OFF");
      sBtn.setColor(on ? "#22c55e" : "#64748b");
    });

    // Reset progress (subtle, bottom-left)
    const resetBtn = this.add.text(14 * DPR, H - 14 * DPR, "Reset Progress", {
      fontSize: `${Math.round(10 * DPR)}px`,
      color: "#475569",
      fontFamily: FONT,
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true });
    resetBtn.on("pointerdown", () => {
      progressManager.reset();
      resetBtn.setText("Progress Reset!");
      this.time.delayedCall(1500, () => resetBtn.setText("Reset Progress"));
    });

    this.cameras.main.fadeIn(400, 0, 0, 0);
  }

  private makeButton(
    x: number, y: number, label: string,
    w: number, h: number, color: number,
    callback: () => void,
  ): void {
    const r = 14 * DPR;

    // Shadow
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.3);
    shadow.fillRoundedRect(x - w / 2 + 2 * DPR, y - h / 2 + 3 * DPR, w, h, r);

    // Body
    const body = this.add.graphics();
    const drawNormal = () => {
      body.clear();
      body.fillStyle(color, 1);
      body.fillRoundedRect(x - w / 2, y - h / 2, w, h, r);
      body.fillStyle(0xffffff, 0.1);
      body.fillRoundedRect(x - w / 2 + 2, y - h / 2 + 2, w - 4, h * 0.4,
        { tl: r, tr: r, bl: 4, br: 4 });
    };
    drawNormal();

    // Text
    this.add.text(x, y, label, {
      fontSize: `${Math.round(20 * DPR)}px`,
      color: "#ffffff",
      fontFamily: FONT,
      fontStyle: "bold",
    }).setOrigin(0.5);

    // Hit zone
    const hit = this.add.rectangle(x, y, w, h, 0x000000, 0.001)
      .setInteractive({ useHandCursor: true });

    hit.on("pointerdown", () => {
      body.clear();
      body.fillStyle(this.blendColor(color, 0x000000, 0.15), 1);
      body.fillRoundedRect(x - w / 2, y - h / 2 + 2, w, h - 2, r);
      shadow.setAlpha(0.15);
    });
    hit.on("pointerup", () => {
      drawNormal();
      shadow.setAlpha(1);
      callback();
    });
    hit.on("pointerout", () => {
      drawNormal();
      shadow.setAlpha(1);
    });
  }

  private blendColor(base: number, tint: number, amount: number): number {
    const br = (base >> 16) & 0xff, bg = (base >> 8) & 0xff, bb = base & 0xff;
    const tr = (tint >> 16) & 0xff, tg = (tint >> 8) & 0xff, tb = tint & 0xff;
    return (
      (Math.round(br + (tr - br) * amount) << 16) |
      (Math.round(bg + (tg - bg) * amount) << 8) |
      Math.round(bb + (tb - bb) * amount)
    );
  }
}
