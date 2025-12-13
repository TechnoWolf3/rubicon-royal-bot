const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL is not set. Economy will not work.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway") ? { rejectUnauthorized: false } : undefined,
});

module.exports = { pool };
