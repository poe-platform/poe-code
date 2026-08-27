import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("./", import.meta.url));
const files = readdirSync(directory).filter(name => name.endsWith(".test.ts")).sort().map(name => `${directory}${name}`);
const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-timeout=20000", ...files], {
  cwd: fileURLToPath(new URL("../../../", import.meta.url)), timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error || result.signal || result.status !== 0) throw new Error(`Archive author suite failed: ${result.error?.message ?? result.signal ?? result.status}`);
