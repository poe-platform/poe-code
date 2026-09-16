import type { ByteSink, ByteSource } from "../contracts/io.js";
import type { ShellValue } from "../contracts/value.js";
import { commandRuntimeIdentity } from "../contracts/command.js";
import type { InputReadiness, RawRecord, RawRecordOptions, ReadLine, ReadLineOptions } from "./input.js";
import { captureShellSyntax } from "./parser.js";
import type { CapturedShellSyntax, ShellSyntaxDeclarations } from "./parser.js";

export interface ShellBindingDescription {
  readonly kind: "unset" | "scalar" | "indexed";
  readonly readonly: boolean;
  readonly exported: boolean;
}

export interface ShellBindingTransaction {
  get(index: number): ShellValue | undefined;
  set(index: number, value: ShellValue): Promise<void>;
  unset(index: number): Promise<void>;
  commit(): Promise<void>;
  close(): Promise<void>;
}

export interface ShellIndexedWriter {
  set(index: number, value: ShellValue): Promise<void>;
  close(): Promise<void>;
}

export type ShellBindingResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; diagnostic: ShellValue }>;

export interface ShellBindingReference {
  unbindName(): Promise<ShellBindingResult<void>>;
  assignInteger(value: number): Promise<ShellBindingResult<void>>;
  close(): Promise<void>;
}

export interface ShellExtensionBindings {
  describe(name: string): ShellBindingDescription;
  get(name: string, index?: number): ShellValue | undefined;
  assign(name: string, value: ShellValue): Promise<void>;
  prepareReference(reference: ShellValue): Promise<ShellBindingResult<ShellBindingReference>>;
  openIndexed(name: string, options?: { readonly clear?: boolean }): Promise<ShellIndexedWriter>;
  prepare(name: string, options: { readonly kind: "indexed"; readonly clear?: boolean }): Promise<ShellBindingTransaction>;
}

export interface ShellInputBorrow {
  readonly stdinIsDefault?: boolean;
  read(raw: boolean, options?: Pick<ReadLineOptions, "count" | "delimiter" | "exact" | "timeoutMs">): Promise<ReadLine>;
  record(options?: RawRecordOptions): Promise<RawRecord>;
  readiness(): InputReadiness;
  release(): Promise<void>;
}

export interface ShellReadProbe {
  readonly readiness: "ready" | "blocked" | "unknown";
  readonly timeout: "honor" | "ignore" | "unknown";
}

export interface ShellInputObserver {
  readonly readable: boolean;
  probeRead(): Promise<ShellReadProbe>;
  waitRead(options: { readonly timeoutMs: number; readonly signal?: AbortSignal | undefined }): Promise<"ready" | "timeout" | "unknown">;
  release(): Promise<void>;
}

export interface ShellExtensionInput {
  validateOpen(descriptor: number): void;
  borrow(descriptor: number): ShellInputBorrow;
  observe(descriptor: number): ShellInputObserver;
}

export type ShellExtensionScope = "process" | "subshell" | "substitution" | "pipeline" | "invocation";
export type ShellExecutionCheckpoint = "loop-body-complete" | "child-job-install" | "source-input-read";
export type ShellExtensionEvent = "exit" | "error" | "command" | "function-enter" | "function-return" | "function-leave" | "source-enter" | "source-return" | "source-leave";
export type ShellExtensionEventResult = void | { readonly action: "skip" } | { readonly action: "return"; readonly status: number };

export interface ShellExtensionContext {
  readonly command: string;
  readonly args: readonly string[];
  readonly argumentValues: readonly ShellValue[];
  readonly status: number;
  readonly functionDepth: number;
  readonly sourceDepth: number;
  readonly stdin: ByteSource;
  readonly stdout: ByteSink;
  readonly stderr: ByteSink;
  readonly signal: AbortSignal;
  readonly scope: object;
  readonly bindings: ShellExtensionBindings;
  readonly input: ShellExtensionInput;
  evaluate(source: ShellValue, options?: { readonly name?: string }): Promise<number>;
  variable(name: string): string | undefined;
  accountSource(source: ShellValue): void;
  diagnostic(message: ShellValue): Promise<void>;
  registerCleanup(cleanup: () => void | Promise<void>): void;
  registerExecutionCleanup?(cleanup: () => void | Promise<void>): AbortSignal;
  interruptWait?(status: number): boolean;
  waitInterruptibly?<Value>(operation: (signal: AbortSignal) => Promise<Value>): Promise<
    Readonly<{ kind: "completed"; value: Value } | { kind: "interrupted"; status: number }>
  >;
}

export interface ShellExtensionBuiltin {
  readonly name: string;
  readonly replace?: boolean;
  readonly special?: boolean;
  readonly expansion?: "ordinary" | "declaration";
  execute(context: ShellExtensionContext): number | Promise<number>;
}

export interface PreparedShellChild {
  readonly processId: number;
  run(): Promise<number>;
}

export interface ShellChildPreparation {
  readonly signal: AbortSignal;
  readonly stdin: "inherit" | "async-default";
  registerCleanup(cleanup: () => void | Promise<void>): void;
}

export interface ShellListTerminatorContext extends ShellExtensionContext {
  prepareChild(options: ShellChildPreparation): Promise<PreparedShellChild>;
}

export interface ShellListTerminatorHook {
  readonly operator: string;
  execute(context: ShellListTerminatorContext): number | Promise<number>;
}

export interface ShellSpecialParameterHook {
  readonly name: string;
  lookup(context: ShellExtensionContext): ShellValue | undefined;
}

export interface ShellExtensionInstance {
  readonly builtins: readonly ShellExtensionBuiltin[];
  readonly options?: readonly ShellExtensionOption[];
  readonly shoptOptions?: readonly ShellExtensionOption[];
  readonly listTerminators?: readonly ShellListTerminatorHook[];
  readonly specialParameters?: readonly ShellSpecialParameterHook[];
  start?(context: ShellExtensionContext): void | Promise<void>;
  fork?(scope: ShellExtensionScope): ShellExtensionInstance;
  event?(event: ShellExtensionEvent, context: ShellExtensionContext): ShellExtensionEventResult | Promise<ShellExtensionEventResult>;
  checkpoint?(point: ShellExecutionCheckpoint, context: ShellExtensionContext): void | Promise<void>;
}

export interface ShellExtensionOption {
  readonly name: string;
  readonly flag?: string;
  enabled: boolean;
}

export interface ShellExtension {
  readonly name: string;
  readonly runtimeIdentity?: object;
  readonly syntax?: ShellSyntaxDeclarations;
  create(): ShellExtensionInstance;
}

export interface ShellExtensionState {
  readonly syntax: CapturedShellSyntax;
  readonly entries: readonly { readonly definition: ShellExtension; readonly instance: ShellExtensionInstance }[];
  readonly builtins: ReadonlyMap<string, ShellExtensionBuiltin>;
  readonly options: ReadonlyMap<string, ShellExtensionOption>;
  readonly shoptOptions: ReadonlyMap<string, ShellExtensionOption>;
  readonly listTerminators: ReadonlyMap<string, ShellListTerminatorHook>;
  readonly specialParameters: ReadonlyMap<string, ShellSpecialParameterHook>;
  readonly checkpoints: readonly NonNullable<ShellExtensionInstance["checkpoint"]>[];
  exitStatus?: number;
  exiting?: boolean;
  started?: boolean;
  eventDepth?: number;
  waiting?: (status: number) => boolean;
  readonly cleanup: (() => Promise<void>)[];
}

const capturedDefinitions = new WeakSet<ShellExtension>();

interface CapturedShellExtensions {
  readonly definitions: readonly ShellExtension[];
  readonly declarations: readonly CapturedShellSyntax[];
  readonly syntax: CapturedShellSyntax;
}

const capturedDeclarations = new WeakMap<readonly ShellExtension[], CapturedShellExtensions>();

export function captureShellExtensions(definitions: readonly ShellExtension[]): CapturedShellExtensions {
  const previous = capturedDeclarations.get(definitions);
  if (previous) return previous;
  const declarations: CapturedShellSyntax[] = [];
  let arrayKeys = false;
  let indexedElementOperators = false;
  let indexedReadonly = false;
  const listTerminators: { operator: string }[] = [];
  const specialParameters: { name: string }[] = [];
  const captured = Array.from(definitions, definition => {
    const syntax = captureShellSyntax(definition?.syntax);
    listTerminators.push(...syntax.listTerminators);
    specialParameters.push(...syntax.specialParameters);
    arrayKeys ||= syntax.arrayKeys === true;
    indexedElementOperators ||= syntax.indexedElementOperators === true;
    indexedReadonly ||= syntax.indexedDeclarations?.includes("readonly") === true;
    declarations.push(syntax);
    return definition;
  });
  const result = Object.freeze({ definitions: Object.freeze(captured), declarations: Object.freeze(declarations), syntax: captureShellSyntax({
    ...(arrayKeys ? { arrayKeys: true } : {}),
    ...(indexedElementOperators ? { indexedElementOperators: true } : {}),
    ...(indexedReadonly ? { indexedDeclarations: ["readonly"] } : {}),
    listTerminators, specialParameters,
  }) });
  capturedDeclarations.set(result.definitions, result);
  return result;
}

function captureHooks(instance: ShellExtensionInstance, field: "listTerminators" | "specialParameters", declared: readonly string[]): readonly { key: string; callback: (...args: never[]) => unknown }[] {
  const descriptor = Object.getOwnPropertyDescriptor(instance, field);
  if (descriptor && !("value" in descriptor)) throw new TypeError("Shell syntax hooks require own data properties");
  const hooks: unknown = descriptor?.value;
  if (hooks === undefined && !declared.length) return [];
  if (!Array.isArray(hooks) || hooks.length !== declared.length || hooks.length > 32
    || Reflect.ownKeys(hooks).length !== hooks.length + 1) throw new TypeError("Shell syntax hooks must match declarations");
  const keyName = field === "listTerminators" ? "operator" : "name";
  const methodName = field === "listTerminators" ? "execute" : "lookup";
  const seen = new Set<string>();
  return Array.from({ length: hooks.length }, (_, index) => {
    const entry = Object.getOwnPropertyDescriptor(hooks, String(index));
    if (!entry || !("value" in entry) || !entry.value || typeof entry.value !== "object") throw new TypeError("Invalid shell syntax hook");
    const hook = entry.value as object;
    const key = Object.getOwnPropertyDescriptor(hook, keyName);
    const method = Object.getOwnPropertyDescriptor(hook, methodName);
    if (Reflect.ownKeys(hook).length !== 2 || !key || !("value" in key) || typeof key.value !== "string"
      || !declared.includes(key.value) || seen.has(key.value) || !method || !("value" in method) || typeof method.value !== "function") throw new TypeError("Invalid or duplicate shell syntax hook");
    seen.add(key.value);
    return { key: key.value, callback: method.value.bind(hook) as (...args: never[]) => unknown };
  });
}

export function extensionState(definitions: readonly ShellExtension[], parent?: ShellExtensionState, scope?: ShellExtensionScope): ShellExtensionState | undefined {
  if (!definitions.length) return undefined;
  const captured = captureShellExtensions(definitions);
  const names = new Set<string>();
  const snapshots = captured.definitions.map((definition, index) => {
    if (!definition) throw new TypeError("Invalid shell extension");
    const { name, create, runtimeIdentity } = definition;
    if (typeof name !== "string" || !name || names.has(name) || typeof create !== "function") throw new TypeError("Invalid or duplicate shell extension");
    if (runtimeIdentity !== undefined && runtimeIdentity !== commandRuntimeIdentity) throw new TypeError("Shell extension requires its matching shell runtime; do not mix source and compiled runtime modules");
    names.add(name);
    if (capturedDefinitions.has(definition)) return definition;
    const snapshot = Object.freeze({ name, create: create.bind(definition), syntax: captured.declarations[index]!, ...(runtimeIdentity === undefined ? {} : { runtimeIdentity }) });
    capturedDefinitions.add(snapshot);
    return snapshot;
  });
  const builtins = new Map<string, ShellExtensionBuiltin>();
  const options = new Map<string, ShellExtensionOption>();
  const shoptOptions = new Map<string, ShellExtensionOption>();
  const listTerminators = new Map<string, ShellListTerminatorHook>();
  const specialParameters = new Map<string, ShellSpecialParameterHook>();
  const checkpoints: NonNullable<ShellExtensionInstance["checkpoint"]>[] = [];
  const flags = new Set(["e", "u", "o"]);
  const entries = snapshots.map((definition, index) => {
    const previous = parent?.entries[index]?.instance;
    const instance = previous?.fork && scope ? previous.fork(scope) : definition.create();
    if (!instance || !Array.isArray(instance.builtins)) throw new TypeError("Shell extension requires builtin definitions");
    const checkpoint = Object.getOwnPropertyDescriptor(instance, "checkpoint");
    if (checkpoint) {
      if (!("value" in checkpoint) || checkpoint.value !== undefined && typeof checkpoint.value !== "function") throw new TypeError("Shell checkpoint requires an own callable data property");
      if (checkpoint.value !== undefined) checkpoints.push(Reflect.apply(Function.prototype.bind, checkpoint.value, [instance]) as NonNullable<ShellExtensionInstance["checkpoint"]>);
    }
    for (const hook of captureHooks(instance, "listTerminators", definition.syntax?.listTerminators?.map(entry => entry.operator) ?? [])) {
      if (listTerminators.has(hook.key)) throw new TypeError("Duplicate shell list terminator");
      listTerminators.set(hook.key, Object.freeze({ operator: hook.key, execute: hook.callback as ShellListTerminatorHook["execute"] }));
    }
    for (const hook of captureHooks(instance, "specialParameters", definition.syntax?.specialParameters?.map(entry => entry.name) ?? [])) {
      if (specialParameters.has(hook.key)) throw new TypeError("Duplicate shell special parameter");
      specialParameters.set(hook.key, Object.freeze({ name: hook.key, lookup: hook.callback as ShellSpecialParameterHook["lookup"] }));
    }
    for (const builtin of instance.builtins) {
      if (!builtin) throw new TypeError("Invalid extension builtin");
      const { name, replace, special, expansion, execute } = builtin;
      if (typeof name !== "string" || !name || name.includes("\0") || typeof execute !== "function" || builtins.has(name)) throw new TypeError("Invalid or duplicate extension builtin");
      if (expansion !== undefined && expansion !== "ordinary" && expansion !== "declaration") throw new TypeError("Invalid extension builtin expansion metadata");
      if (replace !== undefined && typeof replace !== "boolean") throw new TypeError("Invalid extension builtin replacement metadata");
      builtins.set(name, Object.freeze({ name, ...(replace === undefined ? {} : { replace }), ...(special === undefined ? {} : { special }), ...(expansion === undefined ? {} : { expansion }), execute: execute.bind(builtin) }));
    }
    for (const option of instance.options ?? []) {
      if (!option.name || ["errexit", "nounset", "pipefail"].includes(option.name) || options.has(option.name) || typeof option.enabled !== "boolean" || option.flag !== undefined && (option.flag.length !== 1 || flags.has(option.flag))) throw new TypeError("Invalid or duplicate extension shell option");
      if (option.flag !== undefined) flags.add(option.flag);
      options.set(option.name, option);
    }
    for (const option of instance.shoptOptions ?? []) {
      if (!option.name || option.name === "dotglob" || shoptOptions.has(option.name) || option.flag !== undefined || typeof option.enabled !== "boolean") throw new TypeError("Invalid or duplicate extension shopt option");
      shoptOptions.set(option.name, option);
    }
    return { definition, instance };
  });
  return { entries, syntax: captured.syntax, builtins, options, shoptOptions, listTerminators, specialParameters, checkpoints: Object.freeze(checkpoints), cleanup: [] };
}

export function forkExtensions(parent: ShellExtensionState | undefined, scope: ShellExtensionScope): ShellExtensionState | undefined {
  return parent && extensionState(parent.entries.map(entry => entry.definition), parent, scope);
}
