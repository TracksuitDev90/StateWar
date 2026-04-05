import Phaser from "phaser";
import { stateData, StateData } from "../data/states";
import { stateBonuses } from "../data/stateBonuses";
import { GameStateManager } from "../state/GameStateManager";
import { LogicTick } from "../state/LogicTick";
import { Owner, CombatResult } from "../types";

// Owner-based colors
const OWNER_COLORS: Record<Owner, number> = {
  player: 0x3b82f6,
  ai: 0xef4444,
  neutral: 0x6b7280,
};

const SELECTED_BORDER = 0xfbbf24;
const VALID_TARGET_BORDER = 0x22d3ee;
const BORDER_COLOR = 0x1f2937;
const BORDER_WIDTH = 1.5;
const SELECTED_BORDER_WIDTH = 3;

interface StateVisual {
  data: StateData;
  gfxList: Phaser.GameObjects.Graphics[];
  label: Phaser.GameObjects.Text;
  unitText: Phaser.GameObjects.Text;
  centroid: [number, number];
}

export class MapScene extends Phaser.Scene {
  private visuals: Map<string, StateVisual> = new Map();
  private gsm!: GameStateManager;
  private logicTick!: LogicTick;
  private selectedStateId: string | null = null;
  private infoText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "MapScene" });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x111827);
    this.gsm = new GameStateManager();

    // Build visuals for each state
    for (const state of stateData) {
      const centroid = this.computeCentroid(state.polygons[0]);
      const gfxList: Phaser.GameObjects.Graphics[] = [];

      for (const polygon of state.polygons) {
        if (polygon.length < 3) continue;

        const gfx = this.add.graphics();
        const flatPoints: number[] = [];
        for (const [x, y] of polygon) flatPoints.push(x, y);
        const hitArea = new Phaser.Geom.Polygon(flatPoints);

        gfx.setInteractive(hitArea, Phaser.Geom.Polygon.Contains);
        gfx.on("pointerover", () => this.onHover(state.id, true));
        gfx.on("pointerout", () => this.onHover(state.id, false));
        gfx.on("pointerdown", () => this.onClickState(state.id));

        gfxList.push(gfx);
      }

      const label = this.add.text(centroid[0], centroid[1] - 8, state.id, {
        fontSize: "9px",
        color: "#ffffff",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 2,
      }).setOrigin(0.5).setDepth(1);

      const unitText = this.add.text(centroid[0], centroid[1] + 6, "", {
        fontSize: "11px",
        color: "#ffffff",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      }).setOrigin(0.5).setDepth(1);

      this.visuals.set(state.id, { data: state, gfxList, label, unitText, centroid });
    }

    // Info bar
    this.infoText = this.add.text(640, 12, "Select one of your states (blue)", {
      fontSize: "18px",
      color: "#ffffff",
      fontFamily: "monospace",
    }).setOrigin(0.5, 0).setDepth(2);

    // Stats display (bottom-right)
    this.statsText = this.add.text(1270, 708, "", {
      fontSize: "13px",
      color: "#d1d5db",
      fontFamily: "monospace",
      align: "right",
    }).setOrigin(1, 1).setDepth(2);

    // Right-click or Escape to deselect
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) this.deselect();
    });
    this.input.keyboard!.on("keydown-ESC", () => this.deselect());

    // Start logic tick (1000ms interval, separate from 60fps render)
    this.logicTick = new LogicTick(this.gsm, () => {
      this.redrawAll();
      this.updateStats();
    });
    this.logicTick.start();

    this.redrawAll();
    this.updateStats();
  }

  // ── Rendering ──

  private redrawAll(): void {
    for (const [id, vis] of this.visuals) {
      this.redrawState(id, vis);
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
      borderWidth = 2.5;
    }

    for (let i = 0; i < vis.gfxList.length; i++) {
      const polygon = vis.data.polygons[i];
      if (polygon) this.drawPoly(vis.gfxList[i], polygon, fillColor, borderColor, borderWidth);
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
      const genRate = this.logicTick.getGenRate(stateId);
      const genStr = genRate > 0 ? ` | +${genRate.toFixed(1)}/s` : "";
      const bonus = stateBonuses[stateId];
      const bonusStr = bonus ? ` | ${bonus.description}` : "";
      this.infoText.setText(`${vis.data.name} | ${owner} | ${units} units${defStr}${genStr}${bonusStr}`);
    } else {
      this.updateInfoDefault();
    }
  }

  private onClickState(stateId: string): void {
    // If nothing selected, try to select a player state
    if (this.selectedStateId === null) {
      if (this.gsm.getOwner(stateId) === "player") {
        this.selectedStateId = stateId;
        this.redrawAll();
        const vis = this.visuals.get(stateId)!;
        const units = this.gsm.getUnits(stateId);
        this.infoText.setText(`${vis.data.name} selected (${units} units) — click adjacent state to move`);
      }
      return;
    }

    // If clicking the already-selected state, deselect
    if (stateId === this.selectedStateId) {
      this.deselect();
      return;
    }

    // If clicking a valid target, move units
    if (this.isValidTarget(stateId)) {
      this.executeMove(stateId);
      return;
    }

    // If clicking another player state, switch selection
    if (this.gsm.getOwner(stateId) === "player") {
      this.selectedStateId = stateId;
      this.redrawAll();
      return;
    }

    // Otherwise deselect
    this.deselect();
  }

  private isValidTarget(targetId: string): boolean {
    if (!this.selectedStateId) return false;
    return this.gsm.canMove(this.selectedStateId, targetId)
      || this.gsm.canAttack(this.selectedStateId, targetId);
  }

  private executeMove(targetId: string): void {
    const fromId = this.selectedStateId!;
    const fromOwner = this.gsm.getOwner(fromId);
    const toOwner = this.gsm.getOwner(targetId);
    const attackers = this.gsm.getUnits(fromId) - 1; // leave 1 behind

    if (attackers < 1) {
      this.infoText.setText("Not enough units to move!");
      this.deselect();
      return;
    }

    const targetVis = this.visuals.get(targetId)!;

    if (fromOwner === toOwner) {
      // Friendly move
      this.gsm.moveUnits(fromId, targetId, attackers);
      this.infoText.setText(`Moved ${attackers} units to ${targetVis.data.name}`);
    } else {
      // Combat
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
    if (this.selectedStateId) {
      const vis = this.visuals.get(this.selectedStateId)!;
      this.infoText.setText(`${vis.data.name} selected — click adjacent state to move`);
    } else {
      this.infoText.setText("Select one of your states (blue)");
    }
  }

  private updateStats(): void {
    const pStates = this.logicTick.countStates("player");
    const pUnits = this.logicTick.countUnits("player");
    const aStates = this.logicTick.countStates("ai");
    const aUnits = this.logicTick.countUnits("ai");
    this.statsText.setText(
      `Player: ${pStates} states, ${pUnits} units  |  AI: ${aStates} states, ${aUnits} units`
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
