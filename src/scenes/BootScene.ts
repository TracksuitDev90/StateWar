import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  create(): void {
    const { width, height } = this.scale;

    const text = this.add.text(width / 2, height / 2, "StateWar — Phaser is running!", {
      fontSize: "32px",
      color: "#ffffff",
      fontFamily: "monospace",
    });
    text.setOrigin(0.5);
  }
}
