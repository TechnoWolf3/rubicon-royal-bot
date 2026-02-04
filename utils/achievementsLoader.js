// utils/achievementsLoader.js
const { loadAllAchievementModules } = require("../data/achievements");

function validateAchievements(list) {
  if (!Array.isArray(list)) throw new Error("Achievements must be an array");

  const ids = new Set();
  for (const a of list) {
    if (!a.id || typeof a.id !== "string") throw new Error("Each achievement must have an id");
    if (!/^[a-z0-9_]+$/.test(a.id)) throw new Error(`Invalid id '${a.id}' (use lowercase/nums/underscores)`);
    if (ids.has(a.id)) throw new Error(`Duplicate achievement id '${a.id}'`);
    ids.add(a.id);

    if (!a.name || !a.description) throw new Error(`Achievement '${a.id}' missing name/description`);
    if (a.reward_coins == null) a.reward_coins = 0;
    if (typeof a.reward_coins !== "number" || a.reward_coins < 0) {
      throw new Error(`Achievement '${a.id}' reward_coins must be a number >= 0`);
    }
    if (typeof a.hidden !== "boolean") a.hidden = false;
    if (!a.category) a.category = "General";
    if (a.reward_role_id === undefined) a.reward_role_id = null;

    if (a.progress) {
      if (!a.progress.key || typeof a.progress.key !== "string") throw new Error(`Achievement '${a.id}' progress.key missing`);
      if (typeof a.progress.target !== "number" || a.progress.target <= 0) throw new Error(`Achievement '${a.id}' progress.target invalid`);
      if (!["count", "max"].includes(a.progress.mode || "count")) throw new Error(`Achievement '${a.id}' progress.mode invalid`);
    }
  }

  return list;
}

function loadAchievements() {
  const list = loadAllAchievementModules();
  return validateAchievements(list);
}

module.exports = { loadAchievements };
