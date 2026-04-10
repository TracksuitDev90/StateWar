import Phaser from "phaser";
import { stateData, StateData } from "../data/states";
import { stateBonuses } from "../data/stateBonuses";
import { GameStateManager } from "../state/GameStateManager";
import { LogicTick } from "../state/LogicTick";
import { Owner, CombatResult, UnitMoveEvent, GameEvent } from "../types";
import { sound } from "../audio/SoundManager";
import { AERIAL_STATES, PLANE_COST_UNITS } from "../state/GameStateManager";

const DPR = Math.min(window.devicePixelRatio || 1, 2);
const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
  (window.innerWidth <= 900 && "ontouchstart" in window);

// Owner-based colors — vibrant, saturated for strong visual pop
const OWNER_COLORS: Record<Owner, number> = {
  player: 0x2563eb,
  ai: 0xdc2626,
  neutral: 0x64748b,
};
// Lighter accent for inner highlight gradient
const OWNER_HIGHLIGHT: Record<Owner, number> = {
  player: 0x60a5fa,
  ai: 0xf87171,
  neutral: 0x94a3b8,
};

const SELECTED_BORDER = 0xfbbf24;
const VALID_TARGET_BORDER = 0x22d3ee;
const BORDER_COLOR = 0x0f172a;
const BORDER_WIDTH = 1.8 * DPR;
const SELECTED_BORDER_WIDTH = 3.5 * DPR;

// Wall visuals — richer stone/fortress palette
const WALL_L1_COLOR_OUTER = 0x7a6545;  // warm stone outer
const WALL_L1_COLOR_INNER = 0xa89870;  // lighter stone inner
const WALL_L1_COLOR_TOP   = 0xc4b58a;  // stone top highlight
const WALL_L2_COLOR_OUTER = 0x3d3d52;  // dark fortress outer
const WALL_L2_COLOR_INNER = 0x5e5e75;  // lighter fortress inner
const WALL_L2_COLOR_TOP   = 0x8a8aa0;  // fortress top highlight
const DOUBLE_TAP_MS = 400; // max ms between taps for double-tap
const LONG_PRESS_MS = 450; // hold this long on an owned state to open the action menu
const LONG_PRESS_MOVE_TOL = 8; // pixels of movement before long-press is canceled

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
  planeText: Phaser.GameObjects.Text;
  centroid: [number, number];
}

interface StateMenu {
  stateId: string;
  container: Phaser.GameObjects.Container;
  planeIcons: Phaser.GameObjects.Container[];
}


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
  private pauseText!: Phaser.GameObjects.Text;
  private pauseOverlay!: Phaser.GameObjects.Container;
  private isPaused = false;

  // Drag-to-move state
  private dragSourceId: string | null = null;
  private dragLineGfx!: Phaser.GameObjects.Graphics;
  private isDragging = false;

  // Double-tap detection for wall building
  private lastTapStateId: string | null = null;
  private lastTapTime = 0;

  // Long-press detection for state action menu
  private longPressTimer: number | null = null;
  private longPressStartX = 0;
  private longPressStartY = 0;

  // State action menu (long-press popup with planes)
  private stateMenu: StateMenu | null = null;

  // Plane drag state (dragging a plane icon from the menu to a target state)
  private planeDragLineGfx!: Phaser.GameObjects.Graphics;
  private planeDragSourceId: string | null = null;
  private isDraggingPlane = false;

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

    // Drag line layer (drawn above states)
    this.dragLineGfx = this.add.graphics().setDepth(7);
    this.planeDragLineGfx = this.add.graphics().setDepth(11);

    // Build visuals for each state
    for (const state of stateData) {
      const centroid = this.computeBestCentroid(state.polygons);
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
        color: "#f1f5f9",
        fontFamily: "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
        fontStyle: "bold",
        stroke: "#0f172a",
        strokeThickness: 3.5 * DPR,
        shadow: { offsetX: 0, offsetY: 1 * DPR, color: "#000", blur: 2 * DPR, fill: true, stroke: true },
      }).setOrigin(0.5).setDepth(3);

      const unitText = this.add.text(cx, cy + 7 * DPR, "", {
        fontSize: `${unitSize}px`,
        color: "#ffffff",
        fontFamily: "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
        fontStyle: "bold",
        stroke: "#0f172a",
        strokeThickness: 4.5 * DPR,
        shadow: { offsetX: 0, offsetY: 1 * DPR, color: "#000", blur: 3 * DPR, fill: true, stroke: true },
      }).setOrigin(0.5).setDepth(3);

      const planeText = this.add.text(cx, cy - 22 * DPR, "", {
        fontSize: `${Math.round(13 * DPR)}px`,
        color: "#fde68a",
        fontFamily: "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
        fontStyle: "bold",
        stroke: "#0f172a",
        strokeThickness: 3.5 * DPR,
        shadow: { offsetX: 0, offsetY: 1 * DPR, color: "#000", blur: 2 * DPR, fill: true, stroke: true },
      }).setOrigin(0.5).setDepth(3);

      this.visuals.set(state.id, { data: state, gfxList, label, unitText, planeText, centroid });
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

    // Pause / Start button (bottom-left)
    const pauseSize = Math.round(14 * DPR);
    this.pauseText = this.add.text(10 * DPR, statsY, IS_MOBILE ? "Pause" : "[P] Pause", {
      fontSize: `${pauseSize}px`,
      color: "#fbbf24",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontStyle: "bold",
      backgroundColor: "#1f2937",
      padding: { x: 8 * DPR, y: 5 * DPR },
    }).setOrigin(0, 1).setDepth(4).setInteractive({ useHandCursor: true });
    if (IS_MOBILE) this.pauseText.setScrollFactor(0);

    this.pauseText.on("pointerdown", () => this.togglePause());

    // Pause overlay (hidden until paused)
    this.pauseOverlay = this.buildPauseOverlay(screenW, screenH);
    this.pauseOverlay.setVisible(false);

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
      if (pointer.rightButtonDown()) { this.deselect(); this.closeStateMenu(); return; }

      // If menu is open and the press did NOT land on a state, dismiss it.
      // (Plane drags from the menu start with stateWasHit=false too — they
      // are detected on pointerup based on planeDragSourceId.)
      if (this.stateMenu && !this.stateWasHit && !this.isDraggingPlane) {
        this.closeStateMenu();
      }

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

      // Plane drag from menu
      if (this.isDraggingPlane && this.planeDragSourceId) {
        this.drawPlaneDragLine(pointer);
        return;
      }

      // Cancel pending long-press if pointer moves too far or drag starts
      if (this.longPressTimer !== null) {
        if (this.isDragging) {
          this.cancelLongPress();
        } else {
          const dx = pointer.x - this.longPressStartX;
          const dy = pointer.y - this.longPressStartY;
          if (dx * dx + dy * dy > LONG_PRESS_MOVE_TOL * LONG_PRESS_MOVE_TOL * DPR * DPR) {
            this.cancelLongPress();
          }
        }
      }

      if (!this.isDragging || !this.dragSourceId) return;
      this.drawDragLine(pointer);
    });

    this.input.on("pointerup", (_pointer: Phaser.Input.Pointer) => {
      this.isPanning = false;
      this.pinchStartDist = 0;

      // Resolve plane drag from menu
      if (this.isDraggingPlane && this.planeDragSourceId) {
        this.planeDragLineGfx.clear();
        const wx = _pointer.worldX;
        const wy = _pointer.worldY;
        const targetId = this.findStateAtPoint(wx, wy);
        const sourceId = this.planeDragSourceId;
        this.isDraggingPlane = false;
        this.planeDragSourceId = null;
        if (targetId && targetId !== sourceId && this.gsm.getOwner(targetId) !== "player") {
          this.closeStateMenu();
          this.dropPlaneBomb(sourceId, targetId);
        }
        return;
      }

      // Long-press: if timer never fired and pointer up was quick, cancel.
      this.cancelLongPress();

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
      this.input.keyboard.on("keydown-ESC", () => { this.deselect(); this.closeStateMenu(); });
      this.input.keyboard.on("keydown-P", () => this.togglePause());
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

  // ── Pause ──

  private togglePause(): void {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.logicTick.stop();
      this.closeStateMenu();
      this.deselect();
      this.cancelLongPress();
      this.pauseText.setText(IS_MOBILE ? "Start" : "[P] Start");
      this.pauseText.setColor("#22d3ee");
      this.pauseOverlay.setVisible(true);
    } else {
      this.logicTick.start();
      this.pauseText.setText(IS_MOBILE ? "Pause" : "[P] Pause");
      this.pauseText.setColor("#fbbf24");
      this.pauseOverlay.setVisible(false);
    }
  }

  private buildPauseOverlay(screenW: number, screenH: number): Phaser.GameObjects.Container {
    const cx = screenW / 2;
    const cy = screenH / 2;
    const c = this.add.container(cx, cy).setDepth(20).setScrollFactor(0);

    const dim = this.add.rectangle(0, 0, screenW * 2, screenH * 2, 0x000000, 0.55);
    const title = this.add.text(0, -30 * DPR, "PAUSED", {
      fontSize: `${Math.round(48 * DPR)}px`,
      color: "#fbbf24",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 5 * DPR,
    }).setOrigin(0.5);
    const sub = this.add.text(0, 30 * DPR, IS_MOBILE ? "tap Start to resume" : "press [P] or click Start to resume", {
      fontSize: `${Math.round(16 * DPR)}px`,
      color: "#e5e7eb",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      stroke: "#000000",
      strokeThickness: 3 * DPR,
    }).setOrigin(0.5);

    c.add([dim, title, sub]);
    return c;
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
    const wallLevel = this.gsm.getWallLevel(id);
    const wallHealth = this.gsm.getWallHealth(id);
    const isSelected = this.selectedStateId === id;
    const isValidTarget = this.selectedStateId !== null && this.isValidTarget(id);

    const overdamaged = this.gsm.isOverdamaged(id);
    let fillColor = OWNER_COLORS[owner];
    if (overdamaged) fillColor = 0x57321a; // scorched
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
        this.drawWalledPoly(vis.gfxList[i], scaled, fillColor, borderColor, borderWidth, wallLevel, wallHealth, owner);
      } else {
        this.drawPoly(vis.gfxList[i], scaled, fillColor, borderColor, borderWidth, owner);
      }
    }

    // Show wall health in unit text if walls exist
    let label: string;
    if (wallLevel > 0) {
      label = `${units} W:${wallHealth}`;
    } else {
      label = String(units);
    }
    vis.unitText.setText(label);

    // Overdamage: flash the unit text red
    if (overdamaged) {
      vis.unitText.setColor("#ff6b6b");
    } else {
      vis.unitText.setColor("#ffffff");
    }

    // Plane indicator (above the unit count) — graphical, no emoji
    const planes = this.gsm.getPlanesAt(id);
    if (planes.length > 0) {
      const totalAmmo = planes.reduce((s, p) => s + p.bombsLeft, 0);
      vis.planeText.setText(`P x${totalAmmo}`);
      vis.planeText.setColor("#fde68a");
    } else {
      vis.planeText.setText("");
    }
  }

  private drawPoly(
    gfx: Phaser.GameObjects.Graphics,
    polygon: [number, number][],
    fill: number,
    stroke: number,
    strokeW: number,
    owner?: Owner,
  ): void {
    gfx.clear();

    // Base fill
    gfx.fillStyle(fill, 1);
    this.fillPolygon(gfx, polygon);

    // Inner highlight gradient — lighter band inset for a 3D pop effect
    const highlight = owner ? OWNER_HIGHLIGHT[owner] : this.lightenColor(fill, 0.25);
    const innerPoly = this.insetPolygon(polygon, 5 * DPR);
    gfx.fillStyle(highlight, 0.22);
    this.fillPolygon(gfx, innerPoly);

    // Subtle top-edge specular highlight (even more inset, brighter)
    const specPoly = this.insetPolygon(polygon, 10 * DPR);
    gfx.fillStyle(this.lightenColor(fill, 0.35), 0.12);
    this.fillPolygon(gfx, specPoly);

    // Outer glow line (wider, semi-transparent) for depth
    gfx.lineStyle(strokeW + 1.5 * DPR, stroke, 0.25);
    this.strokePolygon(gfx, polygon);

    // Crisp border stroke
    gfx.lineStyle(strokeW, stroke, 1);
    this.strokePolygon(gfx, polygon);
  }

  /**
   * Draw a state with a 2.5D wall — a ring of raised stone ramparts running
   * along the polygon's border. The interior keeps the owner's fill colour
   * so walls read as fortifications around the territory rather than as a
   * giant grey blob covering it.
   */
  private drawWalledPoly(
    gfx: Phaser.GameObjects.Graphics,
    polygon: [number, number][],
    fill: number,
    borderColor: number,
    borderWidth: number,
    wallLevel: number,
    wallHealth: number,
    owner: Owner,
  ): void {
    gfx.clear();

    const isL2 = wallLevel >= 2;
    // Base stone colors blended with owner tint so walls show allegiance
    const tint = OWNER_COLORS[owner];
    const tintAmt = owner === "neutral" ? 0 : 0.30;
    const outerColor = this.blendColor(isL2 ? WALL_L2_COLOR_OUTER : WALL_L1_COLOR_OUTER, tint, tintAmt);
    const innerColor = this.blendColor(isL2 ? WALL_L2_COLOR_INNER : WALL_L1_COLOR_INNER, tint, tintAmt);
    const topColor = this.blendColor(isL2 ? WALL_L2_COLOR_TOP : WALL_L1_COLOR_TOP, tint, tintAmt);
    const maxHealth = isL2 ? 100 : 50;
    const healthPct = Math.min(1, wallHealth / maxHealth);

    // Vertical "lift" — increased for more dramatic 3D appearance
    const liftBase = isL2 ? 14 * DPR : 8 * DPR;
    const lift = liftBase * (0.5 + 0.5 * healthPct);

    // Wall thickness — wider for level 2
    const wallThickness = (isL2 ? 7 : 5) * DPR;
    const wallEdgeInset = 1.5 * DPR;

    // 1) Fill the state body (interior shows owner color with highlight)
    gfx.fillStyle(fill, 1);
    this.fillPolygon(gfx, polygon);
    // Inner highlight for owner pop
    const ownerHighlight = OWNER_HIGHLIGHT[owner];
    const innerGlow = this.insetPolygon(polygon, wallEdgeInset + wallThickness + 3 * DPR);
    gfx.fillStyle(ownerHighlight, 0.18);
    this.fillPolygon(gfx, innerGlow);

    // 2) Original border (drawn under the wall)
    gfx.lineStyle(borderWidth, borderColor, 0.9);
    this.strokePolygon(gfx, polygon);

    // 3) Compute two inset polygons that bracket the wall ring.
    const outerRing = this.insetPolygon(polygon, wallEdgeInset);
    const innerRing = this.insetPolygon(polygon, wallEdgeInset + wallThickness);

    // 4) Lift both rings vertically for the rampart top
    const outerTop: [number, number][] = outerRing.map(([x, y]) => [x, y - lift]);
    const innerTop: [number, number][] = innerRing.map(([x, y]) => [x, y - lift]);

    // 5) Drop shadow — deeper and softer for more realism
    const shadowOffset = isL2 ? 5 * DPR : 3 * DPR;
    gfx.fillStyle(0x000000, 0.45);
    this.fillRing(gfx, outerRing.map(([x, y]) => [x + shadowOffset, y + shadowOffset]),
                       innerRing.map(([x, y]) => [x + shadowOffset, y + shadowOffset]));
    // Softer outer shadow halo
    gfx.fillStyle(0x000000, 0.15);
    const shadowSpread = this.insetPolygon(polygon, -2 * DPR);
    this.fillRing(gfx,
      shadowSpread.map(([x, y]) => [x + shadowOffset * 0.6, y + shadowOffset * 0.6]),
      outerRing.map(([x, y]) => [x + shadowOffset * 0.6, y + shadowOffset * 0.6]));

    // 6) Outer face — gradient simulation (darker at base, lighter at top)
    for (let i = 0; i < outerRing.length; i++) {
      const j = (i + 1) % outerRing.length;
      const b1 = outerRing[i];
      const b2 = outerRing[j];
      const t1 = outerTop[i];
      const t2 = outerTop[j];
      // Slightly vary color per-face for stone block effect
      const faceVariant = (i % 3 === 0) ? 0.05 : (i % 3 === 1) ? -0.03 : 0;
      const faceColor = faceVariant > 0
        ? this.lightenColor(outerColor, faceVariant)
        : this.blendColor(outerColor, 0x000000, -faceVariant);
      gfx.fillStyle(faceColor, 1);
      gfx.beginPath();
      gfx.moveTo(b1[0], b1[1]);
      gfx.lineTo(b2[0], b2[1]);
      gfx.lineTo(t2[0], t2[1]);
      gfx.lineTo(t1[0], t1[1]);
      gfx.closePath();
      gfx.fillPath();
    }

    // 7) Inner face — darker for depth
    const innerFaceColor = this.blendColor(outerColor, 0x000000, 0.3);
    gfx.fillStyle(innerFaceColor, 1);
    for (let i = 0; i < innerRing.length; i++) {
      const j = (i + 1) % innerRing.length;
      const b1 = innerRing[i];
      const b2 = innerRing[j];
      const t1 = innerTop[i];
      const t2 = innerTop[j];
      gfx.beginPath();
      gfx.moveTo(b1[0], b1[1]);
      gfx.lineTo(b2[0], b2[1]);
      gfx.lineTo(t2[0], t2[1]);
      gfx.lineTo(t1[0], t1[1]);
      gfx.closePath();
      gfx.fillPath();
    }

    // 8) Top of the wall — bright stone ring (the rampart walkway)
    gfx.fillStyle(innerColor, 1);
    this.fillRing(gfx, outerTop, innerTop);

    // 9) Bright outer rim highlight on top of wall
    gfx.lineStyle(1.5 * DPR, topColor, 0.95);
    this.strokePolygon(gfx, outerTop);
    // Inner rim — subtle darker line for definition
    gfx.lineStyle(0.8 * DPR, this.blendColor(innerColor, 0x000000, 0.2), 0.6);
    this.strokePolygon(gfx, innerTop);

    // 10) Battlements for level 2 walls — notches along the outer top rim
    if (isL2 && healthPct > 0.3) {
      this.drawBattlements(gfx, outerTop, topColor);
    }

    // 11) Stone texture — subtle mortar lines on outer face
    if (healthPct > 0.5) {
      gfx.lineStyle(0.5 * DPR, 0x000000, 0.12);
      const mortarSpacing = 12 * DPR;
      for (let i = 0; i < outerRing.length; i += 2) {
        const j = (i + 1) % outerRing.length;
        const bx = (outerRing[i][0] + outerRing[j][0]) / 2;
        const by = (outerRing[i][1] + outerRing[j][1]) / 2;
        const tx = (outerTop[i][0] + outerTop[j][0]) / 2;
        const ty = (outerTop[i][1] + outerTop[j][1]) / 2;
        const edgeLen = Math.hypot(outerRing[j][0] - outerRing[i][0], outerRing[j][1] - outerRing[i][1]);
        if (edgeLen > mortarSpacing) {
          gfx.beginPath();
          gfx.moveTo(bx, by);
          gfx.lineTo(tx, ty);
          gfx.strokePath();
        }
      }
    }
  }

  /** Inset a polygon inward by `dist` pixels along each vertex's outward normal. */
  private insetPolygon(polygon: [number, number][], dist: number): [number, number][] {
    const center = this.polyCentroid(polygon);
    return polygon.map(([x, y]) => {
      const dx = x - center[0];
      const dy = y - center[1];
      const len = Math.hypot(dx, dy) || 1;
      return [x - (dx / len) * dist, y - (dy / len) * dist] as [number, number];
    });
  }

  /** Fill the ring between an outer and inner polygon (assumed same vertex count). */
  private fillRing(
    gfx: Phaser.GameObjects.Graphics,
    outer: [number, number][],
    inner: [number, number][],
  ): void {
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length;
      gfx.beginPath();
      gfx.moveTo(outer[i][0], outer[i][1]);
      gfx.lineTo(outer[j][0], outer[j][1]);
      gfx.lineTo(inner[j][0], inner[j][1]);
      gfx.lineTo(inner[i][0], inner[i][1]);
      gfx.closePath();
      gfx.fillPath();
    }
  }

  private fillPolygon(gfx: Phaser.GameObjects.Graphics, poly: [number, number][]): void {
    gfx.beginPath();
    gfx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) gfx.lineTo(poly[i][0], poly[i][1]);
    gfx.closePath();
    gfx.fillPath();
  }

  private strokePolygon(gfx: Phaser.GameObjects.Graphics, poly: [number, number][]): void {
    gfx.beginPath();
    gfx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) gfx.lineTo(poly[i][0], poly[i][1]);
    gfx.closePath();
    gfx.strokePath();
  }

  private polyCentroid(poly: [number, number][]): [number, number] {
    let cx = 0, cy = 0;
    for (const [x, y] of poly) { cx += x; cy += y; }
    return [cx / poly.length, cy / poly.length];
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

      const genRate = this.logicTick.getGenRate(stateId);
      const genStr = genRate > 0 ? ` | +${genRate.toFixed(1)}/s` : "";
      const bonus = stateBonuses[stateId];
      const bonusStr = bonus ? ` | ${bonus.description}` : "";

      // Show wall info
      const wallLevel = this.gsm.getWallLevel(stateId);
      const wallHealth = this.gsm.getWallHealth(stateId);
      const wallStr = wallLevel > 0 ? ` | Wall L${wallLevel} (${wallHealth}hp)` : "";

      this.infoText.setText(`${vis.data.name} | ${owner} | ${units} units${defStr}${genStr}${bonusStr}${wallStr}`);
    } else {
      this.updateInfoDefault();
    }
  }

  private onPointerDownState(stateId: string, pointer: Phaser.Input.Pointer): void {
    this.stateWasHit = true; // prevent camera pan when tapping a state
    sound.unlock(); // user gesture unlocks audio context

    // Block state interaction while paused
    if (this.isPaused) return;

    // Tapping a state always closes any open menu (long-press will reopen if held).
    this.closeStateMenu();

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

    // Long-press on an owned state opens the action menu (planes etc.)
    if (this.gsm.getOwner(stateId) === "player") {
      this.longPressStartX = pointer.x;
      this.longPressStartY = pointer.y;
      if (this.longPressTimer !== null) window.clearTimeout(this.longPressTimer);
      this.longPressTimer = window.setTimeout(() => {
        this.longPressTimer = null;
        // Cancel any in-progress drag setup so the menu takes over.
        this.isDragging = false;
        this.dragSourceId = null;
        this.dragLineGfx.clear();
        this.selectedStateId = null;
        this.redrawAll();
        this.openStateMenu(stateId);
      }, LONG_PRESS_MS);
    }

    // If we already have a selected state and click a target, execute immediately (click flow)
    if (this.selectedStateId !== null && stateId !== this.selectedStateId) {
      if (this.isValidTarget(stateId)) {
        this.executeMove(stateId);
        return;
      }
    }

    // Start drag from an owned state (drag-to-move). The long-press timer
    // above can override this if the user holds still long enough.
    if (this.gsm.getOwner(stateId) === "player" && this.gsm.getUnits(stateId) > 1) {
      this.dragSourceId = stateId;
      this.isDragging = true;
      this.selectedStateId = stateId;
      this.redrawAll();
      const vis = this.visuals.get(stateId)!;
      const units = this.gsm.getUnits(stateId);
      const fortifyHint = IS_MOBILE ? " | double-tap fortify | hold for menu" : " | double-click fortify | hold for menu";
      this.infoText.setText(`${vis.data.name} selected (${units} units) — drag to target${fortifyHint}`);
      return;
    }

    if (stateId === this.selectedStateId) {
      this.deselect();
      return;
    }

    this.deselect();
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
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

  /** Drop a bomb from a plane home state to a target enemy state, with an explosion. */
  private dropPlaneBomb(homeId: string, targetId: string): void {
    const fromVis = this.visuals.get(homeId);
    const toVis = this.visuals.get(targetId);
    if (!fromVis || !toVis) return;
    if (this.gsm.getPlanesAt(homeId).length === 0) {
      this.infoText.setText("No plane at this state");
      return;
    }

    this.animateBomb(fromVis, toVis, () => {
      const result = this.gsm.dropBomb(homeId, targetId);
      this.infoText.setText(result.message);
      this.redrawAll();
    });
  }

  private animateBomb(
    fromVis: StateVisual,
    toVis: StateVisual,
    onComplete: () => void,
  ): void {
    const sx = fromVis.centroid[0] * DPR;
    const sy = fromVis.centroid[1] * DPR;
    const tx = toVis.centroid[0] * DPR;
    const ty = toVis.centroid[1] * DPR;
    const dist = Math.hypot(tx - sx, ty - sy);
    const angle = Math.atan2(ty - sy, tx - sx);

    // The plane flies past the target and fades out
    const overshoot = 120 * DPR;
    const endX = tx + Math.cos(angle) * overshoot;
    const endY = ty + Math.sin(angle) * overshoot;
    const flightDuration = Math.max(800, Math.min(1800, dist * 2));

    // --- Proper graphical plane ---
    const planeGfx = this.add.graphics().setPosition(sx, sy).setDepth(8);
    this.drawPlaneShape(planeGfx, 0, 0, DPR, angle);
    // Plane shadow on ground
    const planeShadow = this.add.graphics().setPosition(sx + 4 * DPR, sy + 4 * DPR).setDepth(7);
    planeShadow.fillStyle(0x000000, 0.25);
    planeShadow.fillCircle(0, 0, 10 * DPR);

    // Fly the plane from source past the target
    this.tweens.add({
      targets: [planeGfx, planeShadow],
      x: { getEnd: (_t: unknown, _k: unknown, _v: unknown, i: number) => i === 0 ? endX : endX + 4 * DPR },
      y: { getEnd: (_t: unknown, _k: unknown, _v: unknown, i: number) => i === 0 ? endY : endY + 4 * DPR },
      duration: flightDuration,
      ease: "Linear",
    });

    // Fade out after passing target
    this.time.delayedCall(flightDuration, () => {
      this.tweens.add({
        targets: [planeGfx, planeShadow],
        alpha: 0,
        duration: 400,
        onComplete: () => { planeGfx.destroy(); planeShadow.destroy(); },
      });
    });

    // --- Bomb drops when plane is over target (~65% of flight) ---
    const dropPct = 0.65;
    const dropDelay = flightDuration * dropPct;
    const dropX = sx + (endX - sx) * dropPct;
    const dropY = sy + (endY - sy) * dropPct;

    this.time.delayedCall(dropDelay, () => {
      const bombGfx = this.add.graphics().setPosition(dropX, dropY).setDepth(8);
      this.drawBombShape(bombGfx, 0, 0, DPR, angle + 0.3);

      // Bomb falls to target with growing scale (approaching ground)
      this.tweens.add({
        targets: bombGfx,
        x: tx,
        y: ty,
        scaleX: 1.4,
        scaleY: 1.4,
        duration: flightDuration * 0.35,
        ease: "Quad.easeIn",
        onUpdate: () => {
          // Rotate bomb to point downward as it falls
          const progress = (bombGfx.y - dropY) / (ty - dropY || 1);
          const bombAngle = angle + 0.3 + progress * 1.2;
          bombGfx.clear();
          this.drawBombShape(bombGfx, 0, 0, DPR, bombAngle);
        },
        onComplete: () => {
          bombGfx.destroy();
          this.spawnExplosion(tx, ty);
          onComplete();
        },
      });
    });
  }

  /** Draw a detailed top-down plane silhouette on a Graphics object. */
  private drawPlaneShape(
    gfx: Phaser.GameObjects.Graphics,
    ox: number, oy: number,
    scale: number,
    angle: number,
  ): void {
    const s = scale;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const r = (x: number, y: number): [number, number] =>
      [ox + x * cos - y * sin, oy + x * sin + y * cos];

    // --- Fuselage ---
    gfx.fillStyle(0x64748b, 1);
    gfx.beginPath();
    const fuse = [
      r(18 * s, 0), r(12 * s, -3 * s), r(-4 * s, -3 * s),
      r(-12 * s, -2.5 * s), r(-15 * s, 0),
      r(-12 * s, 2.5 * s), r(-4 * s, 3 * s), r(12 * s, 3 * s),
    ];
    gfx.moveTo(fuse[0][0], fuse[0][1]);
    for (let i = 1; i < fuse.length; i++) gfx.lineTo(fuse[i][0], fuse[i][1]);
    gfx.closePath();
    gfx.fillPath();

    // --- Main Wings (swept back) ---
    gfx.fillStyle(0x94a3b8, 1);
    // Top wing
    const tw = [r(3 * s, -3 * s), r(-3 * s, -16 * s), r(-7 * s, -15 * s), r(-3 * s, -3 * s)];
    gfx.beginPath();
    gfx.moveTo(tw[0][0], tw[0][1]);
    for (let i = 1; i < tw.length; i++) gfx.lineTo(tw[i][0], tw[i][1]);
    gfx.closePath();
    gfx.fillPath();
    // Bottom wing
    const bw = [r(3 * s, 3 * s), r(-3 * s, 16 * s), r(-7 * s, 15 * s), r(-3 * s, 3 * s)];
    gfx.beginPath();
    gfx.moveTo(bw[0][0], bw[0][1]);
    for (let i = 1; i < bw.length; i++) gfx.lineTo(bw[i][0], bw[i][1]);
    gfx.closePath();
    gfx.fillPath();

    // --- Wing stripe (darker) ---
    gfx.lineStyle(1 * s, 0x475569, 0.5);
    const ws1 = r(0, -5 * s), ws2 = r(-5 * s, -14 * s);
    gfx.beginPath(); gfx.moveTo(ws1[0], ws1[1]); gfx.lineTo(ws2[0], ws2[1]); gfx.strokePath();
    const ws3 = r(0, 5 * s), ws4 = r(-5 * s, 14 * s);
    gfx.beginPath(); gfx.moveTo(ws3[0], ws3[1]); gfx.lineTo(ws4[0], ws4[1]); gfx.strokePath();

    // --- Tail Fins ---
    gfx.fillStyle(0x94a3b8, 1);
    const tf1 = [r(-10 * s, -2.5 * s), r(-15 * s, -8 * s), r(-17 * s, -7 * s), r(-13 * s, -2.5 * s)];
    gfx.beginPath(); gfx.moveTo(tf1[0][0], tf1[0][1]);
    for (let i = 1; i < tf1.length; i++) gfx.lineTo(tf1[i][0], tf1[i][1]);
    gfx.closePath(); gfx.fillPath();
    const tf2 = [r(-10 * s, 2.5 * s), r(-15 * s, 8 * s), r(-17 * s, 7 * s), r(-13 * s, 2.5 * s)];
    gfx.beginPath(); gfx.moveTo(tf2[0][0], tf2[0][1]);
    for (let i = 1; i < tf2.length; i++) gfx.lineTo(tf2[i][0], tf2[i][1]);
    gfx.closePath(); gfx.fillPath();

    // --- Engine nacelles on wings ---
    gfx.fillStyle(0x475569, 1);
    const en1 = r(0, -8 * s), en2 = r(0, 8 * s);
    gfx.fillCircle(en1[0], en1[1], 2.2 * s);
    gfx.fillCircle(en2[0], en2[1], 2.2 * s);

    // --- Cockpit window ---
    gfx.fillStyle(0x38bdf8, 0.85);
    const ck = r(12 * s, 0);
    gfx.fillCircle(ck[0], ck[1], 2.2 * s);

    // --- Fuselage center line ---
    gfx.lineStyle(0.8 * s, 0xcbd5e1, 0.4);
    const cl1 = r(10 * s, 0), cl2 = r(-10 * s, 0);
    gfx.beginPath(); gfx.moveTo(cl1[0], cl1[1]); gfx.lineTo(cl2[0], cl2[1]); gfx.strokePath();

    // --- Fuselage outline ---
    gfx.lineStyle(0.8 * s, 0x1e293b, 0.6);
    gfx.beginPath();
    gfx.moveTo(fuse[0][0], fuse[0][1]);
    for (let i = 1; i < fuse.length; i++) gfx.lineTo(fuse[i][0], fuse[i][1]);
    gfx.closePath();
    gfx.strokePath();
  }

  /** Draw a bomb shape on a Graphics object. */
  private drawBombShape(
    gfx: Phaser.GameObjects.Graphics,
    ox: number, oy: number,
    scale: number,
    angle: number,
  ): void {
    const s = scale;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const r = (x: number, y: number): [number, number] =>
      [ox + x * cos - y * sin, oy + x * sin + y * cos];

    // Bomb body
    gfx.fillStyle(0x1e293b, 1);
    const body = [
      r(9 * s, 0), r(5 * s, -3.5 * s), r(-5 * s, -3.5 * s),
      r(-7 * s, -2 * s), r(-7 * s, 2 * s),
      r(-5 * s, 3.5 * s), r(5 * s, 3.5 * s),
    ];
    gfx.beginPath();
    gfx.moveTo(body[0][0], body[0][1]);
    for (let i = 1; i < body.length; i++) gfx.lineTo(body[i][0], body[i][1]);
    gfx.closePath();
    gfx.fillPath();

    // Tail fins
    gfx.fillStyle(0x475569, 1);
    const fin1 = [r(-7 * s, -2 * s), r(-12 * s, -6 * s), r(-12 * s, -2.5 * s)];
    gfx.beginPath(); gfx.moveTo(fin1[0][0], fin1[0][1]);
    gfx.lineTo(fin1[1][0], fin1[1][1]); gfx.lineTo(fin1[2][0], fin1[2][1]);
    gfx.closePath(); gfx.fillPath();
    const fin2 = [r(-7 * s, 2 * s), r(-12 * s, 6 * s), r(-12 * s, 2.5 * s)];
    gfx.beginPath(); gfx.moveTo(fin2[0][0], fin2[0][1]);
    gfx.lineTo(fin2[1][0], fin2[1][1]); gfx.lineTo(fin2[2][0], fin2[2][1]);
    gfx.closePath(); gfx.fillPath();

    // Nose highlight
    gfx.fillStyle(0x334155, 1);
    const nose = r(7 * s, 0);
    gfx.fillCircle(nose[0], nose[1], 1.5 * s);

    // Warning band
    gfx.lineStyle(2 * s, 0xfbbf24, 0.85);
    const wb1 = r(1 * s, -3.5 * s), wb2 = r(1 * s, 3.5 * s);
    gfx.beginPath(); gfx.moveTo(wb1[0], wb1[1]); gfx.lineTo(wb2[0], wb2[1]); gfx.strokePath();

    // Body outline
    gfx.lineStyle(0.8 * s, 0x0f172a, 0.7);
    gfx.beginPath();
    gfx.moveTo(body[0][0], body[0][1]);
    for (let i = 1; i < body.length; i++) gfx.lineTo(body[i][0], body[i][1]);
    gfx.closePath();
    gfx.strokePath();
  }

  /**
   * Dramatic multi-layer explosion: ground scorch, white flash, fireballs,
   * shockwave rings, debris shrapnel, rising smoke plumes, screen shake.
   */
  private spawnExplosion(x: number, y: number): void {
    // ── Screen shake ──
    this.cameras.main.shake(300, 0.008);

    // ── Ground scorch mark (persists briefly) ──
    const scorchGfx = this.add.graphics().setDepth(1.5);
    scorchGfx.fillStyle(0x1a0800, 0.7);
    scorchGfx.fillCircle(x, y, 20 * DPR);
    scorchGfx.fillStyle(0x2d1000, 0.5);
    scorchGfx.fillCircle(x + 2 * DPR, y + 1 * DPR, 16 * DPR);
    this.tweens.add({
      targets: scorchGfx,
      alpha: 0,
      duration: 2500,
      delay: 500,
      ease: "Quad.easeIn",
      onComplete: () => scorchGfx.destroy(),
    });

    // ── Bright initial flash ──
    const flash = this.add.circle(x, y, 24 * DPR, 0xffffff, 1).setDepth(9);
    this.tweens.add({
      targets: flash,
      scale: 2.8,
      alpha: 0,
      duration: 180,
      ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });

    // ── Primary fireball (yellow-orange) ──
    const fire1 = this.add.circle(x, y, 18 * DPR, 0xfbbf24, 0.95).setDepth(9);
    this.tweens.add({
      targets: fire1,
      scale: 3.8,
      alpha: 0,
      duration: 600,
      ease: "Cubic.easeOut",
      onComplete: () => fire1.destroy(),
    });

    // ── Inner fireball (orange-red, hot core) ──
    const fire2 = this.add.circle(x, y, 12 * DPR, 0xf97316, 1).setDepth(9);
    this.tweens.add({
      targets: fire2,
      scale: 3.2,
      alpha: 0,
      duration: 500,
      ease: "Cubic.easeOut",
      onComplete: () => fire2.destroy(),
    });

    // ── Deep red fireball (delayed, secondary ignition) ──
    const fire3 = this.add.circle(x, y, 8 * DPR, 0xdc2626, 0.9).setDepth(9);
    this.tweens.add({
      targets: fire3,
      scale: 2.5,
      alpha: 0,
      duration: 450,
      delay: 80,
      ease: "Cubic.easeOut",
      onComplete: () => fire3.destroy(),
    });

    // ── Primary shockwave ring ──
    const ring1 = this.add.circle(x, y, 14 * DPR, 0xffffff, 0)
      .setStrokeStyle(3 * DPR, 0xfde68a, 0.95).setDepth(9);
    this.tweens.add({
      targets: ring1,
      scale: 6,
      alpha: 0,
      duration: 650,
      ease: "Quad.easeOut",
      onComplete: () => ring1.destroy(),
    });

    // ── Secondary shockwave ring (wider, fainter) ──
    const ring2 = this.add.circle(x, y, 10 * DPR, 0xffffff, 0)
      .setStrokeStyle(1.5 * DPR, 0xfef3c7, 0.6).setDepth(9);
    this.tweens.add({
      targets: ring2,
      scale: 8,
      alpha: 0,
      duration: 900,
      delay: 100,
      ease: "Quad.easeOut",
      onComplete: () => ring2.destroy(),
    });

    // ── Dark smoke clouds (multiple, staggered) ──
    for (let i = 0; i < 3; i++) {
      const smokeX = x + (Math.random() - 0.5) * 12 * DPR;
      const smokeY = y + (Math.random() - 0.5) * 12 * DPR;
      const smokeSize = (14 + Math.random() * 10) * DPR;
      const smoke = this.add.circle(smokeX, smokeY, smokeSize, 0x1f2937, 0.5).setDepth(9);
      this.tweens.add({
        targets: smoke,
        scale: 2.2 + Math.random() * 0.8,
        y: smokeY - (20 + Math.random() * 30) * DPR,
        alpha: 0,
        duration: 900 + Math.random() * 400,
        delay: 100 + i * 80,
        ease: "Quad.easeOut",
        onComplete: () => smoke.destroy(),
      });
    }

    // ── Ember/spark shrapnel — bright dots flying outward ──
    const sparkCount = 14;
    for (let i = 0; i < sparkCount; i++) {
      const a = (Math.PI * 2 * i) / sparkCount + (Math.random() - 0.5) * 0.5;
      const dist = (30 + Math.random() * 30) * DPR;
      const sparkColor = Math.random() > 0.5 ? 0xfde68a : (Math.random() > 0.5 ? 0xfbbf24 : 0xf97316);
      const sparkSize = (1.5 + Math.random() * 2) * DPR;
      const spark = this.add.circle(x, y, sparkSize, sparkColor, 1).setDepth(9);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(a) * dist,
        y: y + Math.sin(a) * dist - Math.random() * 10 * DPR,
        alpha: 0,
        scale: 0.3,
        duration: 400 + Math.random() * 300,
        ease: "Quad.easeOut",
        onComplete: () => spark.destroy(),
      });
    }

    // ── Debris chunks — larger darker pieces ──
    const debrisCount = 6;
    for (let i = 0; i < debrisCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = (20 + Math.random() * 40) * DPR;
      const debrisSize = (2 + Math.random() * 3) * DPR;
      const debrisColor = Math.random() > 0.5 ? 0x374151 : 0x4b5563;
      const debris = this.add.rectangle(x, y, debrisSize, debrisSize * 0.7, debrisColor, 0.9).setDepth(9);
      debris.setRotation(Math.random() * Math.PI);
      this.tweens.add({
        targets: debris,
        x: x + Math.cos(a) * dist,
        y: y + Math.sin(a) * dist + 10 * DPR,
        alpha: 0,
        rotation: debris.rotation + (Math.random() - 0.5) * 6,
        duration: 600 + Math.random() * 300,
        delay: 50,
        ease: "Quad.easeOut",
        onComplete: () => debris.destroy(),
      });
    }

    sound.bomb();
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

    sound.moveUnits();
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
    if (this.isPaused) {
      this.infoText.setText("PAUSED");
    } else if (this.selectedStateId) {
      const vis = this.visuals.get(this.selectedStateId)!;
      this.infoText.setText(`${vis.data.name} selected — drag to target`);
    } else {
      const hint = IS_MOBILE ? "tap to select • hold for menu • double-tap fortify" : "click to select • hold for menu • double-click fortify";
      this.infoText.setText(hint);
    }
  }

  private updateStats(): void {
    const pStates = this.logicTick.countStates("player");
    const pUnits = this.logicTick.countUnits("player");
    const aStates = this.logicTick.countStates("ai");
    const aUnits = this.logicTick.countUnits("ai");
    this.statsText.setText(
      `You: ${pStates} states, ${pUnits} units  |  AI: ${aStates} states, ${aUnits} units`
    );
  }

  // ── State Action Menu (long-press) ──

  private openStateMenu(stateId: string): void {
    if (this.gsm.getOwner(stateId) !== "player") return;
    this.closeStateMenu();

    const vis = this.visuals.get(stateId);
    if (!vis) return;

    const cx = vis.centroid[0] * DPR;
    const cy = vis.centroid[1] * DPR;

    // Layout
    const padX = 12 * DPR;
    const padY = 12 * DPR;
    const lineH = 19 * DPR;
    const planeRowH = 56 * DPR;
    const titleSize = Math.round(15 * DPR);
    const lineSize = Math.round(13 * DPR);
    const width = 210 * DPR;

    const planes = this.gsm.getPlanesAt(stateId);
    const canBuildPlane = AERIAL_STATES.has(stateId)
      && planes.length === 0
      && this.gsm.getUnits(stateId) > PLANE_COST_UNITS;
    const showPlaneRow = planes.length > 0 || AERIAL_STATES.has(stateId);

    const headerLines = 4; // title + growth + defense + planes-label
    const height = padY * 2 + lineH * headerLines + (showPlaneRow ? planeRowH : 0);

    // Position the menu near the state, clamped to visible area.
    const screenW = Number(this.game.config.width);
    const screenH = Number(this.game.config.height);
    let mx = cx;
    let my = cy - height / 2 - 30 * DPR;
    if (my - height / 2 < 30 * DPR) my = cy + height / 2 + 30 * DPR;
    if (my + height / 2 > screenH - 30 * DPR) my = cy - height / 2 - 30 * DPR;
    mx = Phaser.Math.Clamp(mx, width / 2 + 10 * DPR, screenW - width / 2 - 10 * DPR);
    my = Phaser.Math.Clamp(my, height / 2 + 10 * DPR, screenH - height / 2 - 10 * DPR);

    const container = this.add.container(mx, my).setDepth(15);

    // Background panel — interactive so taps inside the menu don't dismiss it.
    const bg = this.add.rectangle(0, 0, width, height, 0x111827, 0.96)
      .setStrokeStyle(2 * DPR, 0xfbbf24, 0.9)
      .setInteractive();
    bg.on("pointerdown", (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      this.stateWasHit = true;
    });
    container.add(bg);

    const lines: Phaser.GameObjects.Text[] = [];
    let ty = -height / 2 + padY;

    const title = this.add.text(0, ty, vis.data.name, {
      fontSize: `${titleSize}px`,
      color: "#fbbf24",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontStyle: "bold",
    }).setOrigin(0.5, 0);
    lines.push(title);
    ty += lineH;

    const genRate = this.logicTick.getGenRate(stateId);
    const growth = this.add.text(-width / 2 + padX, ty, `Growth:  +${genRate.toFixed(2)}/s`, {
      fontSize: `${lineSize}px`,
      color: "#e5e7eb",
      fontFamily: "'Segoe UI', Arial, sans-serif",
    }).setOrigin(0, 0);
    lines.push(growth);
    ty += lineH;

    const defBonus = this.gsm.getDefenseBonus(stateId);
    const wallLevel = this.gsm.getWallLevel(stateId);
    const wallHealth = this.gsm.getWallHealth(stateId);
    const wallStr = wallLevel > 0 ? ` | wall L${wallLevel} ${wallHealth}hp` : "";
    const defense = this.add.text(-width / 2 + padX, ty, `Defense: ×${defBonus.toFixed(1)}${wallStr}`, {
      fontSize: `${lineSize}px`,
      color: "#e5e7eb",
      fontFamily: "'Segoe UI', Arial, sans-serif",
    }).setOrigin(0, 0);
    lines.push(defense);
    ty += lineH;

    const planeLabel = this.add.text(-width / 2 + padX, ty, `Planes:  ${planes.length}`, {
      fontSize: `${lineSize}px`,
      color: "#e5e7eb",
      fontFamily: "'Segoe UI', Arial, sans-serif",
    }).setOrigin(0, 0);
    lines.push(planeLabel);
    ty += lineH;

    container.add(lines);

    // Plane drag icons row
    const planeIcons: Phaser.GameObjects.Container[] = [];
    if (planes.length > 0) {
      // Show one draggable plane icon per plane stationed here
      const iconSize = 24 * DPR;
      const spacing = iconSize + 14 * DPR;
      const total = planes.length;
      const startX = -((total - 1) * spacing) / 2;
      const iconY = ty + 16 * DPR;
      for (let i = 0; i < total; i++) {
        const px = startX + i * spacing;
        const icon = this.makePlaneIcon(px, iconY, iconSize, planes[i].bombsLeft, stateId);
        container.add(icon);
        planeIcons.push(icon);
      }
      const hint = this.add.text(0, ty + planeRowH - 6 * DPR, "drag plane → enemy state", {
        fontSize: `${Math.round(10 * DPR)}px`,
        color: "#94a3b8",
        fontFamily: "'Segoe UI', Arial, sans-serif",
      }).setOrigin(0.5, 1);
      container.add(hint);
    } else if (AERIAL_STATES.has(stateId)) {
      // Build plane button
      const btnLabel = canBuildPlane
        ? `Build plane (−${PLANE_COST_UNITS})`
        : `Need ${PLANE_COST_UNITS + 1}+ units`;
      const btn = this.add.text(0, ty + planeRowH / 2, btnLabel, {
        fontSize: `${Math.round(12 * DPR)}px`,
        color: canBuildPlane ? "#0f172a" : "#475569",
        backgroundColor: canBuildPlane ? "#fbbf24" : "#1f2937",
        fontFamily: "'Segoe UI', Arial, sans-serif",
        fontStyle: "bold",
        padding: { x: 10 * DPR, y: 5 * DPR },
      }).setOrigin(0.5);
      if (canBuildPlane) {
        btn.setInteractive({ useHandCursor: true });
        btn.on("pointerdown", (p: Phaser.Input.Pointer) => {
          p.event.stopPropagation();
          this.stateWasHit = true; // prevent the scene-level handler from closing the menu
          const result = this.gsm.producePlane(stateId);
          this.infoText.setText(result.message);
          this.closeStateMenu();
          this.redrawAll();
          // Reopen so player sees the new plane and can drag it.
          if (result.success) this.openStateMenu(stateId);
        });
      }
      container.add(btn);
    }

    this.stateMenu = { stateId, container, planeIcons };
  }

  private makePlaneIcon(x: number, y: number, size: number, bombsLeft: number, sourceStateId: string): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const bg = this.add.circle(0, 0, size * 0.7, 0x1f2937, 1).setStrokeStyle(2 * DPR, 0xfbbf24);
    // Draw a proper mini plane instead of a triangle
    const planeGfx = this.add.graphics();
    const iconScale = size / 28;
    this.drawPlaneShape(planeGfx, 0, -1 * DPR, iconScale, -Math.PI / 2);
    const ammo = this.add.text(0, size * 0.55, `${bombsLeft}`, {
      fontSize: `${Math.round(11 * DPR)}px`,
      color: "#fbbf24",
      fontFamily: "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 2 * DPR,
    }).setOrigin(0.5, 0);
    c.add([bg, planeGfx, ammo]);
    c.setSize(size * 1.4, size * 1.4);
    c.setInteractive(new Phaser.Geom.Circle(0, 0, size * 0.8), Phaser.Geom.Circle.Contains);

    // On pointerdown, start a plane drag (intercept before the menu close handler).
    c.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      this.stateWasHit = true;
      this.isDraggingPlane = true;
      this.planeDragSourceId = sourceStateId;
      this.infoText.setText("Drop plane on an enemy state to bomb it");
      this.drawPlaneDragLine(pointer);
    });
    return c;
  }

  private drawPlaneDragLine(pointer: Phaser.Input.Pointer): void {
    this.planeDragLineGfx.clear();
    if (!this.planeDragSourceId) return;
    const fromVis = this.visuals.get(this.planeDragSourceId);
    if (!fromVis) return;

    const sx = fromVis.centroid[0] * DPR;
    const sy = fromVis.centroid[1] * DPR;
    let ex = pointer.worldX;
    let ey = pointer.worldY;

    // Snap to enemy/neutral state if hovering one
    const hoveredId = this.findStateAtPoint(pointer.worldX, pointer.worldY);
    let valid = false;
    if (hoveredId && hoveredId !== this.planeDragSourceId && this.gsm.getOwner(hoveredId) !== "player") {
      const toVis = this.visuals.get(hoveredId)!;
      ex = toVis.centroid[0] * DPR;
      ey = toVis.centroid[1] * DPR;
      valid = true;
    }

    const lineColor = valid ? 0xfbbf24 : 0x9ca3af;
    const lineAlpha = valid ? 0.95 : 0.5;
    this.planeDragLineGfx.lineStyle(5 * DPR, lineColor, lineAlpha);
    this.planeDragLineGfx.beginPath();
    this.planeDragLineGfx.moveTo(sx, sy);
    this.planeDragLineGfx.lineTo(ex, ey);
    this.planeDragLineGfx.strokePath();

    // Crosshair on valid target
    if (valid) {
      const r = 14 * DPR;
      this.planeDragLineGfx.lineStyle(2 * DPR, lineColor, 1);
      this.planeDragLineGfx.strokeCircle(ex, ey, r);
      this.planeDragLineGfx.beginPath();
      this.planeDragLineGfx.moveTo(ex - r * 1.4, ey);
      this.planeDragLineGfx.lineTo(ex + r * 1.4, ey);
      this.planeDragLineGfx.moveTo(ex, ey - r * 1.4);
      this.planeDragLineGfx.lineTo(ex, ey + r * 1.4);
      this.planeDragLineGfx.strokePath();
    }
  }

  private closeStateMenu(): void {
    if (!this.stateMenu) return;
    this.stateMenu.container.destroy(true);
    this.stateMenu = null;
    this.planeDragLineGfx.clear();
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
      const tag = e.owner === "player" ? "[YOU]" : e.owner === "ai" ? "[AI]" : "[---]";
      return `${tag} ${e.message}`;
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

  /** Pick the centroid of the largest polygon for multi-polygon states. */
  private computeBestCentroid(polygons: [number, number][][]): [number, number] {
    if (polygons.length === 1) return this.computeCentroid(polygons[0]);
    let maxArea = 0;
    let best: [number, number] = this.computeCentroid(polygons[0]);
    for (const poly of polygons) {
      const area = this.polygonArea(poly);
      if (area > maxArea) { maxArea = area; best = this.computeCentroid(poly); }
    }
    return best;
  }

  private polygonArea(poly: [number, number][]): number {
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
    }
    return Math.abs(area / 2);
  }

  private blendColor(base: number, tint: number, amount: number): number {
    const br = (base >> 16) & 0xff, bg = (base >> 8) & 0xff, bb = base & 0xff;
    const tr = (tint >> 16) & 0xff, tg = (tint >> 8) & 0xff, tb = tint & 0xff;
    const r = Math.round(br + (tr - br) * amount);
    const g = Math.round(bg + (tg - bg) * amount);
    const b = Math.round(bb + (tb - bb) * amount);
    return (r << 16) | (g << 8) | b;
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
