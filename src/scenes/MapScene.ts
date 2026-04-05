import Phaser from "phaser";
import { stateData, StateData } from "../data/states";
import { stateBonuses } from "../data/stateBonuses";
import { GameStateManager } from "../state/GameStateManager";
import { LogicTick } from "../state/LogicTick";
import { Owner, CombatResult } from "../types";

const DPR = Math.min(window.devicePixelRatio || 1, 2);

// Owner-based colors
const OWNER_COLORS: Record<Owner, number> = {
  player: 0x3b82f6,
  ai: 0xef4444,
  neutral: 0x6b7280,
};

const SELECTED_BORDER = 0xfbbf24;
const VALID_TARGET_BORDER = 0x22d3ee;
const BORDER_COLOR = 0x1f2937;
const BORDER_WIDTH = 1.5 * DPR;
const SELECTED_BORDER_WIDTH = 3 * DPR;

// Railway colors by level
const RAIL_COLORS: Record<number, number> = {
  1: 0x9ca3af, // gray — slow
  2: 0xfbbf24, // yellow — standard
  3: 0x22d3ee, // cyan — express
};
const RAIL_UNBUILT_COLOR = 0x374151;
const RAIL_LINE_WIDTH = [0, 1.5, 2.5, 3.5]; // by level

interface StateVisual {
  data: StateData;
  gfxList: Phaser.GameObjects.Graphics[];
  label: Phaser.GameObjects.Text;
  unitText: Phaser.GameObjects.Text;
  centroid: [number, number];
}

type InteractionMode = "select" | "build";

function scaledPolygon(polygon: [number, number][]): [number, number][] {
  return polygon.map(([x, y]) => [x * DPR, y * DPR]);
}

export class MapScene extends Phaser.Scene {
  private visuals: Map<string, StateVisual> = new Map();
  private gsm!: GameStateManager;
  private logicTick!: LogicTick;
  private selectedStateId: string | null = null;
  private infoText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private railGfx!: Phaser.GameObjects.Graphics;
  private modeText!: Phaser.GameObjects.Text;
  private mode: InteractionMode = "select";

  constructor() {
    super({ key: "MapScene" });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x111827);
    this.gsm = new GameStateManager();

    // Railway layer (drawn under states)
    this.railGfx = this.add.graphics().setDepth(0);

    // Build visuals for each state
    for (const state of stateData) {
      const centroid = this.computeCentroid(state.polygons[0]);
      const cx = centroid[0] * DPR;
      const cy = centroid[1] * DPR;
      const gfxList: Phaser.GameObjects.Graphics[] = [];

      for (const polygon of state.polygons) {
        if (polygon.length < 3) continue;

        const gfx = this.add.graphics().setDepth(1);
        const scaled = scaledPolygon(polygon);
        const flatPoints: number[] = [];
        for (const [x, y] of scaled) flatPoints.push(x, y);
        const hitArea = new Phaser.Geom.Polygon(flatPoints);

        gfx.setInteractive(hitArea, Phaser.Geom.Polygon.Contains);
        gfx.on("pointerover", () => this.onHover(state.id, true));
        gfx.on("pointerout", () => this.onHover(state.id, false));
        gfx.on("pointerdown", () => this.onClickState(state.id));

        gfxList.push(gfx);
      }

      const label = this.add.text(cx, cy - 10 * DPR, state.id, {
        fontSize: `${Math.round(12 * DPR)}px`,
        color: "#ffffff",
        fontFamily: "'Segoe UI', Arial, sans-serif",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3 * DPR,
      }).setOrigin(0.5).setDepth(3);

      const unitText = this.add.text(cx, cy + 8 * DPR, "", {
        fontSize: `${Math.round(14 * DPR)}px`,
        color: "#ffffff",
        fontFamily: "'Segoe UI', Arial, sans-serif",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4 * DPR,
      }).setOrigin(0.5).setDepth(3);

      this.visuals.set(state.id, { data: state, gfxList, label, unitText, centroid });
    }

    // Info bar
    this.infoText = this.add.text(640 * DPR, 14 * DPR, "Select one of your states (blue)", {
      fontSize: `${Math.round(18 * DPR)}px`,
      color: "#ffffff",
      fontFamily: "'Segoe UI', Arial, sans-serif",
    }).setOrigin(0.5, 0).setDepth(4);

    // Stats display (bottom-right)
    this.statsText = this.add.text(1270 * DPR, 708 * DPR, "", {
      fontSize: `${Math.round(14 * DPR)}px`,
      color: "#d1d5db",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      align: "right",
    }).setOrigin(1, 1).setDepth(4);

    // Mode toggle button (bottom-left)
    this.modeText = this.add.text(10 * DPR, 708 * DPR, "[R] Build Rails", {
      fontSize: `${Math.round(14 * DPR)}px`,
      color: "#fbbf24",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontStyle: "bold",
      backgroundColor: "#1f2937",
      padding: { x: 6 * DPR, y: 3 * DPR },
    }).setOrigin(0, 1).setDepth(4).setInteractive({ useHandCursor: true });

    this.modeText.on("pointerdown", () => this.toggleMode());

    // Right-click or Escape to deselect
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) this.deselect();
    });
    if (this.input.keyboard) {
      this.input.keyboard.on("keydown-ESC", () => this.deselect());
      this.input.keyboard.on("keydown-R", () => this.toggleMode());
    }

    // Start logic tick (1000ms interval, separate from 60fps render)
    this.logicTick = new LogicTick(this.gsm, () => {
      this.redrawAll();
      this.updateStats();
    });
    this.logicTick.start();

    this.redrawAll();
    this.updateStats();
  }

  // ── Mode ──

  private toggleMode(): void {
    this.deselect();
    this.mode = this.mode === "select" ? "build" : "select";
    this.modeText.setText(this.mode === "select" ? "[R] Build Rails" : "[R] Move Units");
    this.modeText.setColor(this.mode === "select" ? "#fbbf24" : "#22d3ee");
    this.updateInfoDefault();
    this.redrawAll();
  }

  // ── Rendering ──

  private redrawAll(): void {
    this.drawRailways();
    for (const [id, vis] of this.visuals) {
      this.redrawState(id, vis);
    }
  }

  private drawRailways(): void {
    this.railGfx.clear();

    for (const rail of this.gsm.railways) {
      const fromVis = this.visuals.get(rail.from);
      const toVis = this.visuals.get(rail.to);
      if (!fromVis || !toVis) continue;

      const fx = fromVis.centroid[0] * DPR;
      const fy = fromVis.centroid[1] * DPR;
      const tx = toVis.centroid[0] * DPR;
      const ty = toVis.centroid[1] * DPR;

      if (rail.level === 0) {
        // Show potential routes as faint dotted lines in build mode
        if (this.mode === "build") {
          this.drawDashedLine(this.railGfx, fx, fy, tx, ty, RAIL_UNBUILT_COLOR, 1 * DPR, 6 * DPR);
        }
      } else {
        // Built railway — solid colored line
        const color = RAIL_COLORS[rail.level] ?? 0xffffff;
        const width = RAIL_LINE_WIDTH[rail.level] * DPR;
        this.railGfx.lineStyle(width, color, 0.8);
        this.railGfx.beginPath();
        this.railGfx.moveTo(fx, fy);
        this.railGfx.lineTo(tx, ty);
        this.railGfx.strokePath();

        // Draw small diamond at midpoint for built rails
        const mx = (fx + tx) / 2;
        const my = (fy + ty) / 2;
        const s = 3 * DPR;
        this.railGfx.fillStyle(color, 1);
        this.railGfx.fillTriangle(mx, my - s, mx + s, my, mx, my + s);
        this.railGfx.fillTriangle(mx, my - s, mx - s, my, mx, my + s);
      }
    }
  }

  private drawDashedLine(
    gfx: Phaser.GameObjects.Graphics,
    x1: number, y1: number, x2: number, y2: number,
    color: number, width: number, dashLen: number,
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = dx / len;
    const ny = dy / len;

    gfx.lineStyle(width, color, 0.4);
    let drawn = 0;
    let drawing = true;
    while (drawn < len) {
      const seg = Math.min(dashLen, len - drawn);
      if (drawing) {
        gfx.beginPath();
        gfx.moveTo(x1 + nx * drawn, y1 + ny * drawn);
        gfx.lineTo(x1 + nx * (drawn + seg), y1 + ny * (drawn + seg));
        gfx.strokePath();
      }
      drawn += seg;
      drawing = !drawing;
    }
  }

  private redrawState(id: string, vis: StateVisual, hovered = false): void {
    const owner = this.gsm.getOwner(id);
    const units = this.gsm.getUnits(id);
    const isSelected = this.selectedStateId === id;
    const isValidTarget = this.selectedStateId !== null && this.isValidTarget(id);

    let fillColor = OWNER_COLORS[owner];
    if (hovered) fillColor = this.lightenColor(fillColor, 0.2);

    let borderColor = BORDER_COLOR;
    let borderWidth = BORDER_WIDTH;

    if (isSelected) {
      borderColor = SELECTED_BORDER;
      borderWidth = SELECTED_BORDER_WIDTH;
    } else if (isValidTarget) {
      borderColor = VALID_TARGET_BORDER;
      borderWidth = 2.5 * DPR;
    }

    for (let i = 0; i < vis.gfxList.length; i++) {
      const polygon = vis.data.polygons[i];
      if (polygon) this.drawPoly(vis.gfxList[i], scaledPolygon(polygon), fillColor, borderColor, borderWidth);
    }

    vis.unitText.setText(String(units));
  }

  private drawPoly(
    gfx: Phaser.GameObjects.Graphics,
    polygon: [number, number][],
    fill: number,
    stroke: number,
    strokeW: number,
  ): void {
    gfx.clear();
    gfx.fillStyle(fill, 1);
    gfx.lineStyle(strokeW, stroke, 1);
    gfx.beginPath();
    gfx.moveTo(polygon[0][0], polygon[0][1]);
    for (let i = 1; i < polygon.length; i++) gfx.lineTo(polygon[i][0], polygon[i][1]);
    gfx.closePath();
    gfx.fillPath();
    gfx.strokePath();
  }

  // ── Interaction ──

  private onHover(stateId: string, hovering: boolean): void {
    const vis = this.visuals.get(stateId);
    if (!vis) return;
    this.redrawState(stateId, vis, hovering);

    if (hovering) {
      const owner = this.gsm.getOwner(stateId);
      const units = this.gsm.getUnits(stateId);
      const def = this.gsm.getDefenseBonus(stateId);
      const defStr = def !== 1.0 ? ` | def ×${def}` : "";

      if (this.mode === "build" && this.selectedStateId) {
        // Show build cost preview
        const rail = this.gsm.getRailway(this.selectedStateId, stateId);
        if (rail) {
          const nextLvl = rail.level + 1;
          const costMap: Record<number, number> = { 1: 5, 2: 8, 3: 12 };
          const cost = costMap[nextLvl];
          if (cost) {
            this.infoText.setText(`${vis.data.name} | Build Lv${nextLvl} rail — costs ${cost} units`);
          } else {
            this.infoText.setText(`${vis.data.name} | Railway maxed out`);
          }
          return;
        }
      }

      const genRate = this.logicTick.getGenRate(stateId);
      const genStr = genRate > 0 ? ` | +${genRate.toFixed(1)}/s` : "";
      const bonus = stateBonuses[stateId];
      const bonusStr = bonus ? ` | ${bonus.description}` : "";

      // Show railway info
      const rails = this.gsm.getRailwaysForState(stateId).filter(r => r.level > 0);
      const railStr = rails.length > 0
        ? ` | ${rails.length} rail${rails.length > 1 ? "s" : ""}`
        : "";

      this.infoText.setText(`${vis.data.name} | ${owner} | ${units} units${defStr}${genStr}${bonusStr}${railStr}`);
    } else {
      this.updateInfoDefault();
    }
  }

  private onClickState(stateId: string): void {
    if (this.mode === "build") {
      this.onClickStateBuildMode(stateId);
      return;
    }

    // Select mode
    if (this.selectedStateId === null) {
      if (this.gsm.getOwner(stateId) === "player") {
        this.selectedStateId = stateId;
        this.redrawAll();
        const vis = this.visuals.get(stateId)!;
        const units = this.gsm.getUnits(stateId);
        this.infoText.setText(`${vis.data.name} selected (${units} units) — tap adjacent state`);
      }
      return;
    }

    if (stateId === this.selectedStateId) {
      this.deselect();
      return;
    }

    if (this.isValidTarget(stateId)) {
      this.executeMove(stateId);
      return;
    }

    if (this.gsm.getOwner(stateId) === "player") {
      this.selectedStateId = stateId;
      this.redrawAll();
      return;
    }

    this.deselect();
  }

  private onClickStateBuildMode(stateId: string): void {
    if (this.selectedStateId === null) {
      // Select source state for building
      if (this.gsm.getOwner(stateId) === "player") {
        const buildable = this.gsm.getBuildableRailways(stateId);
        if (buildable.length === 0) {
          this.infoText.setText("No railway routes available from this state");
          return;
        }
        this.selectedStateId = stateId;
        this.redrawAll();
        const vis = this.visuals.get(stateId)!;
        this.infoText.setText(`${vis.data.name} — tap a connected state to build/upgrade rail`);
      }
      return;
    }

    if (stateId === this.selectedStateId) {
      this.deselect();
      return;
    }

    // Try to build railway
    const result = this.gsm.buildRailway(this.selectedStateId, stateId);
    if (result.success) {
      this.infoText.setText(result.message);
    } else {
      this.infoText.setText(result.message);
    }

    this.deselect();
    this.redrawAll();
  }

  private isValidTarget(targetId: string): boolean {
    if (!this.selectedStateId) return false;

    if (this.mode === "build") {
      // In build mode, valid targets are states with railway routes from selected
      const rail = this.gsm.getRailway(this.selectedStateId, targetId);
      return rail !== undefined && rail.level < 3;
    }

    return this.gsm.canMove(this.selectedStateId, targetId)
      || this.gsm.canAttack(this.selectedStateId, targetId);
  }

  private executeMove(targetId: string): void {
    const fromId = this.selectedStateId!;
    const fromOwner = this.gsm.getOwner(fromId);
    const toOwner = this.gsm.getOwner(targetId);
    let attackers = this.gsm.getUnits(fromId) - 1;

    if (attackers < 1) {
      this.infoText.setText("Not enough units to move!");
      this.deselect();
      return;
    }

    const targetVis = this.visuals.get(targetId)!;

    // Apply express rail bonus
    const expressBonus = this.gsm.getRailExpressBonus(fromId, targetId);

    if (fromOwner === toOwner) {
      this.gsm.moveUnits(fromId, targetId, attackers);
      if (expressBonus > 0) {
        // Express bonus: add extra units at destination
        const bonus = Math.floor(attackers * expressBonus);
        if (bonus > 0) {
          this.gsm.state[targetId].units += bonus;
          this.infoText.setText(`Moved ${attackers}+${bonus} units to ${targetVis.data.name} (Express)`);
        } else {
          this.infoText.setText(`Moved ${attackers} units to ${targetVis.data.name}`);
        }
      } else {
        this.infoText.setText(`Moved ${attackers} units to ${targetVis.data.name}`);
      }
    } else {
      if (expressBonus > 0) {
        attackers += Math.floor(attackers * expressBonus);
      }
      const result: CombatResult = this.gsm.resolveCombat(fromId, targetId, attackers);
      if (result.captured) {
        this.infoText.setText(
          `Captured ${targetVis.data.name}! Lost ${result.attackerLost}, killed ${result.defenderLost}`
        );
      } else {
        this.infoText.setText(
          `Attack on ${targetVis.data.name} failed! Lost ${result.attackerLost}, killed ${result.defenderLost}`
        );
      }
    }

    this.selectedStateId = null;
    this.redrawAll();
  }

  private deselect(): void {
    if (this.selectedStateId === null) return;
    this.selectedStateId = null;
    this.redrawAll();
    this.updateInfoDefault();
  }

  private updateInfoDefault(): void {
    if (this.mode === "build") {
      this.infoText.setText("BUILD MODE — select a state to build/upgrade railways");
    } else if (this.selectedStateId) {
      const vis = this.visuals.get(this.selectedStateId)!;
      this.infoText.setText(`${vis.data.name} selected — tap adjacent state`);
    } else {
      this.infoText.setText("Select one of your states (blue)");
    }
  }

  private updateStats(): void {
    const pStates = this.logicTick.countStates("player");
    const pUnits = this.logicTick.countUnits("player");
    const aStates = this.logicTick.countStates("ai");
    const aUnits = this.logicTick.countUnits("ai");
    const builtRails = this.gsm.railways.filter(r => r.level > 0).length;
    const railStr = builtRails > 0 ? `  |  Rails: ${builtRails}` : "";
    this.statsText.setText(
      `You: ${pStates} states, ${pUnits} units  |  AI: ${aStates} states, ${aUnits} units${railStr}`
    );
  }

  shutdown(): void {
    this.logicTick.stop();
  }

  // ── Utilities ──

  private computeCentroid(polygon: [number, number][]): [number, number] {
    let cx = 0, cy = 0;
    for (const [x, y] of polygon) { cx += x; cy += y; }
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
