import {parseSourceModule, type ParsedSourceModule} from "../parse/source-module.js";
import type { Module } from "../parse/parser.js";
import {interpret, type InterpretOptions} from "../interp/interpreter.js";
import {Scope} from "../interp/scope.js";
import {createModuleNamespace} from "../interp/module-namespace.js";
import {setSandboxPrototype} from "../interp/object-model.js";
import type {SandboxObject} from "../interp/values.js";
import {awaitWithSignal} from "../interp/cancel.js";
import {SandboxJobQueue} from "../interp/jobs.js";
import {attachSourceLoader, resolveModuleNamespace, type ModuleEnvironment} from "./registry.js";

export type SourceModule = {id: string; source: string};
export type SourceResolver = (specifier: string, referrer: string, context: {signal?: AbortSignal}) =>
  SourceModule | undefined | Promise<SourceModule | undefined>;

type RecordEntry = {
  id: string;
  source: string;
  parsed: ParsedSourceModule;
  scope: Scope;
  dependencies: Map<string, RecordEntry | SandboxObject>;
  namespace?: SandboxObject;
  linked?: Promise<void>;
  evaluation?: Promise<void>;
  traversal?: Promise<void>;
  async?: boolean;
  completed?: boolean;
  failure?: {reason: unknown};
  dfsIndex?: number;
  dfsAncestor?: number;
  onStack?: boolean;
  cycleRoot?: RecordEntry;
};
type Binding = {record: RecordEntry; name: string} | {namespace: SandboxObject; name: string; whole?: true};
const ambiguous = Symbol("ambiguous module export");
const sourceRecords = new WeakSet<object>();

/** Owns one realm's canonical source identities. The resolver is the only source authority. */
export class SourceModuleGraph {
  readonly stats = {nodeVisits:0};
  private readonly records = new Map<string, RecordEntry>();
  private readonly requests = new Map<string, Promise<RecordEntry | SandboxObject>>();
  private requestDataSize = 0;
  private readonly pendingImports = new Set<Promise<SandboxObject>>();
  private readonly jobs: SandboxJobQueue;
  private readonly evaluationStack: RecordEntry[] = [];
  private evaluationIndex = 0;

  constructor(private readonly options: InterpretOptions & {
    scope: Scope;
    resolver: SourceResolver;
    modules: ModuleEnvironment;
  }) {
    this.jobs = options.jobs ?? new SandboxJobQueue();
    attachSourceLoader(options.modules,this.import.bind(this));
    options.budget?.setRetainedValues(this, () => [...this.records.values()].flatMap(record =>
      [record.id,record.source,...record.parsed.requests,...record.scope.retainedDataRoots()]));
  }

  close(): void {
    this.options.budget?.setRetainedValues(this,undefined);
    this.options.budget?.setRetainedDataUsage(this.requests,0);
    this.requestDataSize = 0;
    this.records.clear();
    this.requests.clear();
  }

  import(specifier: string, referrer: string): Promise<SandboxObject> {
    const pending=(async () => {
      const entry = await this.load(specifier, referrer);
      if (!isRecord(entry)) return entry;
      await this.loadGraph(entry);
      await this.link(entry);
      await this.evaluate(entry);
      await this.jobs.drain();
      return this.namespace(entry);
    })();
    this.pendingImports.add(pending);
    void pending.then(() => this.pendingImports.delete(pending), () => this.pendingImports.delete(pending));
    return pending;
  }

  async settle(): Promise<void> {
    do {
      await Promise.allSettled([...this.pendingImports]);
      await this.jobs.drain();
    } while (this.pendingImports.size > 0);
  }

  async evaluateSource(source: SourceModule, beforeEvaluation?: (module: Module) => void): Promise<SandboxObject> {
    const entry = this.register(source);
    await this.loadGraph(entry);
    await this.link(entry);
    beforeEvaluation?.(entry.parsed.module);
    await this.evaluate(entry);
    await this.jobs.drain();
    return this.namespace(entry);
  }

  private register(source: SourceModule): RecordEntry {
      const known = this.records.get(source.id);
      if (known !== undefined) {
        if (known.source !== source.source) throw new TypeError(`Source identity '${source.id}' changed within the graph.`);
        return known;
      }
      this.options.budget?.chargeDataUsage(source.source.length + source.id.length + 1);
      const parsed = parseSourceModule(source.source, source.id, this.options.compilation?.owner ?? this.options.compileOwner);
      const importMeta = Object.create(null) as SandboxObject;
      setSandboxPrototype(importMeta,null);
      const record: RecordEntry = {id:source.id, source:source.source, parsed,
        scope: new Scope({this:undefined},this.options.scope,importMeta, {functionBoundary:true}), dependencies:new Map()};
      record.scope.moduleEnvironment = this.options.modules;
      record.scope.moduleId = record.id;
      sourceRecords.add(record);
      this.records.set(source.id,record);
      return record;
  }

  private load(specifier: string, referrer: string): Promise<RecordEntry | SandboxObject> {
    if (this.options.modules.available.includes(specifier))
      return Promise.resolve(resolveModuleNamespace(this.options.modules, specifier));
    const key = JSON.stringify([referrer, specifier]);
    const cached = this.requests.get(key);
    if (cached !== undefined) return cached;
    // Both successful aliases and denied requests are cached for this realm's
    // lifetime. Reserve their identities before calling the host resolver.
    const requestDataSize = this.requestDataSize + key.length + 1;
    this.options.budget?.setRetainedDataUsage(this.requests,requestDataSize);
    this.requestDataSize = requestDataSize;
    const request = (async () => {
      this.options.signal?.throwIfAborted();
      const source = await awaitWithSignal(Promise.resolve(this.options.resolver(specifier, referrer, {signal:this.options.signal})),this.options.signal);
      this.options.signal?.throwIfAborted();
      if (source === undefined) throw new TypeError(`Source resolver denied '${specifier}' from '${referrer}'.`);
      if (typeof source.id !== "string" || source.id.length === 0 || typeof source.source !== "string")
        throw new TypeError("Source resolver must supply a nonempty identity and source text.");
      return this.register(source);
    })();
    this.requests.set(key,request);
    return request;
  }

  private loadGraph(root: RecordEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      const visited = new Set<RecordEntry>();
      let pending = 1;
      let loading = true;
      const fail = (reason: unknown) => {loading = false; reject(reason);};
      const finish = () => {
        if (--pending === 0 && loading) {loading = false; resolve();}
      };
      const visit = (record: RecordEntry) => {
        this.options.budget?.visitNode();
        if (visited.has(record)) return;
        visited.add(record);
        for (const {specifier: request, attributes} of record.parsed.moduleRequests) {
          this.options.budget?.visitNode();
          if (attributes.length > 0) throw new SyntaxError(`Unsupported import attribute '${attributes[0]![0]}'.`);
          pending++;
          // Request every edge without waiting for its peers. Each resolution
          // continues loading its own descendants, including across cycles.
          void this.load(request,record.id).then(dependency => {
            if (!loading) return;
            try {
              record.dependencies.set(request,dependency);
              if (isRecord(dependency)) visit(dependency);
              finish();
            } catch (reason) {fail(reason);}
          }, fail);
        }
      };
      try {visit(root); finish();} catch (reason) {fail(reason);}
    });
  }

  private async link(root: RecordEntry): Promise<void> {
    const pending = [root];
    const visited = new Set<RecordEntry>();
    while (pending.length > 0) {
      this.options.budget?.visitNode();
      const record = pending.pop()!;
      if (visited.has(record)) continue;
      visited.add(record);
      for (const dependency of record.dependencies.values()) if (isRecord(dependency)) pending.push(dependency);
    }
    // Instantiate all local cells and hoisted functions before creating any import.
    for (const record of visited) if (record.linked === undefined) {
      record.linked = this.execute(record,"link");
      await record.linked;
    } else await record.linked;
    for (const record of visited) {
      for (const entry of record.parsed.exports) {
        this.options.budget?.visitNode();
        if (entry.exported !== undefined && entry.request !== undefined) this.requireExport(record,entry.exported);
      }
      for (const entry of record.parsed.imports) {
        this.options.budget?.visitNode();
        if (record.scope.hasOwnBinding(entry.local)) continue;
        const dependency = record.dependencies.get(entry.request)!;
        if (entry.namespace === true) {
          record.scope.declare(entry.local,"const",isRecord(dependency) ? this.namespace(dependency) : dependency);
          continue;
        }
        const binding = isRecord(dependency) ? this.requireExport(dependency,entry.imported)
          : Object.hasOwn(dependency,entry.imported) ? {namespace:dependency,name:entry.imported} : undefined;
        if (binding === undefined) throw new SyntaxError(`Module '${entry.request}' does not export '${entry.imported}'.`);
        if ("record" in binding) record.scope.declareImport(entry.local,binding.record.scope,binding.name);
        else record.scope.declare(entry.local,"const",binding.whole ? binding.namespace : binding.namespace[binding.name]);
      }
    }
  }

  private names(record: RecordEntry, visited = new Set<RecordEntry>()): Set<string> {
    this.options.budget?.visitNode();
    if (visited.has(record)) return new Set();
    const leave = this.options.budget?.enterCall();
    try {
      visited.add(record);
      const names = new Set<string>();
      for (const entry of record.parsed.exports) {
        this.options.budget?.visitNode();
        if (entry.exported !== undefined) names.add(entry.exported);
        else {
          const dependency = record.dependencies.get(entry.request!)!;
          for (const name of isRecord(dependency) ? this.names(dependency,visited) : Object.keys(dependency))
            if (name !== "default") names.add(name);
        }
      }
      return names;
    } finally { leave?.(); }
  }

  private resolve(record: RecordEntry, name: string, visited = new Set<string>()): Binding | typeof ambiguous | undefined {
    this.options.budget?.visitNode();
    const key = JSON.stringify([record.id,name]);
    if (visited.has(key)) return undefined;
    const leave = this.options.budget?.enterCall();
    try {
      visited.add(key);
      const explicit = record.parsed.exports.find(entry => {
        this.options.budget?.visitNode();
        return entry.exported === name;
      });
      if (explicit?.local !== undefined) {
        const imported = record.parsed.imports.find(entry => {
          this.options.budget?.visitNode();
          return entry.local === explicit.local;
        });
        if (imported === undefined || imported.namespace === true) return {record,name:explicit.local};
        return this.resolveDependency(record, imported.request, imported.imported,visited);
      }
      if (explicit?.request !== undefined) return this.resolveDependency(record,explicit.request,explicit.imported!,visited,explicit.namespace);
      if (name === "default") return undefined;
      let resolved: Binding | undefined;
      for (const entry of record.parsed.exports) {
        this.options.budget?.visitNode();
        if (entry.exported !== undefined) continue;
        const candidate = this.resolveDependency(record,entry.request!,name,visited);
        if (candidate === ambiguous) return ambiguous;
        if (candidate === undefined) continue;
        if (resolved !== undefined && !sameBinding(resolved,candidate)) return ambiguous;
        resolved = candidate;
      }
      return resolved;
    } finally { leave?.(); }
  }

  private resolveDependency(record: RecordEntry, request: string, name: string, visited: Set<string>, whole = false): Binding | typeof ambiguous | undefined {
    const dependency = record.dependencies.get(request)!;
    if (whole) {
      if (!isRecord(dependency)) return {namespace:dependency,name:"",whole:true};
      const namespace = this.namespace(dependency);
      const local = "*namespace*";
      if (!dependency.scope.hasOwnBinding(local)) dependency.scope.declare(local,"const",namespace);
      return {record:dependency,name:local};
    }
    return isRecord(dependency) ? this.resolve(dependency,name,visited)
      : Object.hasOwn(dependency,name) ? {namespace:dependency,name} : undefined;
  }

  private requireExport(record: RecordEntry, name: string): Binding {
    const resolved = this.resolve(record,name);
    if (resolved === undefined || resolved === ambiguous)
      throw new SyntaxError(`Module '${record.id}' has ${resolved === ambiguous ? "an ambiguous" : "no"} export '${name}'.`);
    return resolved;
  }

  private namespace(record: RecordEntry): SandboxObject {
    if (record.namespace !== undefined) return record.namespace;
    const bindings = new Map<string,Binding>();
    record.namespace = createModuleNamespace(namespace => {
      record.namespace = namespace;
      for (const name of this.names(record)) {
        const resolved = this.resolve(record,name);
        if (resolved !== undefined && resolved !== ambiguous) bindings.set(name,resolved);
      }
      return Object.fromEntries([...bindings.keys()].map(name => [name,undefined]));
    }, name => {
      const binding = bindings.get(name)!;
      if ("namespace" in binding) return binding.whole ? binding.namespace : binding.namespace[binding.name];
      const value = binding.record.scope.lookup(binding.name);
      if (!value.found) throw new ReferenceError(`Uninitialized module export '${name}'.`);
      return value.value;
    }, () => record.scope.retainedDataRoots());
    return record.namespace;
  }

  private async evaluate(record: RecordEntry): Promise<void> {
    try {
      await this.jobs.run(() => this.start(record));
      await (record.cycleRoot ?? record).evaluation;
    } catch (reason) {
      for (const pending of this.evaluationStack.splice(0)) {
        pending.onStack=false;
        pending.cycleRoot=record;
        pending.failure ??= {reason};
      }
      throw reason;
    }
  }

  private start(record: RecordEntry, ancestors = new Set<RecordEntry>()): Promise<void> {
    if (ancestors.has(record)) return Promise.resolve();
    if (record.traversal !== undefined) return record.traversal;
    let fulfilled!: () => void;
    let rejected!: (reason: unknown) => void;
    record.evaluation = new Promise<void>((resolve,reject) => {fulfilled=resolve;rejected=reject;});
    void record.evaluation.catch(() => undefined);
    const complete = () => {record.completed=true;fulfilled();};
    const fail = (reason: unknown) => {record.completed=true;record.failure={reason};rejected(reason);};
    const next = new Set(ancestors).add(record);
    record.traversal = (async () => {
      record.dfsIndex=this.evaluationIndex++;
      record.dfsAncestor=record.dfsIndex;
      record.onStack=true;
      this.evaluationStack.push(record);
      const dependencies: Promise<void>[] = [];
      // Host resolution completion order must not change evaluation order.
      for (const request of record.parsed.requests) {
        const dependency = record.dependencies.get(request)!;
        if (!isRecord(dependency)) continue;
        if (!next.has(dependency)) await this.start(dependency,next);
        if (dependency.onStack) record.dfsAncestor=Math.min(record.dfsAncestor,dependency.dfsAncestor!);
        const required=dependency.onStack ? dependency : dependency.cycleRoot ?? dependency;
        if (required.failure !== undefined) throw required.failure.reason;
        if (required.async && !required.completed) dependencies.push(required.evaluation!);
      }
      record.async = record.parsed.hasTLA || dependencies.length > 0;
      if (dependencies.length > 0) {
        void Promise.all(dependencies).then(() => this.execute(record,"evaluate")).then(complete,fail);
      } else if (record.parsed.hasTLA) {
        let suspend!: () => void;
        const prefix = new Promise<void>(resolve => {suspend=resolve;});
        void this.execute(record,"evaluate",suspend).then(complete,fail).then(suspend);
        await prefix;
      } else {
        await this.execute(record,"evaluate");
        complete();
      }
      if (record.dfsIndex === record.dfsAncestor) {
        for (;;) {
          const member=this.evaluationStack.pop()!;
          member.onStack=false;
          member.cycleRoot=record;
          if (member===record) break;
        }
      }
    })().catch(error => {fail(error);throw error;});
    return record.traversal;
  }

  private async execute(record: RecordEntry, modulePhase: "link" | "evaluate", onSuspend?: () => void): Promise<void> {
    const result = await interpret({type:"BlockStatement",body:record.parsed.module.body,span:record.parsed.module.span},
      {...this.options, scope:record.scope, useScopeDirectly:true, jobs:this.jobs, nested:true,modulePhase,onSuspend});
    this.stats.nodeVisits += result.stats.nodeVisits;
    if (!result.ok) throw new Error(result.error.message);
  }
}

function isRecord(value: RecordEntry | SandboxObject): value is RecordEntry {
  return sourceRecords.has(value);
}
function sameBinding(left: Binding, right: Binding): boolean {
  return left.name === right.name && ("record" in left && "record" in right ? left.record === right.record
    : "namespace" in left && "namespace" in right && left.namespace === right.namespace && left.whole === right.whole);
}
