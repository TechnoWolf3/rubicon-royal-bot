// utils/store.js
const { pool } = require("./db");

// Small helper: positive integer clamp
function clampQty(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(n));
}

// Postgres expression: start of current UTC day
const SQL_UTC_DAY_START = `(date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;

async function listStoreItems(guildId, { enabledOnly = true } = {}) {
  const res = await pool.query(
    `
    SELECT item_id, name, description, price, kind, stackable, enabled, meta, sort_order,
           max_owned, max_uses, max_purchase_ever, cooldown_seconds, daily_stock,
           sell_enabled, sell_price
    FROM store_items
    WHERE guild_id = $1
      AND ($2::bool = false OR enabled = true)
    ORDER BY sort_order ASC, price ASC, name ASC
    `,
    [guildId, enabledOnly]
  );
  return res.rows;
}

async function getStoreItem(guildId, itemId) {
  const res = await pool.query(
    `SELECT * FROM store_items WHERE guild_id=$1 AND item_id=$2`,
    [guildId, itemId]
  );
  return res.rows?.[0] ?? null;
}

async function getInventory(guildId, userId) {
  const res = await pool.query(
    `
    SELECT ui.item_id, ui.qty, ui.uses_remaining, ui.meta,
           si.name, si.kind, si.max_uses, si.max_owned
    FROM user_inventory ui
    LEFT JOIN store_items si
      ON si.guild_id = ui.guild_id AND si.item_id = ui.item_id
    WHERE ui.guild_id=$1 AND ui.user_id=$2
    ORDER BY COALESCE(si.sort_order, 999999) ASC, ui.item_id ASC
    `,
    [guildId, userId]
  );
  return res.rows;
}

async function removeBrokenIfZero(guildId, userId, itemId) {
  await pool.query(
    `
    DELETE FROM user_inventory
    WHERE guild_id=$1 AND user_id=$2 AND item_id=$3 AND qty <= 0
    `,
    [guildId, userId, itemId]
  );
}

/**
 * Safe purchase:
 * - guild-scoped
 * - never negative balances (atomic debit)
 * - logs transactions (negative)
 * - logs store_purchases
 * - enforces:
 *   - max_owned
 *   - max_uses -> uses_remaining
 *   - max_purchase_ever (one-time purchase per person)
 *   - cooldown_seconds (per-user cooldown)
 *   - daily_stock (per day per guild, decremented on purchase)
 */
async function purchaseItem(guildId, userId, itemId, qtyRaw, meta = {}) {
  const qty = clampQty(qtyRaw);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ensure required base rows exist
    await client.query(
      `INSERT INTO guilds (guild_id) VALUES ($1)
       ON CONFLICT (guild_id) DO NOTHING`,
      [guildId]
    );

    await client.query(
      `INSERT INTO user_balances (guild_id, user_id) VALUES ($1, $2)
       ON CONFLICT (guild_id, user_id) DO NOTHING`,
      [guildId, userId]
    );

    // Load item
    const itemRes = await client.query(
      `SELECT *
       FROM store_items
       WHERE guild_id=$1 AND item_id=$2 AND enabled=true
       LIMIT 1`,
      [guildId, itemId]
    );

    const item = itemRes.rows?.[0];
    if (!item) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }

    const unitPrice = Number(item.price || 0);
    if (unitPrice <= 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }

    // Stackable rules
    const stackable = !!item.stackable;
    const maxOwned = Number(item.max_owned || 0);
    const maxUses = Number(item.max_uses || 0);
    const maxPurchaseEver = Number(item.max_purchase_ever || 0);
    const cooldownSeconds = Number(item.cooldown_seconds || 0);
    const dailyStock = Number(item.daily_stock || 0);

    // If not stackable or uses-based, qty must be 1
    const qtyBought = stackable && maxUses <= 0 ? qty : 1;

    // Check max_purchase_ever
    if (maxPurchaseEver > 0) {
      const everRes = await client.query(
        `
        SELECT COALESCE(SUM(qty),0) AS bought
        FROM store_purchases
        WHERE guild_id=$1 AND user_id=$2 AND item_id=$3
        `,
        [guildId, userId, itemId]
      );
      const boughtEver = Number(everRes.rows?.[0]?.bought ?? 0);
      if (boughtEver + qtyBought > maxPurchaseEver) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "max_purchase_ever" };
      }
    }

    // Check cooldown_seconds
    if (cooldownSeconds > 0) {
      const cdRes = await client.query(
        `
        SELECT created_at
        FROM store_purchases
        WHERE guild_id=$1 AND user_id=$2 AND item_id=$3
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [guildId, userId, itemId]
      );
      const lastAt = cdRes.rows?.[0]?.created_at ? new Date(cdRes.rows[0].created_at).getTime() : 0;
      if (lastAt) {
        const now = Date.now();
        const retryAt = lastAt + cooldownSeconds * 1000;
        if (now < retryAt) {
          await client.query("ROLLBACK");
          return { ok: false, reason: "cooldown", retryAfterSec: Math.ceil((retryAt - now) / 1000) };
        }
      }
    }

    // Check daily stock (per guild per item)
    if (dailyStock > 0) {
      const stockRes = await client.query(
        `
        SELECT COALESCE(SUM(qty),0) AS sold_today
        FROM store_purchases
        WHERE guild_id=$1 AND item_id=$2
          AND created_at >= ${SQL_UTC_DAY_START}
        `,
        [guildId, itemId]
      );
      const soldToday = Number(stockRes.rows?.[0]?.sold_today ?? 0);
      if (soldToday + qtyBought > dailyStock) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "sold_out_daily" };
      }
    }

    // Check max_owned
    if (maxOwned > 0) {
      const ownedRes = await client.query(
        `
        SELECT qty
        FROM user_inventory
        WHERE guild_id=$1 AND user_id=$2 AND item_id=$3
        LIMIT 1
        `,
        [guildId, userId, itemId]
      );
      const owned = Number(ownedRes.rows?.[0]?.qty ?? 0);
      if (owned + qtyBought > maxOwned) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "max_owned" };
      }
    }

    const totalPrice = unitPrice * qtyBought;

    // Debit user atomically
    const debitRes = await client.query(
      `
      UPDATE user_balances
      SET balance = balance - $3
      WHERE guild_id=$1 AND user_id=$2 AND balance >= $3
      RETURNING balance
      `,
      [guildId, userId, totalPrice]
    );

    if (debitRes.rowCount === 0) {
      const balNow = await client.query(
        `SELECT balance FROM user_balances WHERE guild_id=$1 AND user_id=$2`,
        [guildId, userId]
      );
      await client.query("ROLLBACK");
      return { ok: false, reason: "insufficient_funds", balance: Number(balNow.rows?.[0]?.balance ?? 0) };
    }

    const newBalance = Number(debitRes.rows[0].balance);

    // Inventory upsert:
    // - Uses items: on INSERT set uses_remaining=maxUses
    // - On UPDATE: do NOT refill uses (prevents “recharge abuse”)
    const isUsesItem = Number(maxUses || 0) > 0;

    const invRes = await client.query(
      `
      INSERT INTO user_inventory (guild_id, user_id, item_id, qty, uses_remaining, meta, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
      ON CONFLICT (guild_id, user_id, item_id)
      DO UPDATE SET
        qty = user_inventory.qty + EXCLUDED.qty,
        updated_at = NOW()
      RETURNING qty, uses_remaining
      `,
      [guildId, userId, itemId, qtyBought, isUsesItem ? maxUses : 0, JSON.stringify(meta)]
    );

    const newQty = Number(invRes.rows?.[0]?.qty ?? qtyBought);
    const usesRemaining = Number(invRes.rows?.[0]?.uses_remaining ?? 0);

    // Store purchase log
    await client.query(
      `
      INSERT INTO store_purchases (guild_id, user_id, item_id, qty, unit_price, total_price)
      VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [guildId, userId, itemId, qtyBought, unitPrice, totalPrice]
    );

    // Transactions audit
    await client.query(
      `
      INSERT INTO transactions (guild_id, user_id, amount, type, meta)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [
        guildId,
        userId,
        -totalPrice,
        "shop_purchase",
        JSON.stringify({
          itemId,
          qty: qtyBought,
          unitPrice,
          totalPrice,
          kind: item.kind,
          maxOwned,
          maxUses,
          maxPurchaseEver,
          cooldownSeconds,
          dailyStock,
          itemMeta: item.meta,
          ...meta,
        }),
      ]
    );

    await client.query("COMMIT");

    return {
      ok: true,
      item,
      qtyBought,
      totalPrice,
      newBalance,
      newQty,
      usesRemaining: isUsesItem ? usesRemaining : undefined,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * List sellable items the user currently owns (qty > 0) where the store item
 * is marked sell_enabled and has a positive sell_price.
 */
async function listSellableItems(guildId, userId) {
  const res = await pool.query(
    `
    SELECT ui.item_id,
           ui.qty,
           COALESCE(si.name, ui.item_id) AS name,
           COALESCE(si.kind, 'item') AS kind,
           COALESCE(si.sell_price, 0) AS sell_price,
           COALESCE(si.sort_order, 999999) AS sort_order
    FROM user_inventory ui
    JOIN store_items si
      ON si.guild_id = ui.guild_id AND si.item_id = ui.item_id
    WHERE ui.guild_id=$1
      AND ui.user_id=$2
      AND ui.qty > 0
      AND si.sell_enabled = true
      AND COALESCE(si.sell_price, 0) > 0
    ORDER BY COALESCE(si.sort_order, 999999) ASC, ui.item_id ASC
    `,
    [guildId, userId]
  );
  return res.rows;
}

/**
 * Sell an owned item for its configured sell_price.
 * - guild-scoped
 * - never allows negative inventory
 * - credits balance
 * - logs transactions (type: shop_sell)
 */
async function sellItem(guildId, userId, itemId, qtyRaw, meta = {}) {
  const qty = clampQty(qtyRaw);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ensure base rows exist
    await client.query(
      `INSERT INTO guilds (guild_id) VALUES ($1)
       ON CONFLICT (guild_id) DO NOTHING`,
      [guildId]
    );

    await client.query(
      `INSERT INTO user_balances (guild_id, user_id) VALUES ($1, $2)
       ON CONFLICT (guild_id, user_id) DO NOTHING`,
      [guildId, userId]
    );

    // Validate item is sellable and get price
    const itemRes = await client.query(
      `SELECT item_id, name, sell_enabled, sell_price
       FROM store_items
       WHERE guild_id=$1 AND item_id=$2
       LIMIT 1`,
      [guildId, itemId]
    );

    const item = itemRes.rows?.[0];
    if (!item || !item.sell_enabled || Number(item.sell_price || 0) <= 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_sellable" };
    }

    const unitPrice = Number(item.sell_price);
    const total = unitPrice * qty;

    // Lock inventory row
    const invRes = await client.query(
      `SELECT qty
       FROM user_inventory
       WHERE guild_id=$1 AND user_id=$2 AND item_id=$3
       FOR UPDATE`,
      [guildId, userId, itemId]
    );

    const owned = Number(invRes.rows?.[0]?.qty ?? 0);
    if (owned <= 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_owned" };
    }
    if (owned < qty) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "insufficient_qty", owned };
    }

    // Decrement inventory
    const remaining = owned - qty;
    if (remaining === 0) {
      await client.query(
        `DELETE FROM user_inventory WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`,
        [guildId, userId, itemId]
      );
    } else {
      await client.query(
        `UPDATE user_inventory
         SET qty=$4, updated_at=NOW()
         WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`,
        [guildId, userId, itemId, remaining]
      );
    }

    // Credit user
    const balRes = await client.query(
      `UPDATE user_balances
       SET balance = balance + $3
       WHERE guild_id=$1 AND user_id=$2
       RETURNING balance`,
      [guildId, userId, total]
    );

    const newBalance = Number(balRes.rows?.[0]?.balance ?? 0);

    // Transactions audit
    await client.query(
      `
      INSERT INTO transactions (guild_id, user_id, amount, type, meta)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [
        guildId,
        userId,
        total,
        "shop_sell",
        JSON.stringify({
          itemId,
          itemName: item.name ?? itemId,
          qty,
          unitPrice,
          total,
          ...meta,
        }),
      ]
    );

    await client.query("COMMIT");
    return { ok: true, itemId, qtySold: qty, unitPrice, total, remainingQty: remaining, balance: newBalance };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Convenience helper for Grind/loot: grant stackable inventory qty without charging.
 * (If item_id isn't in store_items, it will still exist in inventory but won't have a nice name.)
 */
async function grantInventoryQty(guildId, userId, itemId, qtyRaw = 1, meta = {}) {
  const qty = clampQty(qtyRaw);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO guilds (guild_id) VALUES ($1)
       ON CONFLICT (guild_id) DO NOTHING`,
      [guildId]
    );

    await client.query(
      `
      INSERT INTO user_inventory (guild_id, user_id, item_id, qty, uses_remaining, meta, updated_at)
      VALUES ($1, $2, $3, $4, 0, $5::jsonb, NOW())
      ON CONFLICT (guild_id, user_id, item_id)
      DO UPDATE SET
        qty = user_inventory.qty + EXCLUDED.qty,
        updated_at = NOW()
      `,
      [guildId, userId, itemId, qty, JSON.stringify(meta)]
    );

    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  listStoreItems,
  getStoreItem,
  getInventory,
  purchaseItem,
  listSellableItems,
  sellItem,
  grantInventoryQty,
  removeBrokenIfZero,
};
