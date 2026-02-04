const config = require("../data/achievements/config");

function makeProgressBar(current, target) {
  const length = config?.bar?.length ?? 14;
  const filled = config?.bar?.filled ?? "■";
  const empty = config?.bar?.empty ?? "□";

  const safeTarget = Math.max(1, Number(target || 1));
  const safeCurrent = Math.max(0, Number(current || 0));
  const pct = Math.max(0, Math.min(1, safeCurrent / safeTarget));

  const fillCount = Math.round(pct * length);
  return filled.repeat(fillCount) + empty.repeat(Math.max(0, length - fillCount));
}

module.exports = { makeProgressBar };
