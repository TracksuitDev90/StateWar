import Phaser from "phaser";
import { MapScene } from "./scenes/MapScene";

const dpr = Math.min(window.devicePixelRatio || 1, 2);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280 * dpr,
  height: 720 * dpr,
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
