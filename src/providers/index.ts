import path from "node:path";
import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ProviderService } from "../cli/service-registry.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const currentDir = path.basename(moduleDir) === "providers"
  ? moduleDir
  : path.join(moduleDir, "providers");

function isProviderModule(filename: string): boolean {
  if (filename.endsWith(".d.ts") || filename.endsWith(".d.ts.map")) {
    return false;
  }
  if (filename.endsWith(".map")) {
    return false;
  }
  if (!(filename.endsWith(".ts") || filename.endsWith(".js"))) {
    return false;
  }
  if (filename.endsWith(".test.ts") || filename.endsWith(".test.js")) {
    return false;
  }
  if (
    filename === "index.ts" ||
    filename === "index.js" ||
    filename === "create-provider.ts" ||
    filename === "create-provider.js" ||
    filename === "spawn-options.ts" ||
    filename === "spawn-options.js" ||
    filename === "mcp-config.ts" ||
    filename === "mcp-config.js" ||
    filename === "provider-helpers.ts" ||
    filename === "provider-helpers.js"
  ) {
    return false;
  }
  return true;
}

async function loadProviders(): Promise<ProviderService[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const providers: ProviderService[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isProviderModule(entry.name)) continue;
    const moduleUrl = pathToFileURL(path.join(currentDir, entry.name)).href;
    const moduleExports = (await import(moduleUrl)) as {
      provider?: ProviderService;
    };
    if (!moduleExports.provider) {
      throw new Error(`Provider module "${entry.name}" must export "provider".`);
    }
    providers.push(moduleExports.provider);
  }

  return providers.sort((a, b) => a.name.localeCompare(b.name));
}

const defaultProviders = await loadProviders();

export function getDefaultProviders(): ProviderService[] {
  return [...defaultProviders];
}
