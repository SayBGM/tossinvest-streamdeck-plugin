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
const requiredEntries = [
  /(^|\/)manifest\.json$/,
  /(^|\/)bin\/plugin\.js$/,
  /(^|\/)ui\/quote\.html$/,
  /(^|\/)ui\/quote\.js$/,
  /(^|\/)ui\/quote\.css$/,
  /(^|\/)ui\/sdpi\.js$/,
  /(^|\/)imgs\/plugin-icon\.png$/,
  /(^|\/)imgs\/plugin-icon@2x\.png$/,
  /(^|\/)imgs\/category-icon\.png$/,
  /(^|\/)imgs\/category-icon@2x\.png$/,
  /(^|\/)imgs\/quote-action\.svg$/,
];
for (const required of requiredEntries) {
  if (!entries.some((name) => required.test(name))) throw new Error(`패키지에 핵심 파일이 없습니다: ${required}`);
}
const hash = createHash("sha256").update(readFileSync(packagePath)).digest("hex");
const checksumPath = resolve(dist, "SHA256SUMS");
if (!existsSync(checksumPath)) throw new Error("dist/SHA256SUMS 파일이 없습니다. package:plugin을 먼저 실행하세요.");
const checksum = readFileSync(checksumPath, "utf8").split(/\r?\n/).map((line) => line.trim()).find((line) => line.endsWith(`  ${packageName}`) || line.endsWith(` *${packageName}`));
if (!checksum) throw new Error(`SHA256SUMS에 패키지 항목이 없습니다: ${packageName}`);
const expected = checksum.split(/\s+/)[0];
if (!/^[a-f0-9]{64}$/i.test(expected) || expected.toLowerCase() !== hash) throw new Error(`패키지 SHA256 해시가 일치하지 않습니다: ${packageName}`);
console.log(`package verified: ${packageName}`);
