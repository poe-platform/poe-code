#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveSafeBashRuntime } from "./safe-bash-runtime.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const entry = await resolveSafeBashRuntime(repoRoot);
const { safeBashMain } = await import(pathToFileURL(entry).href);
await safeBashMain();
