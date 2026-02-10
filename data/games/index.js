// data/games/index.js
const fs = require("fs");
const path = require("path");

function loadCategories() {
  const dir = path.join(__dirname, "categories");
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));

  const cats = [];
  for (const file of files) {
    const p = path.join(dir, file);
    delete require.cache[require.resolve(p)];
    const mod = require(p);

    if (!mod?.id || !mod?.name || !Array.isArray(mod.games)) {
      console.warn(`[GAMES] Skipped ${file}: missing id/name/games[]`);
      continue;
    }
    cats.push(mod);
  }

  cats.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  return cats;
}

function getCategory(categories, id) {
  return categories.find((c) => c.id === id) || null;
}

function getGame(category, gameId) {
  if (!category) return null;
  return category.games.find((g) => g.id === gameId) || null;
}

module.exports = { loadCategories, getCategory, getGame };
