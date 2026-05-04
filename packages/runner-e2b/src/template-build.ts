import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { E2bRuntime, StateManager } from "@poe-code/poe-code-config";
import { buildTemplate } from "./sdk.js";

export interface BuildE2bRuntimeTemplateInput {
  runtime: E2bRuntime;
  dockerfilePath: string;
  buildContext: string;
  state?: Pick<StateManager, "templates">;
  apiKey: string;
  force?: boolean;
}

export interface BuildE2bRuntimeTemplateResult {
  backend: "e2b";
  hash: string;
  templateId: string;
  cached: boolean;
}

export async function buildE2bRuntimeTemplate(
  input: BuildE2bRuntimeTemplateInput
): Promise<BuildE2bRuntimeTemplateResult> {
  const dockerfileBytes = await readFile(input.dockerfilePath);
  const buildContextFiles = await readBuildContextFiles(input.buildContext);
  const hash = hashTemplate(dockerfileBytes, buildContextFiles, input.runtime.build_args);
  const cached = input.force === true ? null : await input.state?.templates.get("e2b", hash);

  if (cached?.template_id !== undefined) {
    return { backend: "e2b", hash, templateId: cached.template_id, cached: true };
  }

  const built = await buildTemplate({
    apiKey: input.apiKey,
    name: `poe-code-${hash.slice(0, 32)}`,
    dockerfilePath: input.dockerfilePath,
    buildContext: input.buildContext,
    cpu: input.runtime.cpu,
    memoryMb: input.runtime.memory_mb
  });

  await input.state?.templates.put("e2b", {
    hash,
    template_id: built.templateId,
    runtime_type: "e2b",
    dockerfile_path: input.dockerfilePath,
    built_at: new Date().toISOString()
  });

  return { backend: "e2b", hash, templateId: built.templateId, cached: false };
}

function hashTemplate(
  dockerfileBytes: Buffer,
  buildContextFiles: BuildContextFile[],
  buildArgs: Record<string, string>
): string {
  const hash = createHash("sha256");
  hash.update(dockerfileBytes);
  hash.update("\0");
  for (const file of buildContextFiles) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }
  for (const [key, value] of Object.entries(buildArgs).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    hash.update(key);
    hash.update("=");
    hash.update(value);
    hash.update("\0");
  }
  return hash.digest("hex");
}

interface BuildContextFile {
  relativePath: string;
  bytes: Buffer;
}

async function readBuildContextFiles(buildContext: string): Promise<BuildContextFile[]> {
  const files: BuildContextFile[] = [];
  await collectBuildContextFiles(buildContext, "", files);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function collectBuildContextFiles(
  buildContext: string,
  relativeDir: string,
  files: BuildContextFile[]
): Promise<void> {
  const absoluteDir = path.join(buildContext, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      await collectBuildContextFiles(buildContext, relativePath, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    files.push({
      relativePath: relativePath.split(path.sep).join("/"),
      bytes: await readFile(path.join(buildContext, relativePath))
    });
  }
}
