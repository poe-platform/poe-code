import { createRequire } from "node:module";
import path from "node:path";

const globalWithRequire = globalThis as typeof globalThis & {
  require?: NodeJS.Require;
};

globalWithRequire.require ??= createRequire(path.join(process.cwd(), "package.json"));
