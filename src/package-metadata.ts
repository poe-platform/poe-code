import { createRequire } from "node:module";

// This module and the root bundle both live one directory below the manifest.
// Load after installation: semantic-release versions it after the verified build.
export const packageVersion: string = createRequire(import.meta.url)("../package.json").version;
