// Stages everything the Tauri bundle needs next to src-tauri/:
//   resources/web            built frontend
//   resources/server         esbuild bundle of server/ + flat node_modules for the native deps
//   binaries/node-<triple>   Node runtime used as the sidecar
//
// Usage: tsx scripts/desktop/prepare.ts [--target <rust triple>]
// Env:   NODE_MIRROR  e.g. https://npmmirror.com/mirrors/node (default nodejs.org)
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NODE_VERSION = "22.21.1";
// Imported dynamically by server/embeddings.ts; they pull in onnxruntime-node and sharp,
// whose native binaries cannot be bundled.
const EXTERNAL = ["@huggingface/transformers", "@chroma-core/default-embed"];

const root = fileURLToPath(new URL("../..", import.meta.url));
const tauriDir = join(root, "src-tauri");
const resources = join(tauriDir, "resources");
const binaries = join(tauriDir, "binaries");
const cacheDir = join(root, "node_modules", ".cache", "desktop");

interface Target {
  triple: string;
  os: "darwin" | "win32";
  cpu: "arm64" | "x64";
}

const TARGETS: Record<string, Target> = {
  "aarch64-apple-darwin": { triple: "aarch64-apple-darwin", os: "darwin", cpu: "arm64" },
  "x86_64-apple-darwin": { triple: "x86_64-apple-darwin", os: "darwin", cpu: "x64" },
  "x86_64-pc-windows-msvc": { triple: "x86_64-pc-windows-msvc", os: "win32", cpu: "x64" },
};

function hostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  return /^host: (.+)$/m.exec(out)![1].trim();
}

function parseTarget(): Target {
  const i = process.argv.indexOf("--target");
  const triple = i >= 0 ? process.argv[i + 1] : hostTriple();
  const t = TARGETS[triple];
  if (!t) throw new Error(`不支持的 target：${triple}（可选：${Object.keys(TARGETS).join(", ")}）`);
  return t;
}

// pnpm / npm are .cmd shims on Windows and need a shell; curl / tar must not get one,
// since shell mode does not quote paths with spaces.
const run = (cmd: string, args: string[], cwd = root) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" && (cmd === "pnpm" || cmd === "npm") });

function step(title: string) {
  console.log(`\n▸ ${title}`);
}

async function buildWeb() {
  step("构建前端");
  run("pnpm", ["exec", "vite", "build"]);
  cpSync(join(root, "web", "dist"), join(resources, "web"), { recursive: true });
}

async function buildServer() {
  step("打包 server");
  const out = join(resources, "server");
  await build({
    entryPoints: [join(root, "server", "index.ts")],
    outfile: join(out, "index.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: EXTERNAL,
    // Bundled CJS deps may call require(); give ESM output one.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: "warning",
  });
}

function installNativeDeps(t: Target) {
  step(`安装原生依赖（${t.os}-${t.cpu}）`);
  const out = join(resources, "server");
  const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dependencies = Object.fromEntries(EXTERNAL.map((name) => [name, rootPkg.dependencies[name]]));
  writeFileSync(join(out, "package.json"), JSON.stringify({ name: "chromadb-gui-server", private: true, type: "module", dependencies }, null, 2));
  // npm (not pnpm) so node_modules is flat, with no symlinks for the bundler to trip on.
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock", `--os=${t.os}`, `--cpu=${t.cpu}`], out);
  pruneOnnxRuntime(join(out, "node_modules"), t);
  pruneUnused(join(out, "node_modules"));
}

/**
 * Source maps, and the onnxruntime-web wasm builds: under Node transformers.js runs on
 * onnxruntime-node, so the wasm backend (~65MB) is never loaded.
 */
function pruneUnused(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) pruneUnused(p);
    else if (e.name.endsWith(".map") || e.name.endsWith(".wasm")) rmSync(p);
  }
}

/** onnxruntime-node ships binaries for every platform (~200MB); keep only the target's. */
function pruneOnnxRuntime(nodeModules: string, t: Target) {
  const dirs: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (!existsSync(dir) || depth > 4) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = join(dir, e.name);
      if (e.name === "onnxruntime-node") dirs.push(p);
      else if (e.name === "node_modules" || e.name.startsWith("@") || depth === 0) walk(p, depth + 1);
    }
  };
  walk(nodeModules, 0);
  for (const dir of dirs) {
    const bin = join(dir, "bin");
    if (!existsSync(bin)) continue;
    for (const napi of readdirSync(bin)) {
      for (const os of readdirSync(join(bin, napi))) {
        const osDir = join(bin, napi, os);
        if (os !== t.os) {
          rmSync(osDir, { recursive: true, force: true });
          continue;
        }
        for (const cpu of readdirSync(osDir)) if (cpu !== t.cpu) rmSync(join(osDir, cpu), { recursive: true, force: true });
      }
    }
  }
  console.log(`  已裁剪 ${dirs.length} 份 onnxruntime-node`);
}

function fetchNode(t: Target) {
  step(`准备 Node ${NODE_VERSION} 运行时`);
  const ext = t.os === "win32" ? ".exe" : "";
  const dest = join(binaries, `node-${t.triple}${ext}`);
  const stamp = `${dest}.version`;
  if (existsSync(dest) && existsSync(stamp) && readFileSync(stamp, "utf8") === NODE_VERSION) {
    console.log("  已存在，跳过");
    return;
  }
  const mirror = (process.env.NODE_MIRROR ?? "https://nodejs.org/dist").replace(/\/$/, "");
  const name = `node-v${NODE_VERSION}-${t.os === "win32" ? "win" : "darwin"}-${t.cpu}`;
  const archive = `${name}.${t.os === "win32" ? "zip" : "tar.gz"}`;
  const work = join(cacheDir, name);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const file = join(work, archive);
  run("curl", ["-fL", "--retry", "3", "-o", file, `${mirror}/v${NODE_VERSION}/${archive}`]);
  // bsdtar (macOS, Windows 10+) extracts both .tar.gz and .zip.
  run("tar", ["-xf", file, "-C", work]);
  const exe = t.os === "win32" ? join(work, name, "node.exe") : join(work, name, "bin", "node");
  copyFileSync(exe, dest);
  if (t.os !== "win32") chmodSync(dest, 0o755);
  writeFileSync(stamp, NODE_VERSION);
}

const target = parseTarget();
console.log(`target: ${target.triple}`);
rmSync(resources, { recursive: true, force: true });
mkdirSync(join(resources, "server"), { recursive: true });
mkdirSync(binaries, { recursive: true });
await buildWeb();
await buildServer();
installNativeDeps(target);
fetchNode(target);
console.log("\n✓ 桌面端资源已就绪");
