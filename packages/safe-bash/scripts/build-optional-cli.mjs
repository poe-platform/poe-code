import { fileURLToPath } from "node:url";
import { buildPackage } from "./build.mjs";
import { buildOptionalPackage } from "./build-optional.mjs";

try {
  if (process.argv.length !== 2) throw new Error("Optional workspace build accepts no arguments");
  const result = await buildOptionalPackage({
    rootDir: fileURLToPath(new URL("../../..", import.meta.url)),
    compile: buildPackage,
  });
  process.exitCode = result.status;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
