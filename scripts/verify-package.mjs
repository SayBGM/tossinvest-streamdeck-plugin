import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import AdmZip from "adm-zip";

const dist = resolve("dist");
const packageName = readdirSync(dist).find((name) => name.endsWith(".streamDeckPlugin"));
if (!packageName) throw new Error("dist에 .streamDeckPlugin 파일이 없습니다.");
const packagePath = resolve(dist, packageName);
const entries = new AdmZip(packagePath).getEntries().map((entry) => entry.entryName);
for (const forbidden of [/\.map\s*$/, /(^|\/)logs\//, /(^|\/)node_modules\//, /\.env(?:\.|$)/i, /client.?secret/i]) {
  if (entries.some((entry) => forbidden.test(entry))) throw new Error(`패키지에 금지된 파일이 포함되어 있습니다: ${forbidden}`);
}
if (!entries.some((name) => name.endsWith("/manifest.json")) || !entries.some((name) => name.endsWith("/bin/plugin.js"))) throw new Error("핵심 파일이 패키지에 없습니다.");
const hash = createHash("sha256").update(readFileSync(packagePath)).digest("hex");
const checksumPath = resolve(dist, "SHA256SUMS");
const checksumName = packageName;
const line = `${hash}  ${checksumName}\n`;
await import("node:fs/promises").then(({ writeFile }) => writeFile(checksumPath, line, "utf8"));
console.log(`package verified: ${packageName}\n${line.trim()}`);
