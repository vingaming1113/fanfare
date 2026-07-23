// The Hype Train engine — Fanfare's original signature feature.
//
// Every qualifying event injects "energy" into a live meter. Energy decays
// over time, so the train only keeps rolling while the community stays active.
// Fill the meter to level up; each level-up extends the window and escalates
// the on-screen celebration. If the window closes before the next level is
// reached, the train "leaves the station" and resets. Beating the channel's
// all-time record level is tracked and celebrated.
import { getHypeSettings, getSetting, setSetting } from "./db.ts";
import type { AlertType } from "./config.ts";
import type { HypeState } from "./events.ts";

export class HypeEngine {
  private active = false;
  private level = 0;
  private energy = 0; // energy accumulated within the current level
  private expiresAt: number | null = null;
  private contributors = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private onChange: (state: HypeState) => void) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private recordLevel(): number {
    return getSetting<number>("hypeRecordLevel", 0);
  }

  /** Energy contribution for an event, honoring configured weights. */
  energyFor(type: AlertType | "chat", amount = 0, count = 1): number {
    const s = getHypeSettings();
    const w = s.weights[type] ?? 0;
    switch (type) {
      case "donation":
        return w * Math.max(1, amount);
      case "cheer":
        return w * Math.max(1, amount / 100);
      case "gift_sub":
        return w * Math.max(1, count);
      default:
        return w;
    }
  }

  contribute(name: string, energy: number) {
    const s = getHypeSettings();
    if (!s.enabled || energy <= 0) return;

    const now = Date.now();
    if (!this.active) {
      this.active = true;
      this.level = 1;
      this.energy = 0;
      this.contributors.clear();
    }
    this.energy += energy;
    this.contributors.set(name, (this.contributors.get(name) ?? 0) + energy);
    this.expiresAt = now + s.windowSeconds * 1000;

    // Level-ups (can chain if a big contribution lands).
    while (this.energy >= s.levelSize && this.level < s.maxLevel) {
      this.energy -= s.levelSize;
      this.level += 1;
    }
    if (this.level >= s.maxLevel) this.energy = Math.min(this.energy, s.levelSize);

    if (this.level > this.recordLevel()) {
      setSetting("hypeRecordLevel", this.level);
    }
    this.emit();
  }

  private tick() {
    const s = getHypeSettings();
    if (!this.active) return;
    const now = Date.now();

    if (this.expiresAt && now >= this.expiresAt) {
      this.end();
      return;
    }
    // Decay within the current level (never drops the earned level).
    this.energy = Math.max(0, this.energy - s.decayPerSecond);
    this.emit();
  }

  private end() {
    this.active = false;
    this.level = 0;
    this.energy = 0;
    this.expiresAt = null;
    this.contributors.clear();
    this.emit();
  }

  reset() {
    this.end();
  }

  state(): HypeState {
    const s = getHypeSettings();
    let top: HypeState["topContributor"] = null;
    for (const [name, total] of this.contributors) {
      if (!top || total > top.total) top = { name, total: Math.round(total) };
    }
    return {
      active: this.active,
      level: this.level,
      maxLevel: s.maxLevel,
      progress: this.active ? Math.min(1, this.energy / s.levelSize) : 0,
      energy: Math.round(this.energy),
      levelSize: s.levelSize,
      expiresAt: this.expiresAt,
      topContributor: top,
      allTimeRecordLevel: this.recordLevel(),
    };
  }

  private emit() {
    this.onChange(this.state());
  }
}
