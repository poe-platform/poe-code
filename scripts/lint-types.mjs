import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const noCache = process.argv.includes("--no-cache") || process.env.POE_CHECK_NO_CACHE === "1";

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
// Workspace declarations must reflect current sources before root checking.
// The maintained builder owns dependency discovery and complete build cache keys.
// Do not cache successful typechecks separately: contracts and imported workspace
// types can change independently of the root source tree.
runCommand(process.execPath, ["scripts/build-workspaces.mjs", ...(noCache ? ["--no-cache"] : [])]);

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
