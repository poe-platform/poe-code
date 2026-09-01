import path from "node:path";
import { deepMergeDocuments, readDocument, writeScope } from "@poe-code/poe-code-config/core";
import { pathExists } from "@poe-code/config-mutations";
import { cancel as dsCancel, isCancel, select as dsSelect } from "toolcraft-design";
import { OperationCancelledError } from "../../errors.js";
import type { CliContainer } from "../../container.js";
import { hasOwnErrorCode } from "../../../utils/error-codes.js";

export const runtimeTypes = ["host", "docker"] as const;
export type RuntimeType = (typeof runtimeTypes)[number];

export const defaultRuntimeType: RuntimeType = "docker";
export const defaultDockerfile = [
  "FROM node:22-bookworm-slim",
  "",
  "RUN apt-get update \\",
  "  && apt-get install -y --no-install-recommends git ca-certificates \\",
  "  && rm -rf /var/lib/apt/lists/*",
  "",
  "RUN npm i -g poe-code",
  ""
].join("\n");

export function resolveDockerfilePath(container: CliContainer): string {
  return path.join(container.env.cwd, ".poe-code", "Dockerfile");
}

export async function resolveRuntimeType(input: {
  value?: string;
  assumeYes: boolean;
}): Promise<RuntimeType> {
  if (input.value !== undefined) {
    return parseRuntimeType(input.value);
  }

  if (input.assumeYes) {
    return defaultRuntimeType;
  }

  const result = await dsSelect<RuntimeType>({
    message: "Runtime backend",
    initialValue: defaultRuntimeType,
    options: [
      { value: "docker", label: "Docker", hint: "Build from .poe-code/Dockerfile" },
      { value: "host", label: "Host", hint: "Run commands on this machine" }
    ]
  });

  if (isCancel(result)) {
    dsCancel("Operation cancelled.");
    throw new OperationCancelledError();
  }

  return result;
}

export async function updateRuntimeScope(input: {
  container: CliContainer;
  type: RuntimeType;
}): Promise<void> {
  const document = await readDocument(input.container.fs, input.container.env.projectConfigPath);
  const merged = deepMergeDocuments(document, { runtime: { type: input.type } });
  await writeScope(
    input.container.fs,
    input.container.env.projectConfigPath,
    "runtime",
    merged.runtime ?? {}
  );
}

export async function writeDefaultDockerfileIfNeeded(input: {
  container: CliContainer;
  enabled: boolean;
}): Promise<boolean> {
  if (!input.enabled) {
    return false;
  }

  const dockerfilePath = resolveDockerfilePath(input.container);
  if (await pathExists(input.container.fs, dockerfilePath)) {
    return false;
  }

  await input.container.fs.mkdir(path.dirname(dockerfilePath), { recursive: true });
  try {
    await input.container.fs.writeFile(dockerfilePath, defaultDockerfile, {
      encoding: "utf8",
      flag: "wx"
    });
  } catch (error) {
    if (!isAlreadyExists(error)) {
      await input.container.fs.unlink(dockerfilePath).catch(() => undefined);
    }
    throw error;
  }
  return true;
}

export function parseRuntimeType(value: string): RuntimeType {
  if (runtimeTypes.includes(value as RuntimeType)) {
    return value as RuntimeType;
  }
  throw new Error(`Invalid runtime type "${value}". Expected host or docker.`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "EEXIST");
}
