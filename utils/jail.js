const pool = require("./db");

/**
 * Returns the jail release Date if jailed, or null if not jailed
 */
async function getJailRelease(guildId, userId) {
  const { rows } = await pool.query(
    `
    SELECT jailed_until
    FROM jail
    WHERE guild_id = $1 AND user_id = $2
    `,
    [guildId, userId]
  );

  if (!rows.length) return null;

  const jailedUntil = rows[0].jailed_until;
  if (!jailedUntil) return null;

  // If jail expired, clear it
  if (new Date(jailedUntil) <= new Date()) {
    await pool.query(
      `
      DELETE FROM jail
      WHERE guild_id = $1 AND user_id = $2
      `,
      [guildId, userId]
    );
    return null;
  }

  return new Date(jailedUntil);
}

/**
 * Slash-command guard
 * RETURN TRUE  = BLOCK command
 * RETURN FALSE = ALLOW command
 */
async function guardNotJailed(interaction) {
  const jailedUntil = await getJailRelease(
    interaction.guildId,
    interaction.user.id
  );

  // ✅ Not jailed → allow command
  if (!jailedUntil) return false;

  // ⛓️ Jailed → block command
  const ts = Math.floor(jailedUntil.getTime() / 1000);
  const message = `⛓️ You are jailed until <t:${ts}:R>.`;

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: message,
        flags: 64, // Ephemeral
      });
    } else {
      await interaction.reply({
        content: message,
        flags: 64, // Ephemeral
      });
    }
  } catch {
    // ignore reply errors
  }

  return true;
}

/**
 * Component-interaction guard (buttons/selects)
 * RETURN TRUE  = BLOCK interaction
 * RETURN FALSE = ALLOW interaction
 */
async function guardNotJailedComponent(interaction) {
  const jailedUntil = await getJailRelease(
    interaction.guildId,
    interaction.user.id
  );

  // ✅ Not jailed → allow
  if (!jailedUntil) return false;

  // ⛓️ Jailed → block
  const ts = Math.floor(jailedUntil.getTime() / 1000);
  const message = `⛓️ You are jailed until <t:${ts}:R>.`;

  try {
    await interaction.reply({
      content: message,
      flags: 64, // Ephemeral
    });
  } catch {
    // ignore reply errors
  }

  return true;
}

/**
 * Sets a jail sentence (minutes)
 */
async function setJail(guildId, userId, minutes) {
  const jailedUntil = new Date(Date.now() + minutes * 60 * 1000);

  await pool.query(
    `
    INSERT INTO jail (guild_id, user_id, jailed_until)
    VALUES ($1, $2, $3)
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET jailed_until = EXCLUDED.jailed_until
    `,
    [guildId, userId, jailedUntil]
  );

  return jailedUntil;
}

module.exports = {
  guardNotJailed,
  guardNotJailedComponent,
  setJail,
  getJailRelease,
};
