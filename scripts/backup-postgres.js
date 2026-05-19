const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const backupDir = path.join(root, "backups");
const envPath = path.join(root, ".env");
const defaultPgDump = "D:\\sql2016\\bin\\pg_dump.exe";
const defaultPgRestore = "D:\\sql2016\\bin\\pg_restore.exe";

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

function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("-");
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    windowsHide: true
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed with exit code ${result.status}`);
  }
}

loadEnv(envPath);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing in .env");
}

const database = new URL(process.env.DATABASE_URL);
const pgDump = process.env.PG_DUMP_PATH || defaultPgDump;
const pgRestore = process.env.PG_RESTORE_PATH || defaultPgRestore;

if (!fs.existsSync(pgDump)) throw new Error(`pg_dump.exe not found: ${pgDump}`);
if (!fs.existsSync(pgRestore)) throw new Error(`pg_restore.exe not found: ${pgRestore}`);

fs.mkdirSync(backupDir, { recursive: true });

const output = path.join(backupDir, `generator-erp-${timestamp()}.dump`);
const args = [
  "-h", database.hostname,
  "-p", database.port || "5432",
  "-U", decodeURIComponent(database.username),
  "-d", database.pathname.replace(/^\//, ""),
  "-Fc",
  "-f", output
];

run(pgDump, args, { PGPASSWORD: decodeURIComponent(database.password) });
run(pgRestore, ["-l", output], {});

const stat = fs.statSync(output);
console.log(`Backup created: ${output}`);
console.log(`Backup size: ${stat.size} bytes`);
