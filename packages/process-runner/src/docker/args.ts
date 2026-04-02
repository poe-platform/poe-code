import path from "node:path";
import type { DockerRunArgs } from "../types.js";

export function buildDockerRunArgs(input: DockerRunArgs): string[] {
  const args: string[] = [input.engine];

  if (input.engine === "docker" && input.context !== null) {
    args.push("--context", input.context);
  }

  args.push("run");

  if (input.rm) {
    args.push("--rm");
  }

  if (input.detached) {
    args.push("-d");
  }

  if (input.interactive) {
    args.push("-i");
  }

  if (input.tty) {
    args.push("-t");
  }

  args.push("--name", input.containerName);

  if (input.cwd !== undefined) {
    args.push("-w", input.cwd);
  }

  for (const [key, value] of Object.entries(input.env ?? {})) {
    args.push("-e", `${key}=${value}`);
  }

  for (const mount of input.mounts) {
    const volume = `${path.resolve(mount.source)}:${mount.target}${mount.readonly ? ":ro" : ""}`;
    args.push("-v", volume);
  }

  for (const port of input.ports) {
    const mapping = `${port.host}:${port.container}${port.protocol === undefined || port.protocol === "tcp" ? "" : `/${port.protocol}`}`;
    args.push("-p", mapping);
  }

  if (input.network !== undefined) {
    args.push("--network", input.network);
  }

  args.push(...input.extraArgs, input.image, input.command, ...input.args);

  return args;
}
