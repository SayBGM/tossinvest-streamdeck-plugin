import {
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const output = resolve("dist");
mkdirSync(output, { recursive: true });
for (const name of [
  "com.saybgm.tossinvest.streamDeckPlugin",
  "com.saybgm.tossinvest-v0.1.0.streamDeckPlugin",
]) {
  const path = resolve(output, name);
  if (existsSync(path)) rmSync(path, { force: true });
}
const cli = resolve("node_modules/@elgato/cli/bin/streamdeck.mjs");
const args = [
  "pack",
  "com.saybgm.tossinvest.sdPlugin",
  "--output",
  output,
  "--force",
  "--no-update-check",
  "--no-file-list",
];
if (process.platform === "win32") {
  execFileSync(process.execPath, [cli, ...args], { stdio: "inherit" });
} else {
  execFileSync("node_modules/.bin/streamdeck", args, { stdio: "inherit" });
}
const packageName = readdirSync(output).find((name) =>
  name.endsWith(".streamDeckPlugin"),
);
if (!packageName)
  throw new Error("패키징 결과 .streamDeckPlugin 파일을 찾을 수 없습니다.");
const hash = createHash("sha256")
  .update(readFileSync(resolve(output, packageName)))
  .digest("hex");
writeFileSync(
  resolve(output, "SHA256SUMS"),
  `${hash}  ${packageName}\n`,
  "utf8",
);
console.log("package created in dist/");
