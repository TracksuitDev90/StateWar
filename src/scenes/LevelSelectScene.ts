import Phaser from "phaser";
import { stateData } from "../data/states";
import { levels } from "../data/levels";
import { progressManager } from "../ui/ProgressManager";
import { sound } from "../audio/SoundManager";

const DPR = Math.min(window.devicePixelRatio || 1, 2);
const FONT = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// Map each state to its primary region (first level it appears in, excluding Final Showdown)
const STATE_REGION: Record<string, number> = {};
for (let i = 0; i < levels.length - 1; i++) {
  for (const id of levels[i].states) {
    if (!(id in STATE_REGION)) STATE_REGION[id] = i;
  }
}

function scaledPoly(poly: [number, number][]): [number, number][] {
  return poly.map(([x, y]) => [x * DPR, y * DPR]);
}

export class LevelSelectScene extends Phaser.Scene {
  constructor() {
    super({ key: "LevelSelectScene" });
  }

  create(): void {
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);

    this.cameras.main.setBackgroundColor(0x0f172a);
    this.cameras.main.setBounds(0, 0, 1280 * DPR, 720 * DPR);

    // Compute bounding box of contiguous US for camera framing
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of stateData) {
      if (s.id === "AK" || s.id === "HI") continue;
      for (const poly of s.polygons) {
        for (const [x, y] of poly) {
          const sx = x * DPR, sy = y * DPR;
          if (sx < minX) minX = sx;
          if (sy < minY) minY = sy;
          if (sx > maxX) maxX = sx;
          if (sy > maxY) maxY = sy;
        }
      }
    }
    const mapW = maxX - minX, mapH = maxY - minY;
    const pad = 70 * DPR;
    const headerSpace = 60 * DPR;
    const zoom = Math.min(W / (mapW + pad * 2), (H - headerSpace) / (mapH + pad * 2), 2.5);
    this.cameras.main.setZoom(Math.max(zoom, 0.3));
    this.cameras.main.centerOn((minX + maxX) / 2, (minY + maxY) / 2);

    // Draw all contiguous states colored by region status
    for (const s of stateData) {
      if (s.id === "AK" || s.id === "HI") continue;
      const region = STATE_REGION[s.id];
      if (region === undefined) continue;

      const completed = progressManager.isCompleted(region);
      const unlocked = progressManager.isUnlocked(region);
      const current = unlocked && !completed;

      let fill: number, border: number, alpha: number;
      if (completed) {
        fill = 0x2563eb; border = 0x1e40af; alpha = 0.8;
      } else if (current) {
        fill = 0xfbbf24; border = 0xd97706; alpha = 0.85;
      } else {
        fill = 0x1e293b; border = 0x334155; alpha = 0.5;
      }

      for (const poly of s.polygons) {
        if (poly.length < 3) continue;
        const scaled = scaledPoly(poly);
        const gfx = this.add.graphics().setDepth(1);

        gfx.fillStyle(fill, alpha);
        gfx.beginPath();
        gfx.moveTo(scaled[0][0], scaled[0][1]);
        for (let i = 1; i < scaled.length; i++) gfx.lineTo(scaled[i][0], scaled[i][1]);
        gfx.closePath();
        gfx.fillPath();

        gfx.lineStyle(1.5 * DPR, border, 0.7);
        gfx.beginPath();
        gfx.moveTo(scaled[0][0], scaled[0][1]);
        for (let i = 1; i < scaled.length; i++) gfx.lineTo(scaled[i][0], scaled[i][1]);
        gfx.closePath();
        gfx.strokePath();

        // Make playable regions tappable
        if (unlocked) {
          const flat: number[] = [];
          for (const [x, y] of scaled) flat.push(x, y);
          gfx.setInteractive(new Phaser.Geom.Polygon(flat), Phaser.Geom.Polygon.Contains);
          gfx.on("pointerdown", () => {
            sound.unlock();
            sound.uiTap();
            this.startLevel(region);
          });
        }
      }
    }

    // Region labels, stars, and PLAY buttons
    for (let i = 0; i < levels.length - 1; i++) {
      const level = levels[i];
      const [cx, cy] = this.regionCentroid(level.states);
      const completed = progressManager.isCompleted(i);
      const unlocked = progressManager.isUnlocked(i);
      const current = unlocked && !completed;

      const color = completed ? "#93c5fd" : current ? "#fef3c7" : "#64748b";
      this.add.text(cx, cy - 8 * DPR, level.name, {
        fontSize: `${Math.round(10 * DPR)}px`,
        color,
        fontFamily: FONT,
        fontStyle: "bold",
        stroke: "#0f172a",
        strokeThickness: 3 * DPR,
        align: "center",
      }).setOrigin(0.5).setDepth(5);

      // Stars for completed regions
      if (completed) {
        const stars = progressManager.getStars(i);
        const str = "\u2605".repeat(stars) + "\u2606".repeat(3 - stars);
        this.add.text(cx, cy + 6 * DPR, str, {
          fontSize: `${Math.round(11 * DPR)}px`,
          color: "#fbbf24",
          fontFamily: FONT,
          stroke: "#0f172a",
          strokeThickness: 2 * DPR,
        }).setOrigin(0.5).setDepth(5);
      }

      // PLAY button for current unlocked region
      if (current) {
        const playBtn = this.add.text(cx, cy + 10 * DPR, "PLAY", {
          fontSize: `${Math.round(12 * DPR)}px`,
          color: "#0f172a",
          backgroundColor: "#fbbf24",
          fontFamily: FONT,
          fontStyle: "bold",
          padding: { x: 12 * DPR, y: 5 * DPR },
        }).setOrigin(0.5).setDepth(8).setInteractive({ useHandCursor: true });
        playBtn.on("pointerdown", () => {
          sound.uiTap();
          this.startLevel(i);
        });
        this.tweens.add({
          targets: playBtn,
          scaleX: 1.08, scaleY: 1.08,
          duration: 700,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
      }

      // LOCKED label for locked regions
      if (!unlocked) {
        this.add.text(cx, cy + 8 * DPR, "LOCKED", {
          fontSize: `${Math.round(8 * DPR)}px`,
          color: "#475569",
          fontFamily: FONT,
          fontStyle: "bold",
          stroke: "#0f172a",
          strokeThickness: 2 * DPR,
        }).setOrigin(0.5).setDepth(5);
      }
    }

    // ── Fixed UI Header ──
    this.add.rectangle(W / 2, 0, W, 55 * DPR, 0x0f172a, 0.92)
      .setOrigin(0.5, 0).setDepth(10).setScrollFactor(0);

    const done = levels.slice(0, -1).filter((_, i) => progressManager.isCompleted(i)).length;

    this.add.text(W / 2, 12 * DPR, "SELECT REGION", {
      fontSize: `${Math.round(18 * DPR)}px`,
      color: "#ffffff",
      fontFamily: FONT,
      fontStyle: "bold",
    }).setOrigin(0.5, 0).setDepth(11).setScrollFactor(0);

    this.add.text(W / 2, 35 * DPR, `${done} / 9 Regions Conquered`, {
      fontSize: `${Math.round(11 * DPR)}px`,
      color: "#94a3b8",
      fontFamily: FONT,
    }).setOrigin(0.5, 0).setDepth(11).setScrollFactor(0);

    // Back button
    const back = this.add.text(14 * DPR, 16 * DPR, "< Back", {
      fontSize: `${Math.round(14 * DPR)}px`,
      color: "#60a5fa",
      fontFamily: FONT,
      fontStyle: "bold",
    }).setOrigin(0, 0).setDepth(11).setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    back.on("pointerdown", () => {
      sound.uiTap();
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.time.delayedCall(300, () => this.scene.start("TitleScene"));
    });

    // Final Showdown button (appears when all 9 regional levels complete)
    if (done >= 9) {
      const fsCompleted = progressManager.isCompleted(9);
      const fsStars = progressManager.getStars(9);
      const fsColor = fsCompleted ? 0x22c55e : 0xfbbf24;
      const fsY = H - 35 * DPR;
      const fsW = 240 * DPR;
      const fsH = 40 * DPR;

      const fsBg = this.add.graphics().setDepth(10).setScrollFactor(0);
      fsBg.fillStyle(fsColor, 1);
      fsBg.fillRoundedRect(W / 2 - fsW / 2, fsY - fsH / 2, fsW, fsH, 10 * DPR);

      let fsLabel = "FINAL SHOWDOWN";
      if (fsCompleted) fsLabel += "  " + "\u2605".repeat(fsStars) + "\u2606".repeat(3 - fsStars);
      this.add.text(W / 2, fsY, fsLabel, {
        fontSize: `${Math.round(14 * DPR)}px`,
        color: "#0f172a",
        fontFamily: FONT,
        fontStyle: "bold",
      }).setOrigin(0.5).setDepth(11).setScrollFactor(0);

      const fsZone = this.add.zone(W / 2, fsY, fsW, fsH)
        .setInteractive({ useHandCursor: true }).setDepth(12).setScrollFactor(0);
      fsZone.on("pointerdown", () => {
        sound.uiTap();
        this.startLevel(9);
      });
    }

    this.cameras.main.fadeIn(400, 0, 0, 0);
  }

  private startLevel(index: number): void {
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.time.delayedCall(400, () => {
      this.scene.start("MapScene", { levelIndex: index });
    });
  }

  private regionCentroid(stateIds: string[]): [number, number] {
    let cx = 0, cy = 0, n = 0;
    for (const id of stateIds) {
      const s = stateData.find(d => d.id === id);
      if (!s) continue;
      for (const poly of s.polygons) {
        for (const [x, y] of poly) {
          cx += x * DPR;
          cy += y * DPR;
          n++;
        }
      }
    }
    return n > 0 ? [cx / n, cy / n] : [640 * DPR, 360 * DPR];
  }
}
