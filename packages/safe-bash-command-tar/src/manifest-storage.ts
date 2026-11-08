import { compareIdentity } from "@poe-code/safe-fs/contracts";
import type { CommandContext, FileStat } from "safe-bash-contracts";
import { ArchiveMetadataMap, type ArchiveMetadataFactory } from "safe-bash-io-engine/commands/archive/metadata";
import type { Entry } from "./format.js";

export interface SourceEntry { readonly path: string; readonly canonical: string; readonly stat: FileStat; readonly entry: Entry; readonly sourceLink?: string }
export interface ManifestBacking { readonly factory: ArchiveMetadataFactory; readonly ownsPath: (path: string) => boolean }
type Store<Value> = Map<string, Value> | ArchiveMetadataMap<Value>;
interface Binding { identity: string; name: string; previous?: string | undefined; next?: string | undefined }
interface Identity { head: string; tail: string }
interface StoredEntry extends Omit<SourceEntry, "stat"> { stat: Omit<FileStat, "identityScope">; scope?: number }

/** Preserve opaque namespace authorities separately from serialized file records. */
export class ManifestStorage implements AsyncIterable<SourceEntry> {
  private readonly scopes: Array<object | symbol> = [];
  private readonly scopeIds = new Map<object | symbol, number>();
  private readonly bindings: Store<Binding>;
  private readonly identities: Store<Identity>;
  private readonly records: ArchiveMetadataMap<StoredEntry> | undefined;
  readonly entries: SourceEntry[] = [];
  private count = 0;
  constructor(context: CommandContext, backing?: ManifestBacking) {
    this.bindings = backing ? new ArchiveMetadataMap(backing.factory, context.signal) : new Map();
    this.identities = backing ? new ArchiveMetadataMap(backing.factory, context.signal) : new Map();
    this.records = backing ? new ArchiveMetadataMap(backing.factory, context.signal) : undefined;
  }
  private scopeId(scope: object | symbol): number {
    let id = this.scopeIds.get(scope);
    if (id === undefined) { id = this.scopes.length; this.scopes.push(scope); this.scopeIds.set(scope, id); }
    return id;
  }
  async bind(path: string, stat: FileStat, entry: Entry): Promise<void> {
    const old = await this.bindings.get(path);
    if (old) {
      const identity = (await this.identities.get(old.identity))!;
      if (old.previous !== undefined) {
        const previous = (await this.bindings.get(old.previous))!;
        await this.bindings.set(old.previous, { ...previous, next: old.next });
      } else identity.head = old.next!;
      if (old.next !== undefined) {
        const next = (await this.bindings.get(old.next))!;
        await this.bindings.set(old.next, { ...next, previous: old.previous });
      } else identity.tail = old.previous!;
      if (old.next === undefined && old.previous === undefined) await this.identities.delete(old.identity);
      else await this.identities.set(old.identity, identity);
      await this.bindings.delete(path);
    }
    if (stat.type !== "file" || stat.identityScope === undefined || compareIdentity(stat, stat) !== "same") return;
    const identityKey = `${this.scopeId(stat.identityScope)}:${Number.isSafeInteger(stat.dev) && stat.dev! >= 0 && Number.isSafeInteger(stat.ino) && stat.ino! >= 0
      ? `native:${stat.dev}:${stat.ino}` : `opaque:${stat.opaqueIdentity}`}`;
    const identity = await this.identities.get(identityKey);
    if (identity) {
      const first = (await this.bindings.get(identity.head))!;
      entry.type = "1"; entry.linkname = first.name; entry.size = 0;
      const tail = (await this.bindings.get(identity.tail))!;
      await this.bindings.set(identity.tail, { ...tail, next: path });
      await this.bindings.set(path, { identity: identityKey, name: entry.name, previous: identity.tail });
      await this.identities.set(identityKey, { head: identity.head, tail: path });
    } else {
      await this.bindings.set(path, { identity: identityKey, name: entry.name });
      await this.identities.set(identityKey, { head: path, tail: path });
    }
  }
  async append(source: SourceEntry): Promise<void> {
    if (!this.records) { this.entries.push(source); return; }
    const { identityScope, ...stat } = source.stat;
    await this.records.set(String(this.count++), { ...source, stat, ...(identityScope === undefined ? {} : { scope: this.scopeId(identityScope) }) });
  }
  async *[Symbol.asyncIterator](): AsyncIterator<SourceEntry> {
    if (!this.records) { yield* this.entries; return; }
    for await (const source of this.records.values()) {
      const { scope, ...record } = source;
      yield { ...record, stat: { ...source.stat, ...(scope === undefined ? {} : { identityScope: this.scopes[scope]! }) } };
    }
  }
}
