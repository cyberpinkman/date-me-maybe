const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const mascot = fs
  .readFileSync(path.join(root, "assets/mascot.png"))
  .toString("base64");
const modules = ["model.js", "runaway.js", "journey.js", "api-client.js", "account.js", "app.js"];
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

// Local Express serves dist; Vercel's Express adapter serves public via its CDN.
// Both are generated from exactly the same source and contain no server env vars.
for (const directory of ["dist", "public"]) {
  fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.writeFileSync(path.join(root, directory, "index.html"), html);
}
console.log(`Built dist/index.html and public/index.html (${Buffer.byteLength(html)} bytes each)`);
