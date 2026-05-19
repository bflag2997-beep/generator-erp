const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const out = fs.openSync(path.join(root, "server.out.log"), "a");
const err = fs.openSync(path.join(root, "server.err.log"), "a");

const child = spawn(process.execPath, ["server.js"], {
  cwd: root,
  detached: true,
  stdio: ["ignore", out, err],
  windowsHide: true
});

child.unref();
console.log(child.pid);
