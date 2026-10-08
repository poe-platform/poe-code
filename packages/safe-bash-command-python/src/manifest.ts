import {serializeLlmJsonValue} from 'safe-bash-command-llm';
import {toByteSource} from 'safe-bash-contracts/io';

/** Native distribution metadata and pip-compatible removal listings. */
export type PythonPackageRecord = readonly [name:string, metadata:string, origin:string, remove:readonly string[], skip:readonly string[],directUrl?:string|null];

/** Exact installed requirements; newer snapshots can uninstall without wheels. */
export type PythonInstalledSnapshot = {readonly version:1;readonly installed:readonly string[]} |
 {readonly version:2;readonly installed:readonly string[];readonly records:readonly PythonPackageRecord[]} |
 {readonly version:3;readonly installed:readonly string[];readonly records:readonly PythonPackageRecord[]};

/** Accept legacy requirements and validated versioned installed snapshots. */
export function readPackageManifest(value: unknown): readonly string[] | undefined {
 const strings=(values:unknown):values is string[]=>Array.isArray(values)&&values.every(item=>typeof item==='string');
 if(Array.isArray(value))return strings(value)?value:undefined;
 if(!value||typeof value!=='object')return;
 const record=value as PythonInstalledSnapshot,version=record.version;
 if(![1,2,3].includes(version)||Object.keys(value).length!==(version===1?2:3))return;
 if(version!==1&&(!Array.isArray(record.records)||!record.records.every(row=>Array.isArray(row)&&row.length===version+3&&row.every((part,index)=>index>2&&index<5?strings(part):typeof part==='string'||index===5&&part===null))))return;
 return strings(record.installed)?record.installed:undefined;
}

export interface PythonPackageManifest {
  readonly revision: string;
  readonly bytes: Uint8Array;
}

/** Validated host snapshot whose metadata stays in caller backing storage. */
export interface PythonPackageRecordSnapshot {
 readonly revision:string;
 readonly installed:readonly string[];
 readonly version:0|1|2|3;
 readonly recordCount:number;
 readRecord(ordinal:number,offset:number):Promise<string>;
 close():Promise<void>;
}

export interface PythonPackageManifestStore {
  openSnapshot?(scope:string,options:{readonly signal:AbortSignal;readonly maxBytes:number}):Promise<PythonPackageRecordSnapshot|undefined>;
  get(scope: string, options: { readonly signal: AbortSignal }): Promise<PythonPackageManifest | undefined>;
  /** Optional incremental decoding; the returned value is validated by the environment.
   * Enforce maxBytes on original input and retire all read handles before returning. */
  getSnapshot?(scope: string, options: {readonly signal: AbortSignal; readonly maxBytes: number}): Promise<{readonly revision: string; readonly value: unknown} | undefined>;
  compareAndSet(scope: string, revision: string | undefined, bytes: Uint8Array, options: { readonly signal: AbortSignal }): Promise<boolean>;
  /** Optional structured publication, avoiding the environment's byte buffer.
   * The store must enforce maxBytes on the serialized representation. */
  compareAndSetSnapshot?(scope: string, revision: string | undefined, snapshot: PythonInstalledSnapshot | readonly string[], options: { readonly signal: AbortSignal; readonly maxBytes: number }): Promise<boolean>;
}

export interface PythonPackageStreamingManifestStore {
 get: PythonPackageManifestStore['get'];
 /** Consume privately, then atomically compare and publish. Source errors must
  * leave the prior snapshot unchanged. A stale revision may return false early. */
 compareAndSet(scope: string, revision: string | undefined, source: AsyncIterable<Uint8Array>, options: {readonly signal: AbortSignal}): Promise<boolean>;
}

/** Adapt an atomic streaming store without assembling encoded manifest bytes. */
export function createPythonPackageStreamingManifestStore(store:PythonPackageStreamingManifestStore):PythonPackageManifestStore {
 return {
  get:store.get.bind(store),
  compareAndSet(scope,revision,bytes,options){return store.compareAndSet(scope,revision,toByteSource(bytes),options);},
  async compareAndSetSnapshot(scope,revision,snapshot,options){
   let consumed=false;
   const source=(async function*(){
    let size=0;
    for await(const bytes of serializeLlmJsonValue(snapshot,options.signal)){
     size+=bytes.length;
     if(size>options.maxBytes)throw Object.assign(new Error('Python package manifest exceeds maxManifestBytes'),{code:'EPACKAGE'});
     yield bytes;
    }
    consumed=true;
   })();
   try{
    const committed=await store.compareAndSet(scope,revision,source,options);
    options.signal.throwIfAborted();
    if(committed===true&&!consumed)throw new Error('Python manifest store returned before consuming its source');
    return committed;
   }finally{await source.return();}
  },
 };
}

export class PythonPackageConflictError extends Error {
  readonly code = 'EPACKAGECONFLICT';
  readonly retryable = true;
  constructor() {
    super('Python package environment changed during installation; retry the command');
    this.name = 'PythonPackageConflictError';
  }
}

export function createPythonPackageManifestStore(options: { readonly maxBytes?: number; readonly maxEntries?: number; readonly maxScopeLength?: number } = {}): PythonPackageManifestStore & { dispose(): void } {
  const maxBytes = options.maxBytes ?? Infinity;
  const maxEntries = options.maxEntries ?? Infinity;
  const maxScopeLength = options.maxScopeLength ?? Infinity;
  for (const [name, value] of Object.entries({ maxBytes, maxEntries, maxScopeLength })) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`Python manifest ${name} must be a positive safe integer or Infinity`);
    }
  }
  const manifests = new Map<string, PythonPackageManifest>();
  let retainedBytes = 0;
  let revision = 0n;
  let disposed = false;
  const check = (scope: string, signal: AbortSignal): void => {
    signal.throwIfAborted();
    if (disposed) throw new Error('Python manifest store is disposed');
    if (typeof scope !== 'string' || !scope) throw new TypeError('Invalid Python manifest scope');
    if (scope.length > maxScopeLength) throw new RangeError('Python manifest scope budget exhausted');
  };
  return {
    async get(scope, { signal }) {
      check(scope, signal);
      const value = manifests.get(scope);
      return value ? { revision: value.revision, bytes: value.bytes.slice() } : undefined;
    },
    async compareAndSet(scope, expected, bytes, { signal }) {
      check(scope, signal);
      const current = manifests.get(scope);
      if (current?.revision !== expected) return false;
      if (!(bytes instanceof Uint8Array)) throw new TypeError('Python manifest must contain bytes');
      const nextBytes = retainedBytes - (current?.bytes.length ?? 0) + bytes.length;
      if (nextBytes > maxBytes || (!current && manifests.size >= maxEntries)) {
        throw new RangeError('Python manifest store budget exhausted');
      }
      manifests.set(scope, { revision: String(++revision), bytes: Uint8Array.from(bytes) });
      retainedBytes = nextBytes;
      return true;
    },
    dispose() { disposed = true; manifests.clear(); retainedBytes = 0; },
  };
}
