const path = require("path");
const fs = require("fs");

function loadAllAchievementModules() {
  const categoriesDir = path.join(__dirname, "categories");
  if (!fs.existsSync(categoriesDir)) return [];

  const files = fs
    .readdirSync(categoriesDir)
    .filter((f) => f.endsWith(".js") && !f.startsWith("_"));

  const out = [];
  for (const file of files) {
    const p = path.join(categoriesDir, file);
    // hot reload safe
    delete require.cache[require.resolve(p)];
    const mod = require(p);

    if (!Array.isArray(mod)) {
      throw new Error(`Achievement module ${file} must export an array`);
    }
    out.push(...mod);
  }

  return out;
}

module.exports = { loadAllAchievementModules };
