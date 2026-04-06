import Phaser from "phaser";
import { stateData, StateData } from "../data/states";
import { stateBonuses } from "../data/stateBonuses";
import { GameStateManager } from "../state/GameStateManager";
import { LogicTick } from "../state/LogicTick";
import { Owner, CombatResult, UnitMoveEvent } from "../types";

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

// Railway visuals
const RAIL_COLOR_PLAYER = 0x60a5fa; // blue tint for player rails
const RAIL_COLOR_AI = 0xf87171;     // red tint for AI rails
const RAIL_LINE_WIDTH = 2.5;

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

  // Drag-to-move state
  private dragSourceId: string | null = null;
  private dragLineGfx!: Phaser.GameObjects.Graphics;
  private isDragging = false;

  constructor() {
    super({ key: "MapScene" });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x111827);
    this.gsm = new GameStateManager();

    // Listen for AI/consolidation move events and animate them
    this.gsm.onMove((event: UnitMoveEvent) => {
      const fromVis = this.visuals.get(event.from);
      const toVis = this.visuals.get(event.to);
      if (fromVis && toVis) {
        const color = event.owner === "player" ? 0x60a5fa : 0xf87171;
        this.animateUnitMovement(fromVis, toVis, event.count, color, () => {
          this.redrawAll();
        });
      }
    });

    // Railway layer (drawn under states)
    this.railGfx = this.add.graphics().setDepth(0);

    // Drag line layer (drawn above states)
    this.dragLineGfx = this.add.graphics().setDepth(7);

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
        gfx.on("pointerdown", (pointer: Phaser.Input.Pointer) => this.onPointerDownState(state.id, pointer));

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

    // Drag-to-move: draw line while dragging, resolve on release
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.isDragging || !this.dragSourceId) return;
      this.drawDragLine(pointer);
    });

    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (!this.isDragging || !this.dragSourceId) return;
      this.dragLineGfx.clear();
      // Find what state the pointer is over
      const targetId = this.findStateAtPoint(pointer.x, pointer.y);
      if (targetId && targetId !== this.dragSourceId) {
        this.selectedStateId = this.dragSourceId;
        if (this.isValidTarget(targetId)) {
          this.executeMove(targetId);
        } else {
          this.deselect();
        }
      }
      this.isDragging = false;
      this.dragSourceId = null;
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

      const color = rail.owner === "player" ? RAIL_COLOR_PLAYER : RAIL_COLOR_AI;
      const width = RAIL_LINE_WIDTH * DPR;
      this.railGfx.lineStyle(width, color, 0.8);
      this.railGfx.beginPath();
      this.railGfx.moveTo(fx, fy);
      this.railGfx.lineTo(tx, ty);
      this.railGfx.strokePath();

      // Small diamond at midpoint
      const mx = (fx + tx) / 2;
      const my = (fy + ty) / 2;
      const s = 3 * DPR;
      this.railGfx.fillStyle(color, 1);
      this.railGfx.fillTriangle(mx, my - s, mx + s, my, mx, my + s);
      this.railGfx.fillTriangle(mx, my - s, mx - s, my, mx, my + s);
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
        const existing = this.gsm.getRailway(this.selectedStateId, stateId);
        if (existing) {
          this.infoText.setText(`${vis.data.name} | Rail already connected`);
        } else if (this.gsm.getOwner(stateId) === "player") {
          this.infoText.setText(`${vis.data.name} | Build rail — costs 5 units`);
        } else {
          this.infoText.setText(`${vis.data.name} | Must own this state to build rail`);
        }
        return;
      }

      const genRate = this.logicTick.getGenRate(stateId);
      const genStr = genRate > 0 ? ` | +${genRate.toFixed(1)}/s` : "";
      const bonus = stateBonuses[stateId];
      const bonusStr = bonus ? ` | ${bonus.description}` : "";

      // Show railway info
      const rails = this.gsm.getRailwaysForState(stateId);
      const railStr = rails.length > 0
        ? ` | ${rails.length} rail${rails.length > 1 ? "s" : ""}`
        : "";

      this.infoText.setText(`${vis.data.name} | ${owner} | ${units} units${defStr}${genStr}${bonusStr}${railStr}`);
    } else {
      this.updateInfoDefault();
    }
  }

  private onPointerDownState(stateId: string, _pointer: Phaser.Input.Pointer): void {
    if (this.mode === "build") {
      this.onClickStateBuildMode(stateId);
      return;
    }

    // If we already have a selected state and click a target, execute immediately (click flow)
    if (this.selectedStateId !== null && stateId !== this.selectedStateId) {
      if (this.isValidTarget(stateId)) {
        this.executeMove(stateId);
        return;
      }
    }

    // Start drag from an owned state
    if (this.gsm.getOwner(stateId) === "player" && this.gsm.getUnits(stateId) > 1) {
      this.dragSourceId = stateId;
      this.isDragging = true;
      this.selectedStateId = stateId;
      this.redrawAll();
      const vis = this.visuals.get(stateId)!;
      const units = this.gsm.getUnits(stateId);
      this.infoText.setText(`${vis.data.name} selected (${units} units) — drag to target or tap`);
      return;
    }

    if (stateId === this.selectedStateId) {
      this.deselect();
      return;
    }

    this.deselect();
  }

  private onClickStateBuildMode(stateId: string): void {
    if (this.selectedStateId === null) {
      // Select source state for building
      if (this.gsm.getOwner(stateId) === "player") {
        this.selectedStateId = stateId;
        this.redrawAll();
        const vis = this.visuals.get(stateId)!;
        this.infoText.setText(`${vis.data.name} — tap any other state you own to build a rail`);
      }
      return;
    }

    if (stateId === this.selectedStateId) {
      this.deselect();
      return;
    }

    // Try to build railway between any two owned states
    const result = this.gsm.buildRailway(this.selectedStateId, stateId);
    this.infoText.setText(result.message);
    this.deselect();
    this.redrawAll();
  }

  private isValidTarget(targetId: string): boolean {
    if (!this.selectedStateId) return false;

    if (this.mode === "build") {
      // In build mode, any other owned state without an existing rail is valid
      if (this.gsm.getOwner(targetId) !== "player") return false;
      const existing = this.gsm.getRailway(this.selectedStateId, targetId);
      return !existing;
    }

    return this.gsm.canMove(this.selectedStateId, targetId)
      || this.gsm.canAttack(this.selectedStateId, targetId);
  }

  private executeMove(targetId: string): void {
    const fromId = this.selectedStateId!;
    const fromOwner = this.gsm.getOwner(fromId);
    const toOwner = this.gsm.getOwner(targetId);
    const attackers = this.gsm.getUnits(fromId) - 1;

    if (attackers < 1) {
      this.infoText.setText("Not enough units to move!");
      this.deselect();
      return;
    }

    const fromVis = this.visuals.get(fromId)!;
    const targetVis = this.visuals.get(targetId)!;

    // Deduct units from source immediately (so player sees them leave)
    this.gsm.state[fromId].units = 1;

    // Animate circles flying to target, then resolve on arrival
    const color = fromOwner === "player" ? 0x60a5fa : 0xf87171;
    this.animateUnitMovement(fromVis, targetVis, attackers, color, () => {
      if (fromOwner === toOwner) {
        // Friendly move — add units at destination
        this.gsm.state[targetId].units += attackers;
        this.infoText.setText(`Moved ${attackers} units to ${targetVis.data.name}`);
      } else {
        // Combat — resolve on arrival
        const result: CombatResult = this.gsm.resolveCombat(fromId, targetId, attackers, true);
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
      this.redrawAll();
    });

    this.selectedStateId = null;
    this.redrawAll();
  }

  /** Animate circles moving from one state to another, then call onComplete */
  private animateUnitMovement(
    fromVis: StateVisual,
    toVis: StateVisual,
    count: number,
    color: number,
    onComplete: () => void,
  ): void {
    const sx = fromVis.centroid[0] * DPR;
    const sy = fromVis.centroid[1] * DPR;
    const tx = toVis.centroid[0] * DPR;
    const ty = toVis.centroid[1] * DPR;

    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = Math.max(600, Math.min(1600, dist * 3)); // 600-1600ms — slower, more visible

    // Create a cluster of circles (up to 5 visual dots, larger)
    const dotCount = Math.min(count, 5);
    const dots: Phaser.GameObjects.Arc[] = [];

    for (let i = 0; i < dotCount; i++) {
      const radius = Math.max(5, Math.min(10, 4 + count / 3)) * DPR;
      const dot = this.add.circle(sx, sy, radius, color, 0.9).setDepth(5);
      dots.push(dot);
    }

    // Unit count label that travels with the dots
    const label = this.add.text(sx, sy - 10 * DPR, String(count), {
      fontSize: `${Math.round(12 * DPR)}px`,
      color: "#ffffff",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3 * DPR,
    }).setOrigin(0.5).setDepth(6);

    // Stagger the dots slightly for a "stream" look
    for (let i = 0; i < dots.length; i++) {
      const delay = i * 40;
      this.tweens.add({
        targets: dots[i],
        x: tx,
        y: ty,
        duration,
        delay,
        ease: "Sine.easeInOut",
        onComplete: () => {
          dots[i].destroy();
        },
      });
    }

    // Tween the label along with the dots
    this.tweens.add({
      targets: label,
      x: tx,
      y: ty - 10 * DPR,
      duration,
      ease: "Sine.easeInOut",
      onComplete: () => {
        label.destroy();
        onComplete();
      },
    });
  }

  /** Draw drag indicator line from source state to pointer, snapping to target state if hovering one */
  private drawDragLine(pointer: Phaser.Input.Pointer): void {
    this.dragLineGfx.clear();
    if (!this.dragSourceId) return;

    const fromVis = this.visuals.get(this.dragSourceId);
    if (!fromVis) return;

    const sx = fromVis.centroid[0] * DPR;
    const sy = fromVis.centroid[1] * DPR;
    let ex = pointer.x;
    let ey = pointer.y;

    // Snap to target state centroid if hovering a valid target
    const hoveredId = this.findStateAtPoint(pointer.x, pointer.y);
    let isValid = false;
    if (hoveredId && hoveredId !== this.dragSourceId) {
      // Temporarily set selectedStateId for isValidTarget check
      const prevSelected = this.selectedStateId;
      this.selectedStateId = this.dragSourceId;
      isValid = this.isValidTarget(hoveredId);
      this.selectedStateId = prevSelected;

      if (isValid) {
        const toVis = this.visuals.get(hoveredId)!;
        ex = toVis.centroid[0] * DPR;
        ey = toVis.centroid[1] * DPR;
      }
    }

    // Draw line: green if valid target, red/gray otherwise
    const lineColor = isValid ? 0x22d3ee : 0x9ca3af;
    const lineAlpha = isValid ? 0.9 : 0.5;
    this.dragLineGfx.lineStyle(3 * DPR, lineColor, lineAlpha);
    this.dragLineGfx.beginPath();
    this.dragLineGfx.moveTo(sx, sy);
    this.dragLineGfx.lineTo(ex, ey);
    this.dragLineGfx.strokePath();

    // Draw arrowhead at end
    if (isValid) {
      const angle = Math.atan2(ey - sy, ex - sx);
      const arrowSize = 8 * DPR;
      const ax1 = ex - arrowSize * Math.cos(angle - 0.4);
      const ay1 = ey - arrowSize * Math.sin(angle - 0.4);
      const ax2 = ex - arrowSize * Math.cos(angle + 0.4);
      const ay2 = ey - arrowSize * Math.sin(angle + 0.4);
      this.dragLineGfx.fillStyle(lineColor, lineAlpha);
      this.dragLineGfx.fillTriangle(ex, ey, ax1, ay1, ax2, ay2);
    }
  }

  /** Find which state the pointer is over using centroid proximity */
  private findStateAtPoint(x: number, y: number): string | null {
    let closest: string | null = null;
    let closestDist = Infinity;

    for (const [id, vis] of this.visuals) {
      // Check polygon hit using Phaser's contains
      for (let i = 0; i < vis.gfxList.length; i++) {
        const polygon = vis.data.polygons[i];
        if (!polygon || polygon.length < 3) continue;
        const scaled = scaledPolygon(polygon);
        const flatPoints: number[] = [];
        for (const [px, py] of scaled) flatPoints.push(px, py);
        const geom = new Phaser.Geom.Polygon(flatPoints);
        if (Phaser.Geom.Polygon.Contains(geom, x, y)) {
          return id;
        }
      }

      // Fallback: track closest centroid within a reasonable radius
      const cx = vis.centroid[0] * DPR;
      const cy = vis.centroid[1] * DPR;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist < closestDist && dist < 30 * DPR) {
        closestDist = dist;
        closest = id;
      }
    }

    return closest;
  }

  private deselect(): void {
    if (this.selectedStateId === null && !this.isDragging) return;
    this.selectedStateId = null;
    this.isDragging = false;
    this.dragSourceId = null;
    this.dragLineGfx.clear();
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
    const builtRails = this.gsm.railways.length;
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
