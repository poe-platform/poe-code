import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDockerRunArgs } from "./args.js";
import { buildContextArgs, detectContext } from "./context.js";
import { detectEngine } from "./engine.js";
import { createHostRunner } from "../host/host-runner.js";
import type {
  DockerMount,
  Engine,
  ExecutionState,
  ExecutionEnvFactory,
  OpenSpec,
  OpenedEnv,
  Runner,
  RunSpec
} from "../types.js";

interface DockerRuntime {
  type: "docker";
  image?: string;
  dockerfile?: string;
  build_context?: string;
  build_args?: Record<string, string>;
  mounts?: DockerMount[];
  engine?: Engine;
  network?: string;
  extra_args?: string[];
}

export interface BuildDockerRuntimeTemplateInput {
  cwd: string;
  runtime: DockerRuntime;
  state?: ExecutionState;
  runner?: Runner;
  force?: boolean;
}

export interface BuildDockerRuntimeTemplateResult {
  backend: "docker";
  hash: string;
  image: string;
  cached: boolean;
}

const containerCommand = ["sh", "-c", "while :; do sleep 3600; done"] as const;

export const dockerExecutionEnvFactory: ExecutionEnvFactory = {
  type: "docker",
  supportsDetach: true,
  async open(spec): Promise<OpenedEnv> {
    const runtime = parseDockerRuntime(spec.runtime);
    const runner = spec.hostRunner ?? createHostRunner();
    const engine = runtime.engine ?? detectEngine();
    const context = detectContext();
    const image = await resolveImage({
      spec,
      runtime,
      runner,
      engine,
      context
    });
    const containerName = createContainerName();
    const runArgs = buildDockerRunArgs({
      engine,
      context,
      image,
      command: containerCommand[0],
      args: containerCommand.slice(1),
      cwd: undefined,
      env: undefined,
      mounts: runtime.mounts ?? [],
      ports: [],
      network: runtime.network,
      containerName,
      detached: true,
      interactive: true,
      tty: false,
      rm: false,
      extraArgs: runtime.extra_args ?? []
    });
    const [command, ...args] = runArgs;
    const id = (await runAndRead(runner, { command, args, stdout: "pipe", stderr: "pipe" })).trim();

    return createDockerEnv({
      id,
      spec,
      runner,
      engine,
      context
    });
  },
  async attach(envId): Promise<OpenedEnv> {
    const engine = detectEngine();
    return createDockerEnv({
      id: envId,
      spec: createAttachedSpec(),
      runner: createHostRunner(),
      engine,
      context: detectContext()
    });
  }
};

function createDockerEnv(input: {
  id: string;
  spec: OpenSpec;
  runner: Runner;
  engine: Engine;
  context: string | null;
}): OpenedEnv {
  const containerRef = input.id;

  return {
    id: containerRef,
    job: null,
    async uploadWorkspace() {
      const tempDir = mkdtempSync(path.join(tmpdir(), "poe-docker-upload-"));
      const archivePath = path.join(tempDir, "workspace.tar");
      try {
        const excludeArgs = input.spec.uploadIgnoreFiles.flatMap((ignored) => [
          "--exclude",
          ignored
        ]);
        const tarArgs = [...excludeArgs, "-cf", archivePath, "-C", input.spec.cwd, "."];
        await runOrThrow(input.runner, {
          command: "tar",
          args: tarArgs,
          stdout: "pipe",
          stderr: "pipe"
        });
        await runOrThrow(input.runner, {
          command: input.engine,
          args: [
            ...buildContextArgs(input.engine, input.context),
            "cp",
            archivePath,
            `${containerRef}:/tmp/poe-workspace-upload.tar`
          ],
          stdout: "pipe",
          stderr: "pipe"
        });
        await runOrThrow(input.runner, {
          command: input.engine,
          args: [
            ...buildContextArgs(input.engine, input.context),
            "exec",
            containerRef,
            "sh",
            "-c",
            `mkdir -p ${shellQuote(input.spec.cwd)} && tar -xf /tmp/poe-workspace-upload.tar -C ${shellQuote(input.spec.cwd)}`
          ],
          stdout: "pipe",
          stderr: "pipe"
        });

        return { files: 0, bytes: 0, skipped: [] };
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
    async downloadWorkspace(opts) {
      const tempDir = mkdtempSync(path.join(tmpdir(), "poe-docker-download-"));
      const archivePath = path.join(tempDir, "workspace.tar");
      try {
        await runOrThrow(input.runner, {
          command: input.engine,
          args: [
            ...buildContextArgs(input.engine, input.context),
            "exec",
            containerRef,
            "sh",
            "-c",
            `tar -cf /tmp/poe-workspace-download.tar -C ${shellQuote(input.spec.cwd)} .`
          ],
          stdout: "pipe",
          stderr: "pipe"
        });
        await runOrThrow(input.runner, {
          command: input.engine,
          args: [
            ...buildContextArgs(input.engine, input.context),
            "cp",
            `${containerRef}:/tmp/poe-workspace-download.tar`,
            archivePath
          ],
          stdout: "pipe",
          stderr: "pipe"
        });
        const extractMode = opts.conflictPolicy === "refuse" ? "-xkf" : "-xf";
        await runOrThrow(input.runner, {
          command: "tar",
          args: [extractMode, archivePath, "-C", input.spec.cwd],
          stdout: "pipe",
          stderr: "pipe"
        });

        return { files: 0, bytes: 0, conflicts: [] };
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
    exec(spec) {
      return input.runner.exec({
        command: input.engine,
        args: [
          ...buildContextArgs(input.engine, input.context),
          "exec",
          ...(spec.stdin === "pipe" || spec.stdin === "inherit" ? ["-i"] : []),
          ...(spec.tty === true ? ["-t"] : []),
          ...(spec.cwd !== undefined ? ["-w", spec.cwd] : []),
          ...buildEnvArgs(spec.env),
          containerRef,
          spec.command,
          ...(spec.args ?? [])
        ],
        stdin: spec.stdin,
        stdout: spec.stdout,
        stderr: spec.stderr,
        tty: spec.tty
      });
    },
    async detach() {
      return createContainerJob(containerRef, input.runner, input.engine, input.context);
    },
    shell() {
      const shellSpec = input.spec.shellSpec;
      return this.exec({
        command: shellSpec?.command ?? input.spec.env.SHELL ?? "sh",
        ...(shellSpec?.args ? { args: shellSpec.args } : {}),
        cwd: input.spec.cwd,
        env: shellSpec && "env" in shellSpec ? shellSpec.env : input.spec.env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        tty: true
      });
    },
    async close() {
      await runOrThrow(input.runner, {
        command: input.engine,
        args: [...buildContextArgs(input.engine, input.context), "rm", "-f", containerRef],
        stdout: "pipe",
        stderr: "pipe"
      });
    }
  };
}

async function resolveImage(input: {
  spec: OpenSpec;
  runtime: DockerRuntime;
  runner: Runner;
  engine: Engine;
  context: string | null;
}): Promise<string> {
  if (input.runtime.image !== undefined) {
    return input.runtime.image;
  }

  const result = await buildDockerRuntimeTemplate({
    cwd: input.spec.cwd,
    runtime: input.runtime,
    state: input.spec.state,
    runner: input.runner
  });
  return result.image;
}

export async function buildDockerRuntimeTemplate(
  input: BuildDockerRuntimeTemplateInput
): Promise<BuildDockerRuntimeTemplateResult> {
  const runner = input.runner ?? createHostRunner();
  const engine = input.runtime.engine ?? detectEngine();
  const context = detectContext();
  const dockerfilePath = path.resolve(
    input.cwd,
    input.runtime.dockerfile ?? path.join(".poe-code", "Dockerfile")
  );
  const buildContext = path.resolve(input.cwd, input.runtime.build_context ?? ".");
  const dockerfileBytes = await readFile(dockerfilePath);
  const hash = hashDockerTemplate(dockerfileBytes, input.runtime.build_args ?? {});
  const cached = input.force ? null : await input.state?.templates.get("docker", hash);

  if (cached?.image !== undefined) {
    return {
      backend: "docker",
      hash,
      image: cached.image,
      cached: true
    };
  }

  const image = `poe-code/local:${hash}`;
  await buildImage({
    runner,
    engine,
    context,
    image,
    dockerfilePath,
    buildContext,
    buildArgs: input.runtime.build_args ?? {}
  });
  await input.state?.templates.put("docker", {
    hash,
    image,
    runtime_type: "docker",
    dockerfile_path: dockerfilePath,
    built_at: new Date().toISOString()
  });

  return {
    backend: "docker",
    hash,
    image,
    cached: false
  };
}

function hashDockerTemplate(dockerfileBytes: Buffer, buildArgs: Record<string, string>): string {
  const hash = createHash("sha256");
  hash.update(dockerfileBytes);
  hash.update("\0");
  for (const [key, value] of sortedBuildArgs(buildArgs)) {
    hash.update(key);
    hash.update("=");
    hash.update(value);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function buildImage(input: {
  runner: Runner;
  engine: Engine;
  context: string | null;
  image: string;
  dockerfilePath: string;
  buildContext: string;
  buildArgs: Record<string, string>;
}): Promise<void> {
  await runOrThrow(input.runner, {
    command: input.engine,
    args: [
      ...buildContextArgs(input.engine, input.context),
      "build",
      "--tag",
      input.image,
      "-f",
      input.dockerfilePath,
      ...sortedBuildArgs(input.buildArgs).flatMap(([key, value]) => [
        "--build-arg",
        `${key}=${value}`
      ]),
      input.buildContext
    ],
    stdout: "pipe",
    stderr: "pipe"
  });
}

function parseDockerRuntime(runtime: unknown): DockerRuntime {
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw new Error("docker runtime must be an object");
  }
  const record = runtime as Record<string, unknown>;
  if (record.type !== "docker") {
    throw new Error('docker runtime type must be "docker"');
  }
  return record as unknown as DockerRuntime;
}

async function runAndRead(runner: Runner, spec: RunSpec): Promise<string> {
  const handle = runner.exec(spec);
  const stdout = readStream(handle.stdout);
  const stderr = readStream(handle.stderr);
  const result = await handle.result;
  const output = await stdout;
  if (result.exitCode !== 0) {
    const errorOutput = await stderr;
    throw new Error(
      `Command failed with exit code ${result.exitCode}: ${spec.command} ${(spec.args ?? []).join(" ")}${errorOutput ? `\n${errorOutput}` : ""}`
    );
  }
  return output;
}

async function runOrThrow(runner: Runner, spec: RunSpec): Promise<void> {
  await runAndRead(runner, spec);
}

async function readStream(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (stream === null) {
    return "";
  }

  stream.setEncoding("utf8");
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(String(chunk));
  }
  return chunks.join("");
}

function sortedBuildArgs(buildArgs: Record<string, string>): Array<[string, string]> {
  return Object.entries(buildArgs).sort(([left], [right]) => left.localeCompare(right));
}

function buildEnvArgs(env: RunSpec["env"]): string[] {
  if (env === undefined) {
    return [];
  }

  return Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
}

function createContainerName(): string {
  return `poe-env-${randomBytes(6).toString("hex")}`;
}

async function createContainerJob(
  containerId: string,
  runner: Runner,
  engine: Engine,
  context: string | null
) {
  return {
    id: containerId,
    envId: containerId,
    tool: "docker",
    argv: ["attach", containerId],
    async status() {
      const handle = runner.exec({
        command: engine,
        args: [
          ...buildContextArgs(engine, context),
          "inspect",
          "-f",
          "{{.State.Status}}",
          containerId
        ],
        stdout: "pipe",
        stderr: "pipe"
      });
      const stdout = await readStream(handle.stdout);
      const result = await handle.result;
      if (result.exitCode !== 0) {
        return "lost" as const;
      }
      return stdout.trim() === "running" ? ("running" as const) : ("exited" as const);
    },
    async *stream() {},
    async wait() {
      const handle = runner.exec({
        command: engine,
        args: [...buildContextArgs(engine, context), "wait", containerId],
        stdout: "pipe",
        stderr: "pipe"
      });
      const stdout = await readStream(handle.stdout);
      const result = await handle.result;
      return { exitCode: Number.parseInt(stdout.trim(), 10) || result.exitCode };
    },
    async kill(signal?: NodeJS.Signals) {
      const args =
        signal === undefined || signal === "SIGTERM"
          ? ["stop", containerId]
          : ["kill", ...(signal === "SIGKILL" ? [] : [`--signal=${signal}`]), containerId];
      await runOrThrow(runner, {
        command: engine,
        args: [...buildContextArgs(engine, context), ...args],
        stdout: "pipe",
        stderr: "pipe"
      });
    }
  };
}

function createAttachedSpec(): OpenSpec {
  return {
    cwd: "/workspace",
    runtime: {
      type: "docker",
      image: "attached",
      build_args: {},
      mounts: []
    },
    env: {},
    uploadIgnoreFiles: [],
    jobLabel: {
      tool: "docker",
      argv: []
    }
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
