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

interface DetachedJobContext {
  id: string;
  tool: string;
  argv: string[];
}

interface DockerOpenedEnv extends OpenedEnv {
  setDetachedJobContext(context: DetachedJobContext): void;
}

interface DockerReattachContext {
  engine: Engine;
  context: string | null;
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
  async attach(envId, context): Promise<OpenedEnv> {
    const reattachContext = parseDockerReattachContext(context?.reattachContext);
    const engine = reattachContext?.engine ?? detectEngine();
    return createDockerEnv({
      id: envId,
      spec: createAttachedSpec(context?.cwd),
      runner: createHostRunner(),
      engine,
      context: reattachContext === undefined ? detectContext() : reattachContext.context,
      attachedJobId: context?.jobId
    });
  }
};

function createDockerEnv(input: {
  id: string;
  spec: OpenSpec;
  runner: Runner;
  engine: Engine;
  context: string | null;
  attachedJobId?: string;
}): DockerOpenedEnv {
  const containerRef = input.id;
  let detachedJobContext: DetachedJobContext | null =
    input.attachedJobId === undefined
      ? null
      : { id: input.attachedJobId, tool: input.spec.jobLabel.tool, argv: input.spec.jobLabel.argv };

  return {
    id: containerRef,
    reattachContext: { engine: input.engine, context: input.context },
    job:
      input.attachedJobId === undefined
        ? null
        : createContainerJob(
            containerRef,
            input.runner,
            input.engine,
            input.context,
            detachedJobContext
          ),
    setDetachedJobContext(context) {
      detachedJobContext = context;
    },
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
        tty: spec.tty,
        signal: spec.signal
      });
    },
    async detach() {
      return createContainerJob(
        containerRef,
        input.runner,
        input.engine,
        input.context,
        detachedJobContext
      );
    },
    shell() {
      const shellSpec = input.spec.shellSpec;
      return this.exec({
        command: shellSpec?.command ?? input.spec.env.SHELL ?? "sh",
        ...(shellSpec?.args ? { args: shellSpec.args } : {}),
        cwd: shellSpec?.cwd ?? input.spec.cwd,
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

function parseDockerReattachContext(
  value: Record<string, unknown> | undefined
): DockerReattachContext | undefined {
  if (
    value !== undefined &&
    (value.engine === "docker" || value.engine === "podman") &&
    (value.context === null || typeof value.context === "string")
  ) {
    return { engine: value.engine, context: value.context };
  }

  return undefined;
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
  const hash = hashDockerTemplate(dockerfileBytes, input.runtime.build_args ?? {}, engine);
  const cached = input.force ? null : await input.state?.templates.get("docker", hash);

  if (cached?.image !== undefined && (await imageExists(runner, engine, context, cached.image))) {
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

function hashDockerTemplate(
  dockerfileBytes: Buffer,
  buildArgs: Record<string, string>,
  engine: Engine
): string {
  const hash = createHash("sha256");
  hash.update(dockerfileBytes);
  hash.update("\0");
  hash.update(engine);
  hash.update("\0");
  for (const [key, value] of sortedBuildArgs(buildArgs)) {
    hash.update(key);
    hash.update("=");
    hash.update(value);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function imageExists(
  runner: Runner,
  engine: Engine,
  context: string | null,
  image: string
): Promise<boolean> {
  const handle = runner.exec({
    command: engine,
    args: [...buildContextArgs(engine, context), "image", "inspect", image],
    stdout: "pipe",
    stderr: "pipe"
  });
  const result = await handle.result;
  return result.exitCode === 0;
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

function createContainerJob(
  containerId: string,
  runner: Runner,
  engine: Engine,
  context: string | null,
  detachedJobContext: DetachedJobContext | null = null
) {
  const jobId = detachedJobContext?.id ?? containerId;
  return {
    id: jobId,
    envId: containerId,
    tool: detachedJobContext?.tool ?? "docker",
    argv: detachedJobContext?.argv ?? ["attach", containerId],
    async status() {
      if (detachedJobContext !== null) {
        const exitCode = await readDetachedExitCode(containerId, jobId, runner, engine, context);
        return exitCode === null ? ("running" as const) : ("exited" as const);
      }

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
      return stdout.trim() === "exited" ? ("exited" as const) : ("running" as const);
    },
    async *stream(opts?: { sinceByte?: number; since?: Date }) {
      const logFile = shellQuote(`/tmp/poe-jobs/${jobId}.log`);
      const sinceCondition =
        opts?.since === undefined
          ? ""
          : ` && test $(stat -c %Y ${logFile} 2>/dev/null || stat -f %m ${logFile}) -ge ${Math.ceil(
              opts.since.getTime() / 1000
            )}`;
      const stdout = await runAndRead(runner, {
        command: engine,
        args: [
          ...buildContextArgs(engine, context),
          "exec",
          containerId,
          "sh",
          "-c",
          `test -f ${logFile}${sinceCondition} && tail -c +${(opts?.sinceByte ?? 0) + 1} ${logFile} || true`
        ],
        stdout: "pipe",
        stderr: "pipe"
      });
      if (stdout.length > 0) {
        yield { byteOffset: opts?.sinceByte ?? 0, data: stdout };
      }
    },
    async wait() {
      if (detachedJobContext !== null) {
        while (true) {
          const exitCode = await readDetachedExitCode(containerId, jobId, runner, engine, context);
          if (exitCode !== null) {
            return { exitCode };
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 25));
        }
      }

      const handle = runner.exec({
        command: engine,
        args: [...buildContextArgs(engine, context), "wait", containerId],
        stdout: "pipe",
        stderr: "pipe"
      });
      const stdout = await readStream(handle.stdout);
      const result = await handle.result;
      const exitCode = Number.parseInt(stdout.trim(), 10);
      return { exitCode: Number.isNaN(exitCode) ? result.exitCode : exitCode };
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

async function readDetachedExitCode(
  containerId: string,
  jobId: string,
  runner: Runner,
  engine: Engine,
  context: string | null
): Promise<number | null> {
  const exitFile = shellQuote(`/tmp/poe-jobs/${jobId}.exit`);
  const handle = runner.exec({
    command: engine,
    args: [
      ...buildContextArgs(engine, context),
      "exec",
      containerId,
      "sh",
      "-c",
      `test -f ${exitFile} && cat ${exitFile} || true`
    ],
    stdout: "pipe",
    stderr: "pipe"
  });
  const stdout = await readStream(handle.stdout);
  const result = await handle.result;
  if (result.exitCode !== 0) {
    return null;
  }
  const exitCode = Number.parseInt(stdout.trim(), 10);
  return Number.isNaN(exitCode) ? null : exitCode;
}

function createAttachedSpec(cwd = "/workspace"): OpenSpec {
  return {
    cwd,
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
