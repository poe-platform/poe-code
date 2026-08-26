import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const modes = {
  freeze: ["--import", "tsx", "tests/commands/network-stress/freeze.ts", "--freeze-new"],
  native: ["--import", "tsx", "--test", "--test-concurrency=1", "tests/commands/network-stress/oracle.test.ts"],
  product: ["--import", "tsx", "tests/commands/network-stress/product.ts"],
  typecheck: ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tests/commands/network-stress/tsconfig.json"],
};
const mode = process.argv[2] ?? "native";
if (!Object.hasOwn(modes, mode) || process.argv.length > 3) throw new Error("Expected native, freeze, product, or typecheck");
if (process.platform === "win32") throw new Error("This frozen native profile requires POSIX process groups");
const owned = fileURLToPath(new URL(".", import.meta.url));
const lock = join(owned, ".watchdog-lock");
await mkdir(lock);
const previous = new Set(await readdir(owned));
let child;
let expired = false;
let interrupted = false;
let timer;
let hardTimer;
const terminate = (signal) => {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
};
const interrupt = () => { interrupted = true; terminate("SIGTERM"); };
try {
  child = spawn(process.execPath, ["--unhandled-rejections=strict", ...modes[mode]], { cwd: fileURLToPath(new URL("../../../", import.meta.url)), stdio: "inherit", shell: false, detached: true });
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  timer = setTimeout(() => { expired = true; terminate("SIGTERM"); }, mode === "product" ? 420000 : 90000);
  hardTimer = setTimeout(() => terminate("SIGKILL"), mode === "product" ? 422000 : 92000);
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (expired || result.signal) process.stderr.write(`network-stress watchdog: expired=${expired}, signal=${result.signal}\n`);
  process.exitCode = interrupted ? 130 : expired ? 124 : result.code ?? 1;
} finally {
  clearTimeout(timer);
  clearTimeout(hardTimer);
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  terminate("SIGKILL");
  for (const name of await readdir(owned)) {
    if (!previous.has(name) && /^\.native-[A-Za-z0-9]{6}$/.test(name)) await rm(join(owned, name), { recursive: true, force: true });
  }
  await rm(lock, { recursive: true });
}
