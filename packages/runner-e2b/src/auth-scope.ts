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
  const env = normalizeE2bAuthEnv(input.env ?? process.env);
  const document = await readMergedDocument(
    fs,
    resolveConfigPath(homeDir),
    resolveProjectConfigPath(input.cwd)
  );
  const resolved = resolveScope(e2bAuthScope.schema, document.e2b, env);
  const apiKey = resolved.api_key.trim();
  if (apiKey.length === 0) {
    throw new Error(
      `No E2B API key. Set E2B_API_KEY or e2b.api_key in ${resolveProjectConfigPath(input.cwd)} or ~/.poe-code/config.json.`
    );
  }
  return apiKey;
}

function normalizeE2bAuthEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  if (env.E2B_API_KEY === undefined || env.E2B_API_KEY.trim().length > 0) {
    return env;
  }

  const { E2B_API_KEY: ignoredApiKey, ...rest } = env;
  return rest;
}
