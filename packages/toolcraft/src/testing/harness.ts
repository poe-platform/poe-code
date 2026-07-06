import type { HumanInLoopProvider } from "@poe-code/agent-human-in-loop";
import type { Task, TaskList, Tasks } from "@poe-code/task-list";
import { stripAnsi } from "toolcraft-design";
import type { ObjectSchema } from "toolcraft-schema";
import {
  ApprovalDeclinedError,
  ToolcraftBugError,
  UserError,
  assertCommandRequirements,
  resolveCommandSecrets,
  type Command,
  type Group,
  type HandlerFs,
  type HumanInLoopPending,
  type SecretDeclarations
} from "../index.js";
import { approvalStateMachine } from "../human-in-loop/state-machine.js";
import { invokeWithHumanInLoop } from "../human-in-loop/gate.js";
import { createRuntimeLogger, type DiagnosticLogEvent, type LogLevel } from "../runtime-logging.js";
import { createEnv, createFs, validateServices } from "../runtime/io.js";
import { filterSchemaForScope } from "../schema-scope.js";
import { validateObjectSchema } from "../sdk.js";
import { throwValidationErrors, type ValidationError } from "../validation-errors.js";
import { fakeFetch, type FetchRoute } from "./fakes.js";
import { createMemoryFs, type FsChange, type MemoryFs } from "./memory-fs.js";
import { runParity, type ParityResult } from "./parity.js";
import { createRenderCapture } from "./render-capture.js";
import { createManagedStream, type StreamStatusEvent } from "../stream.js";

export type PipelineStage =
  | "resolve"
  | "secrets"
  | "requirements"
  | "params"
  | "confirm"
  | "handler"
  | "render";

export type EffectEvent =
  | { seq: number; kind: "fetch"; method: string; url: string }
  | { seq: number; kind: "fs"; op: "writeFile" | "rename" | "unlink"; path: string }
  | { seq: number; kind: "service"; service: string; method: string; args: unknown[] }
  | { seq: number; kind: "env"; key: string }
  | { seq: number; kind: "progress"; message: string }
  | { seq: number; kind: "confirm"; message: string; approved: boolean };

type UnsequencedEffectEvent = EffectEvent extends infer TEvent
  ? TEvent extends { seq: number }
    ? Omit<TEvent, "seq">
    : never
  : never;

export interface ConfirmationRequest {
  message: string;
  declineInputPrompt?: string;
}

export interface HarnessOptions<TServices extends object> {
  services?: TServices;
  env?: Record<string, string | undefined>;
  secrets?: Record<string, string>;
  fs?: Record<string, string> | HandlerFs;
  fetch?: typeof globalThis.fetch | FetchRoute[];
  confirmations?:
    | "approve"
    | "decline"
    | ((request: ConfirmationRequest) => boolean | Promise<boolean>);
  apiVersion?: string;
  logLevel?: LogLevel;
}

export interface RunResult<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
  failedAt?: PipelineStage;
  pending: boolean;
  logs: DiagnosticLogEvent[];
  progress: string[];
  confirmations: ConfirmationRequest[];
  timeline: EffectEvent[];
  fsChanges: FsChange[];
  rendered: {
    rich?: string;
    markdown?: string;
    json?: unknown;
  };
}

export interface CommandTestHarness {
  run<T>(path: string[], params?: Record<string, unknown>): Promise<RunResult<T>>;
  stream<T>(
    path: string[],
    params?: Record<string, unknown>,
    options?: { limit?: number; signal?: AbortSignal }
  ): Promise<StreamRunResult<T>>;
  parity(path: string[], params?: Record<string, unknown>): Promise<ParityResult>;
  fs: MemoryFs;
  timeline: EffectEvent[];
}

export interface StreamRunResult<T> {
  ok: boolean;
  events: T[];
  statuses: StreamStatusEvent[];
  error?: unknown;
}

interface ResolvedCommand {
  command: Command<any, any, any, any>;
  path: string[];
}

type EmptyHarnessServices = Record<string, never>;

function isHandlerFs(value: Record<string, string> | HandlerFs): value is HandlerFs {
  return typeof (value as HandlerFs).readFile === "function";
}

function asMemoryFs(value: Record<string, string> | HandlerFs | undefined): MemoryFs {
  if (value === undefined || !isHandlerFs(value)) {
    return createMemoryFs(value);
  }
  if ("snapshot" in value && "changes" in value) {
    return value as MemoryFs;
  }

  const handlerFs = createFs(value);
  const changes: FsChange[] = [];
  return {
    readFile: (path, encoding) => handlerFs.readFile(path, encoding),
    exists: (path) => handlerFs.exists(path),
    lstat: (path) => handlerFs.lstat(path),
    async writeFile(path, contents, options) {
      await handlerFs.writeFile(path, contents, options);
      changes.push({ op: "writeFile", path });
    },
    async rename(fromPath, toPath) {
      await handlerFs.rename(fromPath, toPath);
      changes.push({ op: "rename", path: fromPath, to: toPath });
    },
    async unlink(path) {
      await handlerFs.unlink(path);
      changes.push({ op: "unlink", path });
    },
    snapshot: () => ({}),
    changes: () => changes.map((change) => ({ ...change }))
  };
}

function hasOwnMcpProxyConfig(group: Group<any>): boolean {
  const symbol = Object.getOwnPropertySymbols(group).find(
    (candidate) => candidate.description === "toolcraft.group.config"
  );
  if (symbol === undefined) {
    return false;
  }
  const config = (group as unknown as Record<PropertyKey, { mcp?: unknown }>)[symbol];
  return config?.mcp !== undefined;
}

function findChild(group: Group<any>, segment: string) {
  return group.children.find((child) => child.name === segment || child.aliases.includes(segment));
}

function resolveCommand(root: Group<any>, requestedPath: string[]): ResolvedCommand {
  const path = requestedPath[0] === root.name ? requestedPath.slice(1) : requestedPath;
  let group = root;
  const canonicalPath: string[] = [];

  for (let index = 0; index < path.length; index += 1) {
    if (hasOwnMcpProxyConfig(group)) {
      throw new UserError(`Commands under MCP proxy group "${group.name}" need a live server.`);
    }

    const segment = path[index]!;
    const child = findChild(group, segment);
    if (child === undefined) {
      throw new UserError(`Unknown command path "${requestedPath.join(" ")}".`);
    }
    canonicalPath.push(child.name);

    if (child.kind === "command") {
      if (index !== path.length - 1) {
        throw new UserError(`Command "${canonicalPath.join(" ")}" has no child commands.`);
      }
      return { command: child, path: canonicalPath };
    }

    group = child;
  }

  if (hasOwnMcpProxyConfig(group)) {
    throw new UserError(`Commands under MCP proxy group "${group.name}" need a live server.`);
  }
  if (group.default !== undefined) {
    return { command: group.default, path: [...canonicalPath, group.default.name] };
  }
  throw new UserError(`Command path "${requestedPath.join(" ")}" resolves to a group.`);
}

function createSealedEnv(
  declarations: SecretDeclarations,
  env: Record<string, string | undefined> | undefined,
  secrets: Record<string, string> | undefined
): Readonly<Record<string, string | undefined>> {
  const values: Record<string, string | undefined> = { ...(env ?? {}) };
  for (const [name, value] of Object.entries(secrets ?? {})) {
    const definition = declarations[name];
    if (definition !== undefined) {
      values[definition.env] = value;
    }
  }
  return Object.freeze(values);
}

function isHumanInLoopPending(value: unknown): value is HumanInLoopPending {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { status?: unknown }).status === "pending-approval"
  );
}

function createTaskList(): TaskList {
  const tasksById = new Map<string, Task>();
  const tasks: Tasks = {
    name: "approvals",
    stateMachine: approvalStateMachine,
    async all() {
      return [...tasksById.values()];
    },
    async get(id) {
      const task = tasksById.get(id);
      if (task === undefined) {
        throw new Error(`Unknown task ${id}`);
      }
      return task;
    },
    async create(input) {
      const id = input.id ?? String(tasksById.size + 1);
      const task: Task = {
        list: "approvals",
        id,
        qualifiedId: `approvals:${id}`,
        name: input.name,
        state: approvalStateMachine.initial,
        description: input.description ?? "",
        metadata: input.metadata ?? {}
      };
      tasksById.set(id, task);
      return task;
    },
    async update(id, patch) {
      const task = await tasks.get(id);
      Object.assign(task, patch);
      return task;
    },
    async fire(id) {
      return tasks.get(id);
    },
    async canFire() {
      return false;
    },
    async events() {
      return [];
    },
    async delete(id) {
      tasksById.delete(id);
    },
    async move(id) {
      return tasks.get(id);
    },
    async reorder(ids) {
      return Promise.all(ids.map((id) => tasks.get(id)));
    }
  };
  return {
    list: () => tasks,
    async lists() {
      return ["approvals"];
    },
    async allTasks() {
      return tasks.all();
    },
    async get(qualifiedId) {
      return tasks.get(qualifiedId.split(":").at(-1) ?? qualifiedId);
    },
    async moveBetweenLists(qualifiedId) {
      return this.get(qualifiedId);
    }
  };
}

export function createCommandTestHarness<TServices extends object = EmptyHarnessServices>(
  root: Group,
  options: HarnessOptions<TServices> = {}
): CommandTestHarness {
  const services = options.services ?? ({} as TServices);
  validateServices(services);
  const memoryFs = asMemoryFs(options.fs);
  const runtimeFetch = Array.isArray(options.fetch)
    ? fakeFetch(options.fetch)
    : (options.fetch ?? fakeFetch([]));
  const cumulativeTimeline: EffectEvent[] = [];
  let sequence = 0;

  const append = (runTimeline: EffectEvent[], event: UnsequencedEffectEvent): void => {
    const sequenced = { seq: ++sequence, ...event } as EffectEvent;
    runTimeline.push(sequenced);
    cumulativeTimeline.push(sequenced);
  };

  return {
    fs: memoryFs,
    timeline: cumulativeTimeline,
    async stream<T>(
      requestedPath: string[],
      inputParams: Record<string, unknown> = {},
      streamOptions: { limit?: number; signal?: AbortSignal } = {}
    ): Promise<StreamRunResult<T>> {
      const events: T[] = [];
      const statuses: StreamStatusEvent[] = [];
      try {
        const resolved = resolveCommand(root, requestedPath);
        const command = resolved.command;
        if (command.stream === undefined) {
          throw new UserError(`Command "${resolved.path.join(".")}" is not a stream.`);
        }
        const sealedEnv = createSealedEnv(command.secrets, options.env, options.secrets);
        const commandSecrets = resolveCommandSecrets(command, sealedEnv);
        const diagnostics = createRuntimeLogger({
          level: options.logLevel ?? "debug",
          logger: () => undefined
        });
        const baseContext = {
          ...(options.services ?? ({} as TServices)),
          secrets: commandSecrets,
          fetch: runtimeFetch,
          fs: memoryFs,
          env: createEnv(sealedEnv),
          diagnostics,
          progress(): void {}
        };
        await assertCommandRequirements(command, { ...baseContext, params: undefined }, {
          apiVersion: options.apiVersion,
          env: sealedEnv
        });
        const schema = filterSchemaForScope(command.params, "sdk");
        if (schema === undefined || schema.kind !== "object") {
          throw new ToolcraftBugError(
            `command "${command.name}" must define an object params schema for SDK.`
          );
        }
        const errors: ValidationError[] = [];
        const params = validateObjectSchema(schema as ObjectSchema<any>, inputParams, "", errors);
        throwValidationErrors(errors);
        const stream = createManagedStream({
          eventSchema: command.stream.event,
          signal: streamOptions.signal,
          onStatus: (event) => statuses.push(event),
          async create(signal, status) {
            return await command.handler({
              ...baseContext,
              params,
              signal,
              status,
              async refreshSecrets() {
                return resolveCommandSecrets(command, sealedEnv);
              }
            } as never);
          }
        });
        const limit = streamOptions.limit ?? Number.POSITIVE_INFINITY;
        try {
          for await (const event of stream) {
            events.push(event as T);
            if (events.length >= limit) {
              break;
            }
          }
        } finally {
          await stream.cancel();
        }
        return { ok: true, events, statuses };
      } catch (error) {
        return { ok: false, events, statuses, error };
      }
    },
    async parity(
      requestedPath: string[],
      inputParams: Record<string, unknown> = {}
    ): Promise<ParityResult> {
      const resolved = resolveCommand(root, requestedPath);
      const sealedEnv = createSealedEnv(resolved.command.secrets, options.env, options.secrets);
      return runParity(root, resolved, inputParams, {
        services,
        env: Object.fromEntries(
          Object.entries(sealedEnv).flatMap(([key, value]) =>
            value === undefined ? [] : [[key, value]]
          )
        ),
        fs: memoryFs,
        fetch: runtimeFetch,
        apiVersion: options.apiVersion
      });
    },
    async run<T>(
      requestedPath: string[],
      inputParams: Record<string, unknown> = {}
    ): Promise<RunResult<T>> {
      const logs: DiagnosticLogEvent[] = [];
      const progress: string[] = [];
      const confirmations: ConfirmationRequest[] = [];
      const timeline: EffectEvent[] = [];
      const rendered: RunResult<T>["rendered"] = {};
      const initialChangeCount = memoryFs.changes().length;
      let stage: PipelineStage = "resolve";
      let value: T | undefined;

      const result = (overrides: Partial<RunResult<T>> = {}): RunResult<T> => ({
        ok: false,
        value,
        error: undefined,
        failedAt: stage,
        pending: false,
        logs,
        progress,
        confirmations,
        timeline,
        fsChanges: memoryFs.changes().slice(initialChangeCount),
        rendered,
        ...overrides
      });

      try {
        const resolved = resolveCommand(root, requestedPath);
        const command = resolved.command;
        const commandPath = resolved.path.join(".");

        stage = "secrets";
        const sealedEnv = createSealedEnv(command.secrets, options.env, options.secrets);
        const commandSecrets = resolveCommandSecrets(command, sealedEnv);

        const diagnostics = createRuntimeLogger({
          level: options.logLevel ?? "debug",
          logger: (event) => logs.push(event)
        });
        const instrumentedFs: HandlerFs = {
          readFile: (path, encoding) => memoryFs.readFile(path, encoding),
          exists: (path) => memoryFs.exists(path),
          lstat: (path) => memoryFs.lstat(path),
          async writeFile(path, contents, fsOptions) {
            await memoryFs.writeFile(path, contents, fsOptions);
            append(timeline, { kind: "fs", op: "writeFile", path });
          },
          async rename(fromPath, toPath) {
            await memoryFs.rename(fromPath, toPath);
            append(timeline, { kind: "fs", op: "rename", path: fromPath });
          },
          async unlink(path) {
            await memoryFs.unlink(path);
            append(timeline, { kind: "fs", op: "unlink", path });
          }
        };
        const instrumentedFetch: typeof globalThis.fetch = async (input, init) => {
          const request = new Request(input, init);
          append(timeline, {
            kind: "fetch",
            method: request.method,
            url: request.url
          });
          return runtimeFetch(request);
        };
        const instrumentedServices = Object.fromEntries(
          Object.entries(services).map(([serviceName, service]) => {
            if (
              (typeof service !== "object" || service === null) &&
              typeof service !== "function"
            ) {
              return [serviceName, service];
            }

            return [
              serviceName,
              new Proxy(service, {
                get(target, property, receiver) {
                  const member = Reflect.get(target, property, receiver) as unknown;
                  if (typeof member !== "function") {
                    return member;
                  }
                  return (...args: unknown[]) => {
                    append(timeline, {
                      kind: "service",
                      service: serviceName,
                      method: String(property),
                      args
                    });
                    return Reflect.apply(member, receiver, args) as unknown;
                  };
                }
              })
            ];
          })
        );
        const baseContext = {
          ...instrumentedServices,
          secrets: commandSecrets,
          fetch: instrumentedFetch,
          fs: instrumentedFs,
          env: createEnv(
            new Proxy(sealedEnv, {
              get(target, property, receiver) {
                if (typeof property === "string") {
                  append(timeline, { kind: "env", key: property });
                }
                return Reflect.get(target, property, receiver) as unknown;
              }
            })
          ),
          diagnostics,
          progress(message: string): void {
            progress.push(message);
            append(timeline, { kind: "progress", message });
          }
        };

        stage = "requirements";
        await assertCommandRequirements(
          command,
          { ...baseContext, params: undefined },
          { apiVersion: options.apiVersion, env: sealedEnv }
        );

        stage = "params";
        const schema = filterSchemaForScope(command.params, "sdk");
        if (schema === undefined || schema.kind !== "object") {
          throw new ToolcraftBugError(
            `command "${command.name}" must define an object params schema for SDK.`
          );
        }
        const errors: ValidationError[] = [];
        const params = validateObjectSchema(schema as ObjectSchema<any>, inputParams, "", errors);
        throwValidationErrors(errors);

        const decide = async (request: ConfirmationRequest): Promise<boolean> => {
          confirmations.push(request);
          const approved =
            options.confirmations === "decline"
              ? false
              : typeof options.confirmations === "function"
                ? await options.confirmations(request)
                : true;
          append(timeline, { kind: "confirm", message: request.message, approved });
          return approved;
        };

        stage = "confirm";
        if (command.confirm && !command.humanInLoop) {
          if (!(await decide({ message: "Proceed?" }))) {
            throw new ApprovalDeclinedError({ commandPath });
          }
        }

        const provider: HumanInLoopProvider = {
          id: "toolcraft-test-harness",
          async requestApproval(request) {
            return (await decide({
              message: request.message,
              declineInputPrompt: request.declineInputPrompt
            }))
              ? { outcome: "approved" }
              : { outcome: "declined" };
          }
        };
        const commandWithTrackedHandler: typeof command = {
          ...command,
          async handler(context) {
            stage = "handler";
            return command.handler(context);
          }
        };
        const invoked = await invokeWithHumanInLoop(
          commandWithTrackedHandler,
          { ...baseContext, params } as Parameters<typeof command.handler>[0],
          { provider, taskList: createTaskList() },
          commandPath,
          {
            spawnRunner: false,
            async enqueueApproval({ tasks, payload }) {
              const approvalId = `test-harness:${payload.commandPath}`;
              const pending: HumanInLoopPending = {
                status: "pending-approval",
                approvalId,
                message: payload.message,
                enqueuedAt: ""
              };
              await tasks.create({
                id: approvalId,
                name: payload.commandPath,
                metadata: { ...payload, approvalId, enqueuedAt: "" }
              });
              return { approvalId, pending };
            }
          }
        );
        value = invoked as T;

        if (isHumanInLoopPending(invoked)) {
          return result({ ok: true, failedAt: undefined, pending: true });
        }

        stage = "render";
        if (command.render?.rich) {
          const capture = createRenderCapture();
          command.render.rich(invoked, capture.primitives);
          rendered.rich = capture.output();
        }
        if (command.render?.markdown) {
          const capture = createRenderCapture();
          rendered.markdown = stripAnsi(command.render.markdown(invoked, capture.primitives));
        }
        if (command.render?.json) {
          const capture = createRenderCapture();
          rendered.json = command.render.json(invoked, capture.primitives);
        }

        return result({ ok: true, failedAt: undefined });
      } catch (error) {
        return result({ error });
      }
    }
  };
}
