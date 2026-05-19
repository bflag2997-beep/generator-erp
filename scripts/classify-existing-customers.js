const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const root = path.resolve(__dirname, "..");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function classify(name) {
  const companyWords = ["شركة", "فندق", "مستشفى", "مطعم", "كافية", "محطة", "مجمع", "مقاولات", "للتجارة", "للتجارة العامة"];
  return companyWords.some((word) => String(name || "").includes(word)) ? "شركة" : "فرد";
}

async function main() {
  loadEnv(path.join(root, ".env"));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const rows = await pool.query("SELECT id, name, data FROM customers ORDER BY id");
    let updated = 0;
    for (const row of rows.rows) {
      const data = row.data || {};
      if (data.sector && data.customerKind) continue;
      const customerKind = classify(row.name);
      const sector = "قطاع خاص";
      const type = `${sector} - ${customerKind}`;
      await pool.query(
        "UPDATE customers SET type=$1, data=$2, updated_at=now() WHERE id=$3",
        [type, { ...data, sector, customerKind, type }, row.id]
      );
      updated += 1;
    }
    console.log(JSON.stringify({ scanned: rows.rowCount, updated }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
