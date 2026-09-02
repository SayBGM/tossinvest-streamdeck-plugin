import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("com.saybgm.tossinvest.sdPlugin");
const required = ["manifest.json", "bin/plugin.js", "ui/quote.html", "ui/quote.js", "ui/quote.css", "imgs/plugin-icon.png", "imgs/plugin-icon@2x.png"];
const missing = required.filter((file) => !existsSync(resolve(root, file)));
if (missing.length) throw new Error(`빌드 산출물이 없습니다: ${missing.join(", ")}`);
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
if (manifest.UUID !== "com.saybgm.tossinvest" || manifest.Version !== "0.1.0.0") throw new Error("manifest 식별자/버전이 예상과 다릅니다.");
if (!manifest.Actions?.some((action) => action.UUID === "com.saybgm.tossinvest.quote")) throw new Error("quote 액션이 manifest에 없습니다.");
console.log(`build verified: ${required.length} files`);
