import path from "node:path";
import { assertMcpSdkIsDevDependencyOnly } from "../src/sdk-dependency-audit.js";

try {
  await assertMcpSdkIsDevDependencyOnly({
    packagesDir: path.resolve(process.cwd(), "packages"),
  });
  process.stdout.write("Verified @modelcontextprotocol/sdk is restricted to devDependencies under packages/.\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
