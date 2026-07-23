// Seeds default settings and a few starter goals on first run.
import {
  createGoal,
  getSetting,
  listGoals,
  setSetting,
} from "./db.ts";
import {
  DEFAULT_ALERTS,
  DEFAULT_GENERAL,
  DEFAULT_HYPE,
} from "./config.ts";

export function seed(): void {
  if (!getSetting("seeded", false)) {
    setSetting("alerts", DEFAULT_ALERTS);
    setSetting("general", DEFAULT_GENERAL);
    setSetting("hype", DEFAULT_HYPE);
    setSetting("hypeRecordLevel", 0);
    setSetting("seeded", true);
  }
  if (listGoals().length === 0) {
    createGoal("follower", "Follower Goal", 500);
    createGoal("sub", "Sub Goal", 100);
    createGoal("donation", "Charity Tip Goal", 1000);
  }
}

if (import.meta.main) {
  seed();
  console.log("Seeded Fanfare defaults.");
}
