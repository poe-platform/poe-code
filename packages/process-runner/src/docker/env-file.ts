import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface DockerEnvFile {
  path: string;
  cleanup(): void;
}

export function createDockerEnvFile(env: Record<string, string> | undefined): DockerEnvFile | null {
  const entries = Object.entries(env ?? {});
  if (entries.length === 0) {
    return null;
  }

  const directory = mkdtempSync(path.join(tmpdir(), "poe-docker-env-"));
  const filePath = path.join(directory, "env");
  let active = true;

  try {
    writeFileSync(filePath, serializeDockerEnvFile(entries), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }

  return {
    path: filePath,
    cleanup() {
      if (!active) {
        return;
      }

      active = false;
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

export function serializeDockerEnvFile(entries: Array<[string, string]>): string {
  return (
    entries.map(([key, value]) => `${formatDockerEnvKey(key)}=${formatDockerEnvValue(value)}`).join("\n") +
    "\n"
  );
}

function formatDockerEnvKey(key: string): string {
  if (key.length === 0 || key.includes("=") || key.includes("\n") || key.includes("\r")) {
    throw new Error(`Invalid Docker environment variable name: ${JSON.stringify(key)}`);
  }

  return key;
}

function formatDockerEnvValue(value: string): string {
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error("Docker env-file values cannot contain newline characters.");
  }

  return value;
}
