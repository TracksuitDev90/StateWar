import Phaser from "phaser";
import { MapScene } from "./scenes/MapScene";

const dpr = Math.min(window.devicePixelRatio || 1, 2);

const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
  (window.innerWidth <= 900 && "ontouchstart" in window);

// On mobile, use the actual screen size for a true full-screen game experience.
// The map world (1280×720 * DPR) is larger than the viewport, so the camera
// shows a cropped, detailed portion and the player pans to explore.
const gameW = IS_MOBILE ? window.innerWidth * dpr : 1280 * dpr;
const gameH = IS_MOBILE ? window.innerHeight * dpr : 720 * dpr;

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: gameW,
  height: gameH,
  backgroundColor: "#1a1a2e",
  parent: document.body,
  scene: [MapScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 2,
    touch: {
      capture: true,
    },
  },
  render: {
    antialias: true,
    antialiasGL: true,
    roundPixels: false,
  },
};

new Phaser.Game(config);
