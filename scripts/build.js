const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const mascot = fs
  .readFileSync(path.join(root, "assets/mascot.png"))
  .toString("base64");
const modules = ["model.js", "store.js", "runaway.js", "journey.js", "app.js"];
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

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist/index.html"), html);
console.log(`Built dist/index.html (${Buffer.byteLength(html)} bytes)`);
