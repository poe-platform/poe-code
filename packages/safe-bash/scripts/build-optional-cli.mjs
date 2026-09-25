import { fileURLToPath } from "node:url";
import { buildPackage } from "./build.mjs";
import { buildOptionalPackage } from "./build-optional.mjs";
import { buildBrowserShellOutputs } from "../../../scripts/bundle-safe-bash.mjs";

try {
  if (process.argv.length !== 2) throw new Error("Optional workspace build accepts no arguments");
  const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
  const result = await buildOptionalPackage({
    rootDir,
    compile: buildPackage,
  });
  if (result.status === 0) await buildBrowserShellOutputs(rootDir);
  process.exitCode = result.status;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
