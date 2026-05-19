const http = require("http");

const port = Number(process.env.PORT || 8090);
const url = `http://127.0.0.1:${port}/api/health`;

const req = http.get(url, (res) => {
  let body = "";
  res.on("data", (chunk) => body += chunk);
  res.on("end", () => {
    if (res.statusCode !== 200) {
      console.error(`Health check failed: HTTP ${res.statusCode}`);
      console.error(body);
      process.exit(1);
    }
    console.log(body);
  });
});

req.on("error", (error) => {
  console.error(`Health check failed: ${error.message}`);
  process.exit(1);
});

req.setTimeout(5000, () => {
  req.destroy(new Error("timeout"));
});
