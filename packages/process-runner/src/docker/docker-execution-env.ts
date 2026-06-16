import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDockerEnvArgs, buildDockerRunArgs } from "./args.js";
import { buildContextArgs, detectContext } from "./context.js";
import { detectEngine } from "./engine.js";
import { createDockerEnvFile } from "./env-file.js";
import { createHostRunner } from "../host/host-runner.js";
import {
  downloadWorkspace as downloadTransferredWorkspace,
  uploadWorkspace as uploadTransferredWorkspace,
  type WorkspaceTransferFileSystem,
  type WorkspaceTransferRunnerOptions
} from "../workspace-transfer.js";
import type {
  DockerMount,
  Engine,
  ExecutionState,
  ExecutionEnvFactory,
  OpenSpec,
  OpenedEnv,
  Runner,
  RunHandle,
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
  const workspaceTransferEnv = {
    cwd: input.spec.cwd,
    uploadDir: "/tmp/poe-workspace-transfer",
    workspaceDir: input.spec.cwd,
    remoteFs: createContainerWorkspaceFileSystem(input)
  };
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
      if (readRunnerSync(input.spec.runner) === "none") {
        return { files: 0, bytes: 0, skipped: [] };
      }
      return uploadTransferredWorkspace(workspaceTransferEnv, {
        runner: readWorkspaceTransferRunner(input.spec.runner),
        workspaceExclude: input.spec.uploadIgnoreFiles
      });
    },
    async downloadWorkspace(opts) {
      const sync = readRunnerSync(input.spec.runner);
      if (sync === "upload" || sync === "none") {
        return { files: 0, bytes: 0, conflicts: [] };
      }
      return downloadTransferredWorkspace(workspaceTransferEnv, opts);
    },
    exec(spec) {
      const envFile = createDockerEnvFile(spec.env);
      try {
        return cleanUpEnvFileAfterRun(input.runner.exec({
          command: input.engine,
          args: [
            ...buildContextArgs(input.engine, input.context),
            "exec",
            ...(spec.stdin === "pipe" || spec.stdin === "inherit" ? ["-i"] : []),
            ...(spec.tty === true ? ["-t"] : []),
            ...(spec.cwd !== undefined ? ["-w", spec.cwd] : []),
            ...buildDockerEnvArgs({ env: spec.env, envFilePath: envFile?.path }),
            containerRef,
            spec.command,
            ...(spec.args ?? [])
          ],
          stdin: spec.stdin,
          stdout: spec.stdout,
          stderr: spec.stderr,
          tty: spec.tty,
          signal: spec.signal,
          killProcessGroup: spec.killProcessGroup
        }), envFile?.cleanup);
      } catch (error) {
        envFile?.cleanup();
        throw error;
      }
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
        tty: true,
        signal: shellSpec?.signal
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
  const { dockerfilePath, buildContext } = await resolveRuntimeBuildPaths(input.cwd, input.runtime);
  const dockerfileBytes = await readFile(dockerfilePath);
  const buildContextFiles = await readBuildContextFiles(buildContext);
  const hash = hashDockerTemplate(
    dockerfileBytes,
    buildContextFiles,
    input.runtime.build_args ?? {},
    engine
  );
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

async function resolveRuntimeBuildPaths(
  cwd: string,
  runtime: DockerRuntime
): Promise<{ dockerfilePath: string; buildContext: string }> {
  const dockerfilePath = path.resolve(
    cwd,
    runtime.dockerfile ?? path.join(".poe-code", "Dockerfile")
  );
  const buildContext = path.resolve(cwd, runtime.build_context ?? ".");
  const canonicalCwd = await realpath(cwd);
  const canonicalDockerfilePath = await realpath(dockerfilePath);
  const canonicalBuildContext = await realpath(buildContext);

  assertRuntimePathInsideCwd(canonicalCwd, canonicalDockerfilePath, "runtime.dockerfile");
  assertRuntimePathInsideCwd(canonicalCwd, canonicalBuildContext, "runtime.build_context");

  return {
    dockerfilePath: canonicalDockerfilePath,
    buildContext: canonicalBuildContext
  };
}

function assertRuntimePathInsideCwd(cwd: string, targetPath: string, fieldName: string): void {
  if (!isPathInsideOrEqual(cwd, targetPath)) {
    throw new Error(`${fieldName} must remain inside runtime cwd ${cwd}.`);
  }
}

function isPathInsideOrEqual(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function hashDockerTemplate(
  dockerfileBytes: Buffer,
  buildContextFiles: BuildContextFile[],
  buildArgs: Record<string, string>,
  engine: Engine
): string {
  const hash = createHash("sha256");
  hash.update(dockerfileBytes);
  hash.update("\0");
  hash.update(engine);
  hash.update("\0");
  for (const file of buildContextFiles) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }
  for (const [key, value] of sortedBuildArgs(buildArgs)) {
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

async function runAndReadBytes(runner: Runner, spec: RunSpec): Promise<Buffer> {
  const handle = runner.exec(spec);
  const stdout = readStreamBytes(handle.stdout);
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

function cleanUpEnvFileAfterRun(handle: RunHandle, cleanup: (() => void) | undefined): RunHandle {
  if (cleanup === undefined) {
    return handle;
  }

  let cleanedUp = false;
  const cleanupOnce = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    try {
      cleanup();
    } catch {
      // Cleanup is best effort; preserve the command result.
    }
  };

  return {
    pid: handle.pid,
    stdin: handle.stdin,
    stdout: handle.stdout,
    stderr: handle.stderr,
    result: handle.result.finally(cleanupOnce),
    kill(signal) {
      handle.kill(signal);
    }
  };
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

async function readStreamBytes(stream: NodeJS.ReadableStream | null): Promise<Buffer> {
  if (stream === null) {
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

function sortedBuildArgs(buildArgs: Record<string, string>): Array<[string, string]> {
  return Object.entries(buildArgs).sort(([left], [right]) => left.localeCompare(right));
}

function createContainerName(): string {
  return `poe-env-${randomBytes(6).toString("hex")}`;
}

function readRunnerSync(runner: unknown): "both" | "upload" | "none" | undefined {
  if (typeof runner !== "object" || runner === null || !("sync" in runner)) {
    return undefined;
  }
  const sync = runner.sync;
  return sync === "both" || sync === "upload" || sync === "none" ? sync : undefined;
}

function readWorkspaceTransferRunner(runner: unknown): WorkspaceTransferRunnerOptions | undefined {
  if (typeof runner !== "object" || runner === null) {
    return undefined;
  }
  const record = runner as { upload_max_file_mb?: unknown; workspace?: unknown };
  const uploadMaxFileMb =
    typeof record.upload_max_file_mb === "number" ? record.upload_max_file_mb : undefined;
  const workspace =
    typeof record.workspace === "object" && record.workspace !== null
      && Array.isArray((record.workspace as { exclude?: unknown }).exclude)
      ? { exclude: (record.workspace as { exclude: unknown[] }).exclude.filter((value): value is string => typeof value === "string") }
      : undefined;
  return { ...(uploadMaxFileMb === undefined ? {} : { upload_max_file_mb: uploadMaxFileMb }), ...(workspace === undefined ? {} : { workspace }) };
}

function createContainerWorkspaceFileSystem(input: {
  id: string;
  runner: Runner;
  engine: Engine;
  context: string | null;
}): WorkspaceTransferFileSystem {
  const execShell = (command: string): Promise<string> => runAndRead(input.runner, {
    command: input.engine,
    args: [...buildContextArgs(input.engine, input.context), "exec", input.id, "sh", "-c", command],
    stdout: "pipe",
    stderr: "pipe"
  });
  async function readRemoteFile(targetPath: string): Promise<Buffer> {
    const tempDir = mkdtempSync(path.join(tmpdir(), "poe-docker-read-"));
    const destinationPath = path.join(tempDir, "content");
    try {
      await runOrThrow(input.runner, {
        command: input.engine,
        args: [...buildContextArgs(input.engine, input.context), "cp", `${input.id}:${targetPath}`, destinationPath],
        stdout: "pipe",
        stderr: "pipe"
      });
      return await readFile(destinationPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
  async function readFileFromContainer(targetPath: string): Promise<Buffer>;
  async function readFileFromContainer(targetPath: string, encoding: BufferEncoding): Promise<string>;
  async function readFileFromContainer(targetPath: string, encoding?: BufferEncoding): Promise<Buffer | string> {
    const contents = await readRemoteFile(targetPath);
    return encoding === undefined ? contents : contents.toString(encoding);
  }
  return {
    async mkdir(targetPath) {
      await execShell(`mkdir -p ${shellQuote(targetPath)}`);
    },
    async readdir(targetPath) {
      const quotedTargetPath = shellQuote(targetPath);
      const output = await execShell([
        `for item in ${quotedTargetPath}/* ${quotedTargetPath}/.[!.]* ${quotedTargetPath}/..?*; do`,
        `[ -e "$item" ] || [ -L "$item" ] || continue;`,
        `if [ -L "$item" ]; then kind=l; size=0;`,
        `elif [ -d "$item" ]; then kind=d; size=0;`,
        `elif [ -f "$item" ]; then kind=f; size=$(wc -c < "$item");`,
        `else continue; fi;`,
        `printf '%s\\t%s\\t%s\\n' "\${item##*/}" "$kind" "$size";`,
        `done`
      ].join(" "));
      return output.split("\n").filter(Boolean).map((line) => {
        const [name = "", kind = "f"] = line.split("\t");
        return {
          name,
          isFile: () => kind === "f",
          isDirectory: () => kind === "d",
          isSymbolicLink: () => kind === "l"
        };
      });
    },
    readFile: readFileFromContainer,
    async writeFile(targetPath, data) {
      const tempDir = mkdtempSync(path.join(tmpdir(), "poe-docker-write-"));
      const sourcePath = path.join(tempDir, "content");
      try {
        await writeFile(sourcePath, data);
        await runOrThrow(input.runner, {
          command: input.engine,
          args: [...buildContextArgs(input.engine, input.context), "cp", sourcePath, `${input.id}:${targetPath}`],
          stdout: "pipe",
          stderr: "pipe"
        });
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
    async stat(targetPath) {
      const output = await execShell(`if [ -d ${shellQuote(targetPath)} ]; then printf 'd\\t0'; elif [ -f ${shellQuote(targetPath)} ]; then printf 'f\\t'; wc -c < ${shellQuote(targetPath)}; else printf 'missing'; fi`);
      if (output.trim() === "missing") {
        throw Object.assign(new Error(`ENOENT: ${targetPath}`), { code: "ENOENT" });
      }
      const [kind = "f", rawSize = "0"] = output.trim().split("\t");
      return { size: Number(rawSize.trim()), isFile: () => kind === "f", isDirectory: () => kind === "d" };
    },
    async rename(oldPath, newPath) {
      await execShell(`mv ${shellQuote(oldPath)} ${shellQuote(newPath)}`);
    },
    async rm(targetPath) {
      await execShell(`rm -rf ${shellQuote(targetPath)}`);
    }
  };
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
    async *stream(opts?: { sinceByte?: number; since?: Date; follow?: boolean }) {
      const logFile = shellQuote(`/tmp/poe-jobs/${jobId}.log`);
      const sinceCondition =
        opts?.since === undefined
          ? ""
          : ` && test $(stat -c %Y ${logFile} 2>/dev/null || stat -f %m ${logFile}) -ge ${Math.ceil(
              opts.since.getTime() / 1000
            )}`;
      let byteOffset = opts?.sinceByte ?? 0;
      let pendingBytes: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let pendingByteOffset = byteOffset;
      while (true) {
        const stdout = await runAndReadBytes(runner, {
          command: engine,
          args: [
            ...buildContextArgs(engine, context),
            "exec",
            containerId,
            "sh",
            "-c",
            `test -f ${logFile}${sinceCondition} && tail -c +${byteOffset + 1} ${logFile} || true`
          ],
          stdout: "pipe",
          stderr: "pipe"
        });
        if (stdout.byteLength > 0) {
          const combined = pendingBytes.byteLength === 0
            ? stdout
            : Buffer.concat([pendingBytes, stdout]);
          const completeLength = completeUtf8PrefixLength(combined);
          byteOffset += stdout.byteLength;
          pendingBytes = combined.subarray(completeLength);
          const data = combined.subarray(0, completeLength).toString("utf8");
          if (data.length > 0) {
            yield { byteOffset: pendingByteOffset, data };
            pendingByteOffset += completeLength;
          }
        }
        if (opts?.follow !== true || (await this.status()) !== "running") {
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
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
      return { exitCode: parseDockerWaitExitCode(stdout, result.exitCode) };
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

function parseDockerWaitExitCode(stdout: string, fallbackExitCode: number): number {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return fallbackExitCode;
  }
  return parseCompleteDecimalExitCode(trimmed, "docker wait");
}

function parseCompleteDecimalExitCode(value: string, source: string): number {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) {
      throw new Error(`${source} returned an invalid exit code: ${JSON.stringify(value)}.`);
    }
  }

  const exitCode = Number(value);
  if (!Number.isSafeInteger(exitCode)) {
    throw new Error(`${source} returned an invalid exit code: ${JSON.stringify(value)}.`);
  }
  return exitCode;
}

function completeUtf8PrefixLength(contents: Buffer): number {
  if (contents.length === 0) {
    return 0;
  }

  let leadIndex = contents.length - 1;
  while (leadIndex >= 0 && isUtf8ContinuationByte(contents[leadIndex]!)) {
    leadIndex -= 1;
  }

  if (leadIndex < 0) {
    return contents.length;
  }

  const expectedLength = utf8SequenceLength(contents[leadIndex]!);
  if (expectedLength === 0) {
    return contents.length;
  }

  const availableLength = contents.length - leadIndex;
  return availableLength < expectedLength ? leadIndex : contents.length;
}

function isUtf8ContinuationByte(byte: number): boolean {
  return byte >= 0x80 && byte <= 0xbf;
}

function utf8SequenceLength(byte: number): number {
  if (byte >= 0xc2 && byte <= 0xdf) {
    return 2;
  }
  if (byte >= 0xe0 && byte <= 0xef) {
    return 3;
  }
  if (byte >= 0xf0 && byte <= 0xf4) {
    return 4;
  }
  return 0;
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
