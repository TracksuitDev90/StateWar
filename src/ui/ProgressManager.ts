const STORAGE_KEY = "statewar_progress";

export interface LevelResult {
  completed: boolean;
  stars: number; // 1-3
}

export interface GameProgress {
  highestUnlocked: number; // 0-based level index
  levels: Record<number, LevelResult>;
  soundEnabled: boolean;
}

class ProgressManagerClass {
  private progress: GameProgress;

  constructor() {
    this.progress = this.load();
  }

  private load(): GameProgress {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          highestUnlocked: parsed.highestUnlocked ?? 0,
          levels: parsed.levels ?? {},
          soundEnabled: parsed.soundEnabled ?? true,
        };
      }
    } catch { /* corrupted or unavailable */ }
    return { highestUnlocked: 0, levels: {}, soundEnabled: true };
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.progress));
    } catch { /* storage unavailable */ }
  }

  get(): GameProgress {
    return this.progress;
  }

  isUnlocked(levelIndex: number): boolean {
    return levelIndex <= this.progress.highestUnlocked;
  }

  isCompleted(levelIndex: number): boolean {
    return !!this.progress.levels[levelIndex]?.completed;
  }

  getStars(levelIndex: number): number {
    return this.progress.levels[levelIndex]?.stars ?? 0;
  }

  completeLevel(levelIndex: number, stars: number): void {
    const existing = this.progress.levels[levelIndex];
    this.progress.levels[levelIndex] = {
      completed: true,
      stars: Math.max(stars, existing?.stars ?? 0),
    };
    if (levelIndex + 1 > this.progress.highestUnlocked) {
      this.progress.highestUnlocked = levelIndex + 1;
    }
    this.persist();
  }

  isSoundEnabled(): boolean {
    return this.progress.soundEnabled;
  }

  setSoundEnabled(on: boolean): void {
    this.progress.soundEnabled = on;
    this.persist();
  }

  reset(): void {
    this.progress = { highestUnlocked: 0, levels: {}, soundEnabled: true };
    this.persist();
  }
}

export const progressManager = new ProgressManagerClass();
