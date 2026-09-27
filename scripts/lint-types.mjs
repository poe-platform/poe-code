import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCheckCache } from "./check-cache.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const noCache = process.argv.includes("--no-cache") || process.env.POE_CHECK_NO_CACHE === "1";

function hashDirectoryTs(dir, hash) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== ".git") {
        hashDirectoryTs(full, hash);
      }
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".json"))) {
      hash.update(path.relative(root, full));
      hash.update(fs.readFileSync(full));
    }
  }
}

function computeTypecheckKey(compilerId) {
  const hash = createHash("sha256");
  hash.update("lint-types-v1\0" + compilerId);
  for (const rel of ["package.json", "tsconfig.json", "tsconfig.build.json"]) {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) {
      hash.update(rel);
      hash.update(fs.readFileSync(full));
    }
  }
  hashDirectoryTs(path.join(root, "src"), hash);
  hashDirectoryTs(path.join(root, "packages", "safe-js", "src"), hash);
  hashDirectoryTs(path.join(root, "packages", "tiny-mcp-client", "src"), hash);
  return hash.digest("hex");
}

function runCommand(command, args) {
  const res = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

const tsgoBin = process.env.POE_TSGO_BIN || path.join(root, "node_modules", ".bin", "tsgo");
const useTsgo = process.env.POE_USE_TSGO !== "0" && fs.existsSync(tsgoBin);
const tscBin = path.join(root, "node_modules", ".bin", "tsc");
const compilerBin = useTsgo ? tsgoBin : tscBin;
const compilerId = useTsgo ? "tsgo" : "tsc";

const store = createCheckCache();
const cacheKey = computeTypecheckKey(compilerId);

if (!noCache) {
  const cached = store.read(cacheKey);
  if (cached && cached.success === true) {
    process.exit(0);
  }
}

if (!fs.existsSync(path.join(root, "packages", "poe-agent", "dist", "index.d.ts"))) {
  runCommand(process.execPath, ["scripts/build-workspaces.mjs"]);
}

fs.mkdirSync(path.join(root, ".turbo", "types"), { recursive: true });
runCommand(compilerBin, [
  "-p",
  "tsconfig.build.json",
  "--noEmit",
  "--incremental",
  "--tsBuildInfoFile",
  ".turbo/types/root.tsbuildinfo"
]);
runCommand("npm", ["run", "typecheck:contracts", "--workspace=@poe-code/safe-js"]);
runCommand("npm", ["run", "typecheck:contracts", "--workspace=tiny-mcp-client"]);

if (!noCache) {
  store.write(cacheKey, { success: true, compiler: compilerId });
}
