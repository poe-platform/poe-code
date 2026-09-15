import { PythonSyntaxError, type SourcePosition } from "./source.js";
import { ExecutionBudget, ExecutionLimitError, type ExecutionLimits } from "./runtime/execution-budget.js";
import { RuntimeValues, type BuiltinInvocationContext, type RuntimeValue } from "./runtime/runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime/runtime-type-registry.js";
import { RuntimeExecutionKeys } from "./runtime/runtime-execution-keys.js";
import { SeededPayloadHash } from "./runtime/seeded-payload-hash.js";
import { executeModule } from "./runtime/module-execution.js";
import { RuntimeMappingNamespace } from "./runtime/runtime-mapping-namespace.js";
import { lookupNamespace, type NameNamespace } from "./runtime/namespace-lookup.js";
import { ModuleFrame } from "./runtime/module-frame.js";
import { LexicalFrame } from "./runtime/lexical-frame.js";
import { ClassFrame } from "./runtime/class-frame.js";
import { CallStack } from "./runtime/call-stack.js";
import { RuntimeExceptionExecution, RuntimeRaisedException } from "./runtime/runtime-exception-execution.js";
import { standardExceptionCatalog, type StandardExceptionName } from "./runtime/standard-exception-catalog.js";
import { createRuntimeBuiltins } from "./runtime/runtime-builtins.js";
import {RuntimeCodecRegistry} from "./runtime/runtime-codec-registry.js";
import {createRuntimeCodecModule} from "./runtime/runtime-codec-module.js";
import {createRuntimeModuleImport} from "./runtime/runtime-module-import.js";
import {RuntimeCodecLibrary} from "./runtime/runtime-codec-library.js";
import { createPrintBuiltin } from "./runtime/builtin-print.js";
import { createRuntimeFrameBody, type RuntimeProgramContext } from "./runtime/runtime-program.js";
import { compileSourceProgram } from "./runtime/source-program-compilation.js";
import { OrderedKeyMap } from "./runtime/ordered-key-map.js";
import { RuntimeDictionaryNamespace } from "./runtime/runtime-dictionary-namespace.js";
import { RuntimeCodePrograms } from "./runtime/runtime-code-programs.js";
import { createRuntimeCodeBuiltins } from "./runtime/runtime-code-builtins.js";
import { createInputBuiltin } from "./runtime/builtin-input.js";
import { PythonRuntimeError } from "./runtime/error.js";
import { runtimeStringPayload } from "./runtime/runtime-string-payload.js";

export interface PythonSessionOptions {
  /** Cumulative across initialization, compilation and all calls in this session. */
  readonly limits: Omit<ExecutionLimits, "signal"> & { readonly maxDepth: number };
  readonly signal?: AbortSignal;
  /** Explicit SipHash key; supply fresh unpredictable words for untrusted guests. */
  readonly hashSeed: readonly [bigint, bigint];
  readonly output?: { write(text: string): void; flush(): void };
  /** Text line including its line ending, or null at EOF. No ambient stdin. */
  readonly input?: { readLine(): string | null };
  readonly unraisable?: (error: PythonUnraisable) => void;
  readonly warning?: (warning: PythonWarning) => void;
}
export interface PythonUnraisable { readonly exception: PythonValue; readonly object: PythonValue }
export interface PythonWarning { readonly category: string; readonly message: string; readonly filename: string; readonly position?: SourcePosition }
export interface PythonRunOptions { readonly filename?: string; readonly optimize?: 0 | 1 | 2; readonly globals?: PythonNamespace; readonly locals?: PythonNamespace }
export type PythonPrimitive = null | boolean | bigint | number | string;
/** Session-owned opaque reference. Containers and instances never expose host storage. */
export interface PythonValue { readonly kind: string; readonly primitive: PythonPrimitive }
export interface PythonNamespace {
  get(name: string): PythonValue | undefined;
  set(name: string, value: PythonValue): void;
  delete(name: string): boolean;
  names(): readonly string[];
}
export interface PythonDiagnostic { readonly name: string; readonly message: string; readonly filename: string; readonly position: SourcePosition; readonly endPosition?: SourcePosition; readonly sourceLine?: string }
export type PythonFailure =
  | { readonly status: "exception"; readonly exception: PythonValue; readonly filename: string }
  | { readonly status: "diagnostic"; readonly diagnostic: PythonDiagnostic }
  | { readonly status: "terminated"; readonly reason: "steps" | "allocation" | "cancelled" | "capability" | "internal"; readonly message: string };
export type PythonExecResult = { readonly status: "ok" } | PythonFailure;
export type PythonEvalResult = { readonly status: "ok"; readonly value: PythonValue } | PythonFailure;

class MissingCapability extends Error {}
function text(value: RuntimeValue): string {
  if (value.kind !== "str") throw new TypeError("expected guest string");
  let result = "";
  for (const point of value.value) result += String.fromCodePoint(point);
  return result;
}

/** Synchronous isolated interpreter. Calls retain mutations even on guest errors.
 * Fatal termination is permanent. close() invalidates all handles; it does not
 * execute guest finalizers. Services cannot reenter the session. No host globals,
 * streams, filesystem, clock or randomness are implicitly granted.
 */
export class PythonSession {
  readonly #meter: ExecutionBudget;
  readonly #values: RuntimeValues;
  readonly #context: RuntimeProgramContext;
  readonly #handles = new WeakMap<PythonValue, RuntimeValue>();
  readonly #published = new WeakMap<RuntimeValue, PythonValue>();
  readonly #namespace: RuntimeDictionaryNamespace;
  readonly #programs: RuntimeCodePrograms;
  readonly #calls: CallStack<object>;
  readonly #namespaces = new WeakMap<PythonNamespace, RuntimeDictionaryNamespace>();
  readonly #options: PythonSessionOptions;
  #closed = false;
  #running = false;
  #filename = "<string>";
  #failure?: Extract<PythonFailure, { status: "terminated" }>;
  readonly globals: PythonNamespace;

  constructor(options: PythonSessionOptions) {
    this.#options = { ...options, input: options.input === undefined ? undefined : { readLine: options.input.readLine.bind(options.input) }, output: options.output === undefined ? undefined : { write: options.output.write.bind(options.output), flush: options.output.flush.bind(options.output) } };
    const meter = this.#meter = new ExecutionBudget({ ...options.limits, signal: options.signal });
    const values = this.#values = new RuntimeValues(meter);
    const payload = new SeededPayloadHash(...options.hashSeed);
    const calls = this.#calls = new CallStack<object>(options.limits.maxDepth, meter);
    const hash = { none: values.none, identity: values.identity.hash.bind(values.identity), string: (s: Parameters<SeededPayloadHash["string"]>[0]) => payload.string(s, meter), bytes: (b: Parameters<SeededPayloadHash["bytes"]>[0]) => payload.bytes(b, meter) };
    const keys = new RuntimeExecutionKeys(values, hash, meter, calls);
    const registry = new RuntimeTypeRegistry(values, keys, meter);
    const dictionary = () => values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
    const namespaceObject = dictionary();
    this.#namespace = new RuntimeDictionaryNamespace(namespaceObject, values, meter);
    const programs = this.#programs = new RuntimeCodePrograms(meter, values);
    const exceptions = new RuntimeExceptionExecution(registry, values, meter);
    const unavailable = (): never => { throw new MissingCapability("runtime operation has no installed capability"); };
    const builtins = createRuntimeBuiltins(values, meter, {
      hash, identity: values.identity, buildClass: { registry, keys },
      print: { stdout: unavailable, lookupWrite: unavailable, flush: unavailable }
    });
    const codecs=new RuntimeCodecRegistry(values,meter,()=>{codecLibrary.load('codecs');});
    const codecModule=createRuntimeCodecModule(codecs,keys,registry.moduleType(),registry.encodingMapType.bind(registry));
    const modules=new Map<string,RuntimeValue>([["_codecs",codecModule]]);
    builtins.set("__import__",createRuntimeModuleImport(modules,values,meter,name=>codecLibrary.load(name)));
    const types = { property: registry.propertyType(), super: registry.superType(), object: registry.object, type: registry.type, bool: registry.booleanType(), int: registry.integerType(), float: registry.floatType(), complex: registry.complexType(), str: registry.stringType(), bytes: registry.bytesType(), list: registry.listType(), tuple: registry.tupleType(), dict: registry.dictionaryType(), set: registry.setType("set"), frozenset: registry.setType("frozenset"), range: registry.rangeType(), slice: registry.sliceType(), staticmethod: registry.methodDecoratorType("staticmethod"), classmethod: registry.methodDecoratorType("classmethod"), BaseException: registry.baseExceptionType() };
    for (const [name, type] of Object.entries(types)) builtins.set(name, type);
    for (const name of Object.keys(standardExceptionCatalog) as StandardExceptionName[]) builtins.set(name, registry.exceptionType(name));
    for(const name of ["EnvironmentError","IOError"])builtins.set(name,registry.exceptionType("OSError"));
    // Adapt only text services; explicit guest files still use guest attribute/call protocols.
    const stdout = values.instance(registry.object);
    builtins.set("print", values.builtinFunction({ name: "print", invoke: (args, kwargs, meter, invocation) => {
      const printer = createPrintBuiltin(values, meter, {
        stdout: () => { if (!this.#options.output) throw new MissingCapability("output capability is absent"); return stdout; },
        lookupWrite: file => {
          if (file === stdout) return value => this.#service(() => this.#options.output!.write(text(value)));
          if (!invocation?.attribute) return unavailable();
          const write = invocation.attribute(file, "write");
          return value => invocation.call(write, [value]);
        },
        flush: file => {
          if (file === stdout) return this.#service(() => this.#options.output!.flush());
          if (!invocation?.attribute) return unavailable();
          return invocation.call(invocation.attribute(file, "flush"), []);
        }
      });
      return printer.value.invoke(args, kwargs, meter, invocation);
    } }));
    builtins.set("input", createInputBuiltin(values, meter, {
      streams: () => {
        const input = this.#options.input, output = this.#options.output;
        if (!input) throw new MissingCapability("input capability is absent");
        if (!output) throw new MissingCapability("output capability is absent");
        meter.checkpoint(0, 96);
        return {
          write: prompt => this.#service(() => output.write(text(prompt))),
          flush: () => this.#service(() => output.flush()),
          readLine: () => this.#service(() => input.readLine())
        };
      }
    }));
    const builtinObject = dictionary();
    const builtinNamespace = new RuntimeDictionaryNamespace(builtinObject, values, meter);
    this.#context = { values, keys, calls, codecs, builtins: builtinNamespace, globals: this.#namespace, objectType: registry.object, exceptions,
      unraisable: (error, object) => {
        if (!this.#options.unraisable) throw new MissingCapability("unraisable-error capability is absent");
        const prepared = exceptions.prepare(error);
        if (!(prepared instanceof RuntimeRaisedException)) throw prepared;
        const report = Object.freeze({ exception: this.#publish(prepared.value), object: this.#publish(object) });
        this.#service(() => this.#options.unraisable!(report));
      },
      hooks: {
        resolveBuiltins: (value, invocation) => value.kind === "dict" ? new RuntimeDictionaryNamespace(value, values, meter) : new RuntimeMappingNamespace(value, values, meter, invocation),
        code: registry.code.bind(registry), functionCode: programs.functionCode.bind(programs),
        expressions: frame => ({ warn: (category, message) => {
          const source = frame.code?.source?.filename;
          const name = source === undefined ? undefined : runtimeStringPayload(source)?.value;
          meter.checkpoint(1, 96 + (name?.length ?? 0) * 4);
          let filename = this.#filename;
          if (name !== undefined) {
            filename = "";
            for (const point of name) filename += String.fromCodePoint(point);
          }
          const position = frame.executionPosition?.start;
          this.#warn({ category, message, filename, position: position === undefined ? undefined : Object.freeze({ ...position }) });
        } }),
        statements: () => ({ setAttribute: unavailable, deleteAttribute: unavailable, executeUnhandled: unavailable }),
        callable: () => false,
        name: value => `${value.kind}()`,
        keywordName: text,
        invoke: unavailable,
        specialMethods: () => ({ slots: () => undefined, typeOf: value => {
          const type = registry.nativeType(value);
          if (!type) throw new MissingCapability(`canonical type for ${value.kind} is unavailable`);
          return type;
        } })
      }
    };
    const codeBuiltins = createRuntimeCodeBuiltins(this.#context, programs, {
      currentFrame: () => { const frame = calls.current; if (frame instanceof ModuleFrame || frame instanceof LexicalFrame || frame instanceof ClassFrame) return frame; return undefined; }, frameLocals: registry.frameLocals.bind(registry), builtins: builtinObject,
      code: registry.code.bind(registry), compilation: () => ({ stripDocstring: false, enterRecursiveCall: () => calls.enter(calls.current!), onWarning: (message, position, filename) => this.#warn({ category: "SyntaxWarning", message, position, filename }) })
    }, meter);
    const builtinModule = builtins.get("__name__")!;
    for (const [name, value] of [...builtins, ...Object.entries(codeBuiltins)]) {
      if (value.kind === "builtin_function_or_method") values.builtinFunctionModule(value, builtinModule);
      builtinNamespace.store(name, value);
    }
    this.#namespace.store("__builtins__", builtinObject);
    const codecLibrary=new RuntimeCodecLibrary(modules,this.#context,programs,registry.moduleType(),meter);
    this.#namespace.store("__name__", values.string("__main__"));
    this.#namespace.store("__doc__", values.none);
    this.#namespace.store("__package__", values.none);
    this.globals = this.#publishNamespace(this.#namespace);
    Object.freeze(this);
  }

  createNamespace(): PythonNamespace {
    this.#assertIdle();
    const object = this.#values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(this.#context.keys, this.#meter));
    return this.#publishNamespace(new RuntimeDictionaryNamespace(object, this.#values, this.#meter));
  }
  #publishNamespace(namespace: RuntimeDictionaryNamespace): PythonNamespace {
    const meter = this.#meter;
    const handle = Object.freeze({
      get: (name: string) => { this.#assertIdle(); const value = namespace.lookup(name)?.value; return value === undefined ? undefined : this.#publish(value); },
      set: (name: string, value: PythonValue) => { this.#assertIdle(); const owned = this.#handles.get(value); if (!owned) throw new TypeError("value belongs to a different session"); meter.checkpoint(1, 48 + name.length * 2); namespace.store(name, owned); },
      delete: (name: string) => { this.#assertIdle(); meter.checkpoint(); return namespace.delete(name); },
      names: () => { this.#assertIdle(); const object = namespace.object; if (object.kind !== "dict") throw new TypeError("expected namespace dictionary"); meter.checkpoint(1, object.items.size * 8); return Object.freeze([...object.items.snapshot()].flatMap(([key]) => key.kind === "str" ? [text(key)] : [])); }
    });
    this.#namespaces.set(handle, namespace);
    return handle;
  }

  value(value: PythonPrimitive): PythonValue {
    this.#assertIdle();
    switch (typeof value) {
      case "string": return this.#publish(this.#values.string(value));
      case "bigint": return this.#publish(this.#values.integer(value));
      case "number": return this.#publish(this.#values.float(value));
      case "boolean": return this.#publish(this.#values.boolean(value));
      default: if (value === null) return this.#publish(this.#values.none);
    }
    throw new TypeError("only primitive values can cross the session boundary");
  }
  exec(source: string | Uint8Array, options: PythonRunOptions = {}): PythonExecResult {
    const result = this.#run(source, "exec", options);
    return result.status === "ok" ? Object.freeze({ status: "ok" }) : result;
  }
  eval(source: string | Uint8Array, options: PythonRunOptions = {}): PythonEvalResult {
    return this.#run(source, "eval", options);
  }
  get usage(): Readonly<{ steps: number; allocatedBytes: number }> { return this.#meter.usage; }
  close(): void { if (this.#running) throw new Error("session is running"); this.#closed = true; }

  #assertIdle(): void {
    if (this.#closed) throw new Error("session is closed");
    if (this.#running) throw new Error("session is running");
  }
  #service<T>(invoke: () => T): T {
    try {
      const result = invoke();
      if (result !== null && (typeof result === "object" || typeof result === "function") && "then" in result) {
        if (result instanceof Promise) void result.catch(() => {});
        throw new MissingCapability("services must complete synchronously");
      }
      return result;
    } finally { this.#meter.checkpoint(); }
  }
  #warn(warning: PythonWarning): void {
    if (!this.#options.warning) throw new MissingCapability("warning capability is absent");
    this.#service(() => this.#options.warning!(Object.freeze(warning)));
    this.#meter.checkpoint();
  }
  #publish(value: RuntimeValue): PythonValue {
    const prior = this.#published.get(value);
    if (prior) return prior;
    this.#meter.checkpoint(1, 96);
    const handle = Object.freeze({ get kind() { check(); return value.kind; }, get primitive(): PythonPrimitive {
      check();
      switch (value.kind) {
        case "none": return null;
        case "bool": case "int": case "float": return value.value;
        case "str": charge(value.value.length * 4); return text(value);
        default: throw new TypeError("guest value is not a primitive");
      }
    } });
    const check = () => this.#assertIdle();
    const charge = (bytes: number) => this.#meter.checkpoint(1, bytes);
    this.#handles.set(handle, value); this.#published.set(value, handle);
    return handle;
  }
  #run(source: string | Uint8Array, mode: "exec" | "eval", options: PythonRunOptions): PythonEvalResult {
    this.#assertIdle();
    if (this.#failure) return this.#failure;
    const globals = options.globals === undefined ? this.#namespace : this.#namespaces.get(options.globals);
    const locals = options.locals === undefined ? globals : this.#namespaces.get(options.locals);
    if (!globals || !locals) throw new TypeError("namespace belongs to a different session");
    if (typeof source !== "string" && !(source instanceof Uint8Array)) throw new TypeError("source must be text or bytes");
    this.#running = true;
    this.#filename = options.filename ?? "<string>";
    try {
      if (globals.lookup("__builtins__") === undefined) globals.store("__builtins__", this.#context.builtins.object!);
      const program = compileSourceProgram<RuntimeValue>(source, { ...options, mode, stripDocstring: false, enterRecursiveCall: () => this.#calls.enter(globals), onWarning: (message, position, filename) => this.#warn({ category: "SyntaxWarning", message, position, filename }) }, this.#values, this.#meter);
      this.#programs.register(program);
      const selected = globals.lookup("__builtins__")!.value;
      let invocation: BuiltinInvocationContext;
      let resolved: NameNamespace<RuntimeValue> | undefined;
      const builtins: NameNamespace<RuntimeValue> = {
        object: selected,
        lookup: name => {
          resolved ??= this.#context.hooks.resolveBuiltins!(selected, invocation);
          return lookupNamespace(resolved, name);
        }
      };
      const namespaces = { globals, locals, builtins };
      const body = createRuntimeFrameBody(program, this.#context, this.#meter);
      const value = executeModule(program.module, { ...namespaces, calls: this.#calls,
        body: frame => {
          const statements = body(frame, namespaces);
          invocation = statements.invocation!;
          return statements;
        }
      }, this.#meter) ?? this.#values.none;
      return Object.freeze({ status: "ok", value: this.#publish(value) });
    } catch (error) {
      let failure = error;
      if (error instanceof PythonSyntaxError) return Object.freeze({ status: "diagnostic", diagnostic: Object.freeze({ name: error.name, message: error.message, filename: error.filename, position: error.position, endPosition: error.endPosition, sourceLine: error.sourceLine }) });
      try {
        const prepared = error instanceof PythonRuntimeError ? this.#context.exceptions!.prepare(error) : error;
        if (prepared instanceof RuntimeRaisedException) return Object.freeze({ status: "exception", exception: this.#publish(prepared.value), filename: this.#filename });
      } catch (fatal) { failure = fatal; }
      const reason = failure instanceof ExecutionLimitError ? failure.reason : failure instanceof MissingCapability ? "capability" : "internal";
      this.#failure = Object.freeze({ status: "terminated", reason, message: failure instanceof Error ? failure.message : "runtime failed" });
      return this.#failure;
    } finally { this.#running = false; }
  }
}
