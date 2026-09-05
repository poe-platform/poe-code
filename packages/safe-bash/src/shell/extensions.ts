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

export interface ShellExtensionBindings {
  describe(name: string): ShellBindingDescription;
  get(name: string, index?: number): ShellValue | undefined;
  assign(name: string, value: ShellValue): Promise<void>;
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

export interface ShellExtensionInput {
  validateOpen(descriptor: number): void;
  borrow(descriptor: number): ShellInputBorrow;
}

export type ShellExtensionScope = "process" | "subshell" | "substitution" | "pipeline" | "invocation";
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
}

export interface ShellExtensionBuiltin {
  readonly name: string;
  readonly replace?: boolean;
  readonly special?: boolean;
  readonly expansion?: "ordinary" | "declaration";
  execute(context: ShellExtensionContext): number | Promise<number>;
}

export interface ShellExtensionInstance {
  readonly builtins: readonly ShellExtensionBuiltin[];
  readonly options?: readonly ShellExtensionOption[];
  readonly shoptOptions?: readonly ShellExtensionOption[];
  start?(context: ShellExtensionContext): void | Promise<void>;
  fork?(scope: ShellExtensionScope): ShellExtensionInstance;
  event?(event: ShellExtensionEvent, context: ShellExtensionContext): ShellExtensionEventResult | Promise<ShellExtensionEventResult>;
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
  exitStatus?: number;
  exiting?: boolean;
  started?: boolean;
  eventDepth?: number;
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
  const captured = Array.from(definitions, definition => {
    const syntax = captureShellSyntax(definition?.syntax);
    if (syntax.listTerminators.length || syntax.specialParameters.length) throw new TypeError("Unsupported runtime shell syntax declarations");
    arrayKeys ||= syntax.arrayKeys === true;
    declarations.push(syntax);
    return definition;
  });
  const result = Object.freeze({ definitions: Object.freeze(captured), declarations: Object.freeze(declarations), syntax: captureShellSyntax(arrayKeys ? { arrayKeys: true } : {}) });
  capturedDeclarations.set(result.definitions, result);
  return result;
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
  const flags = new Set(["e", "u", "o"]);
  const entries = snapshots.map((definition, index) => {
    const previous = parent?.entries[index]?.instance;
    const instance = previous?.fork && scope ? previous.fork(scope) : definition.create();
    if (!instance || !Array.isArray(instance.builtins)) throw new TypeError("Shell extension requires builtin definitions");
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
  return { entries, syntax: captured.syntax, builtins, options, shoptOptions, cleanup: [] };
}

export function forkExtensions(parent: ShellExtensionState | undefined, scope: ShellExtensionScope): ShellExtensionState | undefined {
  return parent && extensionState(parent.entries.map(entry => entry.definition), parent, scope);
}
