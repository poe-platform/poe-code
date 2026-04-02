import { execSync } from "node:child_process";
import type { Engine } from "../types.js";

export function detectEngine(): Engine {
  if (isEngineAvailable("docker")) {
    return "docker";
  }

  if (isEngineAvailable("podman")) {
    return "podman";
  }

  throw new Error(
    "No container engine found. Please install Docker or Podman:\n" +
      "  - Docker Desktop: https://www.docker.com/products/docker-desktop\n" +
      "  - Colima (macOS): brew install colima && colima start\n" +
      "  - Podman: https://podman.io/docs/installation"
  );
}

export function isEngineAvailable(engine: Engine): boolean {
  try {
    execSync(`${engine} --version`, {
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}
