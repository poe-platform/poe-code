import os from "node:os";
import { promises as nodeFs } from "node:fs";
import {
  defineScope,
  readMergedDocument,
  resolveConfigPath,
  resolveProjectConfigPath,
  resolveScope
} from "@poe-code/poe-code-config";
import type { FileSystem } from "@poe-code/config-mutations";

export const e2bAuthScope = defineScope("e2b", {
  api_key: {
    type: "string",
    default: "",
    doc: "E2B API key",
    env: "E2B_API_KEY"
  }
});

export interface ResolveE2bApiKeyInput {
  cwd: string;
  homeDir?: string;
  fs?: FileSystem;
  env?: Record<string, string | undefined>;
}

export async function resolveE2bApiKey(input: ResolveE2bApiKeyInput): Promise<string> {
  const homeDir = input.homeDir ?? os.homedir();
  const fs = input.fs ?? (nodeFs as unknown as FileSystem);
  const env = input.env ?? process.env;
  const document = await readMergedDocument(
    fs,
    resolveConfigPath(homeDir),
    resolveProjectConfigPath(input.cwd)
  );
  const resolved = resolveScope(e2bAuthScope.schema, document.e2b, env);
  if (resolved.api_key.length === 0) {
    throw new Error(
      "No E2B API key. Set E2B_API_KEY or e2b.api_key in ~/.poe-code/config.json."
    );
  }
  return resolved.api_key;
}
