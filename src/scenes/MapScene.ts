import Phaser from "phaser";
import { stateData, StateData } from "../data/states";
import { stateBonuses } from "../data/stateBonuses";
import { GameStateManager } from "../state/GameStateManager";
import { LogicTick } from "../state/LogicTick";
import { Owner, CombatResult, UnitMoveEvent, GameEvent } from "../types";

const DPR = Math.min(window.devicePixelRatio || 1, 2);
const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
  (window.innerWidth <= 900 && "ontouchstart" in window);

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

// Wall visuals
const WALL_L1_COLOR_OUTER = 0x8b7355;  // brown stone outer
const WALL_L1_COLOR_INNER = 0xa0906a;  // lighter stone inner
const WALL_L2_COLOR_OUTER = 0x4a4a5a;  // dark fortress outer
const WALL_L2_COLOR_INNER = 0x6a6a7a;  // lighter fortress inner
const WALL_L2_COLOR_TOP   = 0x8a8a9a;  // top highlight for 2.5D
const DOUBLE_TAP_MS = 400; // max ms between taps for double-tap

// Mobile pinch-to-zoom bounds
const MOBILE_MIN_ZOOM = 0.6;
const MOBILE_MAX_ZOOM = 2.5;

// Game event feed
const MAX_FEED_EVENTS = 5;
const FEED_FADE_MS = 6000; // events fade after 6 seconds

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

  // Double-tap detection for wall building
  private lastTapStateId: string | null = null;
  private lastTapTime = 0;

  // Mobile camera panning
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private camStartScrollX = 0;
  private camStartScrollY = 0;
  private stateWasHit = false;

  // Pinch-to-zoom
  private pinchStartDist = 0;
  private pinchStartZoom = 1;

  // Game event feed
  private feedEvents: { message: string; owner: Owner; time: number }[] = [];
  private feedText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "MapScene" });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x111827);

    // On mobile, the game canvas matches the phone screen (set in main.ts).
    // The map world is 1280×720 * DPR — larger than the viewport — so the
    // camera shows a cropped, detailed view and the player pans to explore.
    if (IS_MOBILE) {
      const cam = this.cameras.main;
      cam.setBounds(0, 0, 1280 * DPR, 720 * DPR);
      // Start centered on California (player start) — left-center of map
      cam.centerOn(300 * DPR, 400 * DPR);
    }

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

      const labelSize = Math.round(12 * DPR);
      const unitSize = Math.round(14 * DPR);

      const label = this.add.text(cx, cy - 8 * DPR, state.id, {
        fontSize: `${labelSize}px`,
        color: "#ffffff",
        fontFamily: "'Segoe UI', Arial, sans-serif",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3 * DPR,
      }).setOrigin(0.5).setDepth(3);

      const unitText = this.add.text(cx, cy + 6 * DPR, "", {
        fontSize: `${unitSize}px`,
        color: "#ffffff",
        fontFamily: "'Segoe UI', Arial, sans-serif",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4 * DPR,
      }).setOrigin(0.5).setDepth(3);

      this.visuals.set(state.id, { data: state, gfxList, label, unitText, centroid });
    }

    // Screen dimensions (actual game canvas size)
    const screenW = Number(this.game.config.width);
    const screenH = Number(this.game.config.height);

    // Info bar — fixed to viewport on mobile
    const infoSize = IS_MOBILE ? Math.round(15 * DPR) : Math.round(18 * DPR);
    const infoY = IS_MOBILE ? 6 * DPR : 14 * DPR;
    const infoCx = IS_MOBILE ? screenW / 2 : 640 * DPR;
    this.infoText = this.add.text(infoCx, infoY, "Select one of your states (blue)", {
      fontSize: `${infoSize}px`,
      color: "#ffffff",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      wordWrap: { width: (IS_MOBILE ? screenW - 20 * DPR : 1200 * DPR) },
    }).setOrigin(0.5, 0).setDepth(4);
    if (IS_MOBILE) this.infoText.setScrollFactor(0);

    // Stats display (bottom-right)
    const statsSize = IS_MOBILE ? Math.round(13 * DPR) : Math.round(14 * DPR);
    const statsY = IS_MOBILE ? screenH - 6 * DPR : 708 * DPR;
    const statsX = IS_MOBILE ? screenW - 10 * DPR : 1270 * DPR;
    this.statsText = this.add.text(statsX, statsY, "", {
      fontSize: `${statsSize}px`,
      color: "#d1d5db",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      align: "right",
    }).setOrigin(1, 1).setDepth(4);
    if (IS_MOBILE) this.statsText.setScrollFactor(0);

    // Mode toggle button (bottom-left)
    const modeSize = Math.round(14 * DPR);
    const modeLabel = IS_MOBILE ? "Build" : "[R] Build Rails";
    this.modeText = this.add.text(10 * DPR, statsY, modeLabel, {
      fontSize: `${modeSize}px`,
      color: "#fbbf24",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontStyle: "bold",
      backgroundColor: "#1f2937",
      padding: { x: 8 * DPR, y: 5 * DPR },
    }).setOrigin(0, 1).setDepth(4).setInteractive({ useHandCursor: true });
    if (IS_MOBILE) this.modeText.setScrollFactor(0);

    this.modeText.on("pointerdown", () => this.toggleMode());

    // Game event feed (fixed to viewport, above stats area)
    const feedY = IS_MOBILE ? screenH - 50 * DPR : screenH - 50 * DPR;
    const feedX = IS_MOBILE ? screenW / 2 : 640 * DPR;
    this.feedText = this.add.text(feedX, feedY, "", {
      fontSize: `${Math.round(11 * DPR)}px`,
      color: "#e2e8f0",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      align: "center",
      lineSpacing: 4 * DPR,
      stroke: "#000000",
      strokeThickness: 2 * DPR,
    }).setOrigin(0.5, 1).setDepth(10).setAlpha(0.85);
    if (IS_MOBILE) this.feedText.setScrollFactor(0);

    // Listen for game events (AI combat, fortify, etc.)
    this.gsm.onGameEvent((event: GameEvent) => {
      this.addFeedEvent(event.message, event.owner);
    });

    // Right-click or Escape to deselect
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) { this.deselect(); return; }

      // Mobile camera panning: if no state was hit, start pan
      if (IS_MOBILE && !this.stateWasHit) {
        this.isPanning = true;
        this.panStartX = pointer.x;
        this.panStartY = pointer.y;
        this.camStartScrollX = this.cameras.main.scrollX;
        this.camStartScrollY = this.cameras.main.scrollY;
      }
      this.stateWasHit = false;
    });

    // Drag-to-move: draw line while dragging, resolve on release
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      // Pinch-to-zoom (two-finger gesture) on mobile
      if (IS_MOBILE && this.input.pointer1.isDown && this.input.pointer2.isDown) {
        this.isPanning = false;
        const p1 = this.input.pointer1;
        const p2 = this.input.pointer2;
        const dist = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
        if (this.pinchStartDist === 0) {
          this.pinchStartDist = dist;
          this.pinchStartZoom = this.cameras.main.zoom;
        } else {
          const scale = dist / this.pinchStartDist;
          const newZoom = Phaser.Math.Clamp(this.pinchStartZoom * scale, MOBILE_MIN_ZOOM, MOBILE_MAX_ZOOM);
          this.cameras.main.setZoom(newZoom);
        }
        return;
      }

      // Camera panning on mobile
      if (this.isPanning && IS_MOBILE) {
        const dx = pointer.x - this.panStartX;
        const dy = pointer.y - this.panStartY;
        const zoom = this.cameras.main.zoom;
        this.cameras.main.scrollX = this.camStartScrollX - dx / zoom;
        this.cameras.main.scrollY = this.camStartScrollY - dy / zoom;
        return;
      }

      if (!this.isDragging || !this.dragSourceId) return;
      this.drawDragLine(pointer);
    });

    this.input.on("pointerup", (_pointer: Phaser.Input.Pointer) => {
      this.isPanning = false;
      this.pinchStartDist = 0;

      if (!this.isDragging || !this.dragSourceId) return;
      this.dragLineGfx.clear();
      // Find what state the pointer is over — use world coordinates
      const wx = _pointer.worldX;
      const wy = _pointer.worldY;
      const targetId = this.findStateAtPoint(wx, wy);
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
      this.updateFeed();
    });
    this.logicTick.start();

    this.redrawAll();
    this.updateStats();
  }

  // ── Mode ──

  private toggleMode(): void {
    this.deselect();
    this.mode = this.mode === "select" ? "build" : "select";
    if (IS_MOBILE) {
      this.modeText.setText(this.mode === "select" ? "Build" : "Move");
    } else {
      this.modeText.setText(this.mode === "select" ? "[R] Build Rails" : "[R] Move Units");
    }
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
    const wallLevel = this.gsm.getWallLevel(id);
    const wallHealth = this.gsm.getWallHealth(id);
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
      if (!polygon) continue;
      const scaled = scaledPolygon(polygon);

      if (wallLevel > 0) {
        this.drawWalledPoly(vis.gfxList[i], scaled, fillColor, borderColor, borderWidth, wallLevel, wallHealth);
      } else {
        this.drawPoly(vis.gfxList[i], scaled, fillColor, borderColor, borderWidth);
      }
    }

    // Show wall health in unit text if walls exist
    if (wallLevel > 0) {
      vis.unitText.setText(`${units} 🛡${wallHealth}`);
    } else {
      vis.unitText.setText(String(units));
    }
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

  /** Draw a state with 2.5D wall effect — multiple offset border layers */
  private drawWalledPoly(
    gfx: Phaser.GameObjects.Graphics,
    polygon: [number, number][],
    fill: number,
    borderColor: number,
    borderWidth: number,
    wallLevel: number,
    wallHealth: number,
  ): void {
    gfx.clear();

    const isL2 = wallLevel >= 2;
    const outerColor = isL2 ? WALL_L2_COLOR_OUTER : WALL_L1_COLOR_OUTER;
    const innerColor = isL2 ? WALL_L2_COLOR_INNER : WALL_L1_COLOR_INNER;
    const maxHealth = isL2 ? 100 : 50;
    const healthPct = Math.min(1, wallHealth / maxHealth);

    // Wall thickness scales with health percentage
    const baseThick = isL2 ? 6 * DPR : 4 * DPR;
    const wallThick = baseThick * healthPct;

    // 2.5D effect: draw offset shadow layer (bottom-right shift)
    const shadowOffset = isL2 ? 3 * DPR : 2 * DPR;
    const shadowPoly: [number, number][] = polygon.map(([x, y]) => [x + shadowOffset, y + shadowOffset]);
    gfx.fillStyle(0x222222, 0.4);
    gfx.beginPath();
    gfx.moveTo(shadowPoly[0][0], shadowPoly[0][1]);
    for (let i = 1; i < shadowPoly.length; i++) gfx.lineTo(shadowPoly[i][0], shadowPoly[i][1]);
    gfx.closePath();
    gfx.fillPath();

    // Outer wall border (dark)
    gfx.lineStyle(wallThick + borderWidth + 2 * DPR, outerColor, 1);
    gfx.beginPath();
    gfx.moveTo(polygon[0][0], polygon[0][1]);
    for (let i = 1; i < polygon.length; i++) gfx.lineTo(polygon[i][0], polygon[i][1]);
    gfx.closePath();
    gfx.strokePath();

    // Inner wall highlight (lighter, creates depth)
    gfx.lineStyle(wallThick + borderWidth, innerColor, 0.8);
    gfx.beginPath();
    gfx.moveTo(polygon[0][0], polygon[0][1]);
    for (let i = 1; i < polygon.length; i++) gfx.lineTo(polygon[i][0], polygon[i][1]);
    gfx.closePath();
    gfx.strokePath();

    // Level 2: top highlight edge for extra depth
    if (isL2) {
      gfx.lineStyle(wallThick * 0.4, WALL_L2_COLOR_TOP, 0.6);
      gfx.beginPath();
      gfx.moveTo(polygon[0][0], polygon[0][1]);
      for (let i = 1; i < polygon.length; i++) gfx.lineTo(polygon[i][0], polygon[i][1]);
      gfx.closePath();
      gfx.strokePath();
    }

    // Fill the state
    gfx.fillStyle(fill, 1);
    gfx.beginPath();
    gfx.moveTo(polygon[0][0], polygon[0][1]);
    for (let i = 1; i < polygon.length; i++) gfx.lineTo(polygon[i][0], polygon[i][1]);
    gfx.closePath();
    gfx.fillPath();

    // Normal border on top
    gfx.lineStyle(borderWidth, borderColor, 1);
    gfx.beginPath();
    gfx.moveTo(polygon[0][0], polygon[0][1]);
    for (let i = 1; i < polygon.length; i++) gfx.lineTo(polygon[i][0], polygon[i][1]);
    gfx.closePath();
    gfx.strokePath();

    // Battlements for level 2: small notches along the border
    if (isL2 && healthPct > 0.3) {
      this.drawBattlements(gfx, polygon, outerColor);
    }
  }

  /** Draw small battlement notches along polygon edges for fortress look */
  private drawBattlements(gfx: Phaser.GameObjects.Graphics, polygon: [number, number][], color: number): void {
    const notchSize = 3 * DPR;
    const spacing = 20 * DPR;

    gfx.fillStyle(color, 0.8);
    for (let i = 0; i < polygon.length; i++) {
      const [x1, y1] = polygon[i];
      const [x2, y2] = polygon[(i + 1) % polygon.length];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < spacing) continue;

      const nx = -dy / len; // normal direction (outward)
      const ny = dx / len;
      const count = Math.floor(len / spacing);

      for (let j = 1; j <= count; j++) {
        const t = j / (count + 1);
        const px = x1 + dx * t + nx * notchSize;
        const py = y1 + dy * t + ny * notchSize;
        gfx.fillRect(px - notchSize * 0.5, py - notchSize * 0.5, notchSize, notchSize);
      }
    }
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

      // Show wall info
      const wallLevel = this.gsm.getWallLevel(stateId);
      const wallHealth = this.gsm.getWallHealth(stateId);
      const wallStr = wallLevel > 0 ? ` | Wall L${wallLevel} (${wallHealth}hp)` : "";

      this.infoText.setText(`${vis.data.name} | ${owner} | ${units} units${defStr}${genStr}${bonusStr}${railStr}${wallStr}`);
    } else {
      this.updateInfoDefault();
    }
  }

  private onPointerDownState(stateId: string, _pointer: Phaser.Input.Pointer): void {
    this.stateWasHit = true; // prevent camera pan when tapping a state
    if (this.mode === "build") {
      this.onClickStateBuildMode(stateId);
      return;
    }

    // Double-tap detection: fortify walls
    const now = Date.now();
    if (
      this.lastTapStateId === stateId &&
      now - this.lastTapTime < DOUBLE_TAP_MS &&
      this.gsm.getOwner(stateId) === "player" &&
      this.gsm.getUnits(stateId) > 1
    ) {
      this.lastTapStateId = null;
      this.lastTapTime = 0;
      this.fortifyState(stateId);
      return;
    }
    this.lastTapStateId = stateId;
    this.lastTapTime = now;

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
      const fortifyHint = IS_MOBILE ? " | double-tap to fortify" : " | double-click to fortify";
      this.infoText.setText(`${vis.data.name} selected (${units} units) — drag to target${fortifyHint}`);
      return;
    }

    if (stateId === this.selectedStateId) {
      this.deselect();
      return;
    }

    this.deselect();
  }

  private fortifyState(stateId: string): void {
    const vis = this.visuals.get(stateId);
    if (!vis) return;

    const result = this.gsm.fortifyWall(stateId);
    if (result.added > 0) {
      const levelStr = result.level === 2 ? "Level 2" : "Level 1";
      this.infoText.setText(
        `${vis.data.name} fortified! +${result.added} wall HP (${result.newHealth} total, ${levelStr})`
      );
    } else {
      this.infoText.setText(`${vis.data.name} — walls at max or no units to spare`);
    }
    this.deselect();
    this.redrawAll();
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
            `Claimed ${targetVis.data.name}! Lost ${result.attackerLost}, ${result.remainingAttackers} units garrison`
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
    let ex = pointer.worldX;
    let ey = pointer.worldY;

    // Snap to target state centroid if hovering a valid target
    const hoveredId = this.findStateAtPoint(pointer.worldX, pointer.worldY);
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

    // Draw line: cyan if valid target, gray otherwise
    const lineColor = isValid ? 0x22d3ee : 0x9ca3af;
    const lineAlpha = isValid ? 0.9 : 0.5;
    this.dragLineGfx.lineStyle(6 * DPR, lineColor, lineAlpha);
    this.dragLineGfx.beginPath();
    this.dragLineGfx.moveTo(sx, sy);
    this.dragLineGfx.lineTo(ex, ey);
    this.dragLineGfx.strokePath();

    // Draw arrowhead at end
    if (isValid) {
      const angle = Math.atan2(ey - sy, ex - sx);
      const arrowSize = 12 * DPR;
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
      const hitRadius = IS_MOBILE ? 45 * DPR : 30 * DPR;
      if (dist < closestDist && dist < hitRadius) {
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
      this.infoText.setText("Select a state (blue) — double-tap to fortify");
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

  // ── Game Event Feed ──

  private addFeedEvent(message: string, owner: Owner): void {
    this.feedEvents.push({ message, owner, time: Date.now() });
    if (this.feedEvents.length > MAX_FEED_EVENTS) {
      this.feedEvents.shift();
    }
    this.updateFeed();
  }

  private updateFeed(): void {
    const now = Date.now();
    // Remove stale events
    this.feedEvents = this.feedEvents.filter(e => now - e.time < FEED_FADE_MS);
    if (this.feedEvents.length === 0) {
      this.feedText.setText("");
      return;
    }
    const lines = this.feedEvents.map(e => {
      const color = e.owner === "player" ? "🔵" : e.owner === "ai" ? "🔴" : "⚪";
      return `${color} ${e.message}`;
    });
    this.feedText.setText(lines.join("\n"));
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
