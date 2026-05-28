import { cpSync, mkdirSync } from "fs";
import path from "node:path";
import { assertSafeOutputDirectory } from "../../../scripts/guard-package-dist.mjs";

await assertSafeOutputDirectory(process.cwd(), path.resolve("dist/config"));
mkdirSync("dist/config", { recursive: true });
cpSync("src/config/default-run.yaml", "dist/config/default-run.yaml");
cpSync("src/config/default-instructions.md", "dist/config/default-instructions.md");
