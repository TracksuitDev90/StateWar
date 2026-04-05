import Phaser from "phaser";
import { stateData, StateData } from "../data/states";

// Color palette for states — enough variety to distinguish neighbors
const STATE_COLORS: number[] = [
  0x4a90d9, 0x50b86c, 0xd4a843, 0xc75050, 0x8b5fc7,
  0x4ecdc4, 0xf7a55d, 0x6a8d73, 0xd4738a, 0x7a9cc6,
  0xb8a960, 0x5f9ea0, 0xe8726a, 0x9b8ec4, 0x48b09e,
  0xd4945a, 0x7fb069, 0xca7eb8, 0x6b9dc7, 0xaab85f,
  0xd98a8a, 0x56a08c, 0xc4a254, 0x7d8cc4, 0xe0956e,
];

const HOVER_TINT = 0.3;
const BORDER_COLOR = 0x222222;
const BORDER_WIDTH = 1.5;

interface StateGraphic {
  data: StateData;
  fills: Phaser.GameObjects.Graphics[];
  baseColor: number;
}

export class MapScene extends Phaser.Scene {
  private stateGraphics: StateGraphic[] = [];
  private infoText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "MapScene" });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x1a1a2e);

    // Draw each state
    for (let i = 0; i < stateData.length; i++) {
      const state = stateData[i];
      const color = STATE_COLORS[i % STATE_COLORS.length];
      const fills: Phaser.GameObjects.Graphics[] = [];

      for (const polygon of state.polygons) {
        if (polygon.length < 3) continue;

        const gfx = this.add.graphics();
        this.drawStatePoly(gfx, polygon, color, BORDER_COLOR, BORDER_WIDTH);

        // Make interactive using a hit area polygon
        const flatPoints: number[] = [];
        for (const [x, y] of polygon) {
          flatPoints.push(x, y);
        }
        const hitArea = new Phaser.Geom.Polygon(flatPoints);

        gfx.setInteractive(hitArea, Phaser.Geom.Polygon.Contains);
        gfx.setData("stateId", state.id);

        gfx.on("pointerover", () => this.onStateHover(state, color, true));
        gfx.on("pointerout", () => this.onStateHover(state, color, false));
        gfx.on("pointerdown", () => this.onStateClick(state));

        fills.push(gfx);
      }

      this.stateGraphics.push({ data: state, fills, baseColor: color });
    }

    // Draw state labels (abbreviations) at centroids
    for (const sg of this.stateGraphics) {
      const centroid = this.computeCentroid(sg.data.polygons[0]);
      this.add.text(centroid[0], centroid[1], sg.data.id, {
        fontSize: "9px",
        color: "#ffffff",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 2,
      }).setOrigin(0.5);
    }

    // Info text at top
    this.infoText = this.add.text(640, 16, "Click a state", {
      fontSize: "20px",
      color: "#ffffff",
      fontFamily: "monospace",
    }).setOrigin(0.5, 0);
  }

  private drawStatePoly(
    gfx: Phaser.GameObjects.Graphics,
    polygon: [number, number][],
    fillColor: number,
    strokeColor: number,
    strokeWidth: number
  ): void {
    gfx.clear();
    gfx.fillStyle(fillColor, 1);
    gfx.lineStyle(strokeWidth, strokeColor, 1);

    gfx.beginPath();
    gfx.moveTo(polygon[0][0], polygon[0][1]);
    for (let i = 1; i < polygon.length; i++) {
      gfx.lineTo(polygon[i][0], polygon[i][1]);
    }
    gfx.closePath();
    gfx.fillPath();
    gfx.strokePath();
  }

  private onStateHover(state: StateData, baseColor: number, hovering: boolean): void {
    const sg = this.stateGraphics.find(s => s.data.id === state.id);
    if (!sg) return;

    const color = hovering ? this.lightenColor(baseColor, HOVER_TINT) : baseColor;

    for (let i = 0; i < sg.fills.length; i++) {
      const polygon = state.polygons[i];
      if (polygon) {
        this.drawStatePoly(sg.fills[i], polygon, color, BORDER_COLOR, BORDER_WIDTH);
      }
    }

    if (hovering) {
      this.infoText.setText(state.name);
    } else {
      this.infoText.setText("Click a state");
    }
  }

  private onStateClick(state: StateData): void {
    this.infoText.setText(`Selected: ${state.name} (${state.id})`);
  }

  private computeCentroid(polygon: [number, number][]): [number, number] {
    let cx = 0, cy = 0;
    for (const [x, y] of polygon) {
      cx += x;
      cy += y;
    }
    return [cx / polygon.length, cy / polygon.length];
  }

  private lightenColor(color: number, amount: number): number {
    let r = (color >> 16) & 0xff;
    let g = (color >> 8) & 0xff;
    let b = color & 0xff;
    r = Math.min(255, Math.floor(r + (255 - r) * amount));
    g = Math.min(255, Math.floor(g + (255 - g) * amount));
    b = Math.min(255, Math.floor(b + (255 - b) * amount));
    return (r << 16) | (g << 8) | b;
  }
}
