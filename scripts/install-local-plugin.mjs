import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const pluginSource = path.join(projectRoot, "com.saybgm.tossinvest.sdPlugin");
const manifestPath = path.join(pluginSource, "manifest.json");

const manifestRaw = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);

if (!manifest.UUID || typeof manifest.UUID !== "string") {
  throw new Error("manifest.json의 UUID를 찾지 못했습니다.");
}

const pluginFolderName = `${manifest.UUID}.sdPlugin`;
const pluginsRoot = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "com.elgato.StreamDeck",
  "Plugins",
);
const targetDir = path.join(pluginsRoot, pluginFolderName);

await mkdir(pluginsRoot, { recursive: true });

// Copy all files from com.saybgm.tossinvest.sdPlugin to plugins directory
await cp(pluginSource, targetDir, { recursive: true, force: true });

const markerPath = path.join(targetDir, ".local-install-marker");
await writeFile(
  markerPath,
  `Installed at ${new Date().toISOString()}\nsource=${projectRoot}\n`,
  "utf8",
);

console.log(`로컬 Stream Deck 플러그인 설치 완료: ${targetDir}`);

// Kill running node process for this plugin so Stream Deck restarts it cleanly
try {
  const pids = execSync(
    "pgrep -f 'com.saybgm.tossinvest.sdPlugin/bin/plugin.js' || true",
    {
      encoding: "utf8",
    },
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  for (const pid of pids) {
    console.log(`기존 플러그인 프로세스 종료 (PID: ${pid})...`);
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch (_) {}
  }
  if (pids.length > 0) {
    console.log(
      "Stream Deck이 최신 플러그인 프로세스를 자동으로 재시작합니다.",
    );
  }
} catch (_) {
  // ignore
}

console.log(
  "Stream Deck 설정창(Property Inspector)을 열면 최신 빌드가 즉시 반영됩니다.",
);
