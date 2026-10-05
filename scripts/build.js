const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const mascot = fs
  .readFileSync(path.join(root, "assets/mascot.png"))
  .toString("base64");
const modules = ["model.js", "runaway.js", "journey.js", "api-client.js", "account.js", "card-export.js", "schedule.js", "app.js"];
const scripts =
  `window.MASCOT_DATA='data:image/png;base64,${mascot}';\n` +
  modules.map((file) => read(`src/${file}`)).join("\n");
let html = read("src/index.template.html");
for (const [marker, content] of [
  ["/* INLINE_STYLES */", read("src/style.css")],
  ["/* INLINE_SCRIPTS */", scripts],
]) {
  if (html.split(marker).length !== 2) {
    throw new Error(`The HTML template must contain exactly one ${marker}`);
  }
  html = html.replace(marker, () => content);
}

let adminHtml = read("src/admin/index.template.html");
for (const [marker, content] of [
  ["/* ADMIN_STYLES */", read("src/admin/admin.css")],
  ["/* ADMIN_SCRIPTS */", read("src/admin/admin.js")],
]) {
  if (adminHtml.split(marker).length !== 2) {
    throw new Error(`The admin template must contain exactly one ${marker}`);
  }
  adminHtml = adminHtml.replace(marker, () => content);
}

// Keep the CDN's default index route empty so host routing can select the app
// or admin document. The admin document contains UI only, never account data.
for (const directory of ["dist", "public"]) {
  fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.writeFileSync(path.join(root, directory, directory === "dist" ? "index.html" : "app.html"), html);
  fs.writeFileSync(path.join(root, directory, "admin.html"), adminHtml);
}
fs.rmSync(path.join(root, "public", "index.html"), { force: true });
console.log(`Built app (${Buffer.byteLength(html)} bytes) and admin (${Buffer.byteLength(adminHtml)} bytes) documents for dist and public`);
