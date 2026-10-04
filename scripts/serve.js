const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const entry = path.resolve(__dirname, "../dist/index.html");
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be an integer between 1 and 65535.");
  process.exit(1);
}
if (!fs.existsSync(entry)) {
  console.error("Missing dist/index.html. Run npm run build first.");
  process.exit(1);
}

const server = http.createServer((request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" });
    return response.end("Method not allowed");
  }
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname !== "/" && pathname !== "/index.html") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Not found");
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") return response.end();
  fs.createReadStream(entry).pipe(response);
});

server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is in use. Choose another port with PORT=3001 npm start.`
      : error.message,
  );
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(`见一面 → http://127.0.0.1:${port}`),
);
