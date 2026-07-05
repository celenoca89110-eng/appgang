const db = require('./database');

async function fix() {
  try {
    await db.query(`
      ALTER TABLE gangs
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
    `);

    console.log("✅ updated_at ajouté");
  } catch (err) {
    console.error("❌ erreur:", err);
  }
}

fix();
