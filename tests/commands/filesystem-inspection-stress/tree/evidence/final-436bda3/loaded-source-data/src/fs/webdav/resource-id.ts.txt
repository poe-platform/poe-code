import type { EntryComparison, FileStat, FileSystem, FsOptions } from "../../contracts/filesystem.js";
import type { EntryAuthority, EntryView } from "../mount/comparison.js";
import { FsError } from "../../contracts/errors.js";

export interface OwnedWebDavEntry {
  readonly storage: object;
  readonly resource: object;
}

export interface OwnedWebDavResource extends OwnedWebDavEntry {
  readonly identifier: string;
}

const responses = new WeakMap<Response, ReadonlyMap<string, OwnedWebDavResource>>();
const observations = new WeakMap<FileStat, { filesystem: FileSystem; path: string; entry: OwnedWebDavResource }>();
export function registerOwnedResourceResponse(response: Response, entries: ReadonlyMap<string, OwnedWebDavResource>): void {
  if (responses.has(response)) throw new TypeError("resource response already registered");
  responses.set(response, new Map(entries));
}

export function recordOwnedResourceStat(response: Response, filesystem: FileSystem, path: string, stat: FileStat): void {
  const entry = responses.get(response)?.get(path);
  if (entry) observations.set(stat, { filesystem, path, entry });
}

export function getOwnedWebDavEntry(view: EntryView): OwnedWebDavEntry | undefined {
  const observation = observations.get(view.stat);
  return observation?.filesystem === view.filesystem && observation.path === view.path
    ? observation.entry : undefined;
}

export function ownedResponseIdentifier(response: Response, path: string): string | undefined {
  return responses.get(response)?.get(path)?.identifier;
}

type ResourceQuery = (path: string, options: FsOptions) => Promise<string | undefined>;
const queries = new WeakMap<FileSystem, ResourceQuery>();
const comparisons = new WeakMap<FileSystem, NonNullable<FileSystem["compareEntry"]>>();
const callbacks = new WeakMap<FileSystem, NonNullable<FileSystem["compareEntry"]>>();

export function registerResourceQuery(filesystem: FileSystem, query: ResourceQuery,
  baseComparison: NonNullable<FileSystem["compareEntry"]>, callback?: NonNullable<FileSystem["compareEntry"]>): void {
  comparisons.set(filesystem, baseComparison);
  if (callback) callbacks.set(filesystem, callback);
  queries.set(filesystem, async (path, options) => {
    options.signal?.throwIfAborted();
    const identifier = await query(path, options);
    options.signal?.throwIfAborted();
    return identifier;
  });
}

export function resourceIdentifier(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]+$/.test(value) || /%(?![0-9A-Fa-f]{2})/.test(value)
    || /[^\x21-\x7e]/.test(value)) throw new Error("invalid DAV:resource-id URI");
  new URL(value);
  if (/^urn:uuid:/i.test(value)) {
    if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error("invalid DAV:resource-id UUID");
    }
    return value.toLowerCase();
  }
  return value;
}

export const compareWebDavResources: EntryAuthority = async (own, peer, options): Promise<EntryComparison> => {
  options.signal?.throwIfAborted();
  let explicit = false;
  let answer: EntryComparison = "unknown";
  const visited = new Set<FileSystem>();
  for (const [left, right] of [[own, peer], [peer, own]] as const) {
    const baseComparison = comparisons.get(left.filesystem);
    if (!baseComparison) continue;
    const method = left.filesystem.compareEntry;
    const comparison = method === baseComparison ? callbacks.get(left.filesystem) : method;
    if (method === baseComparison && !comparison) continue;
    explicit = true;
    if (!comparison || visited.has(left.filesystem)) continue;
    visited.add(left.filesystem);
    options.signal?.throwIfAborted();
    const result = await comparison.call(left.filesystem, left.path, right.filesystem, right.path, options);
    options.signal?.throwIfAborted();
    if (result !== "same" && result !== "distinct" && result !== "unknown") {
      throw new FsError("EIO", { path: own.path, dest: peer.path, message: "invalid explicit WebDAV comparison" });
    }
    if (result === "unknown") continue;
    if (answer !== "unknown" && answer !== result) {
      throw new FsError("EIO", { path: own.path, dest: peer.path, message: "conflicting explicit WebDAV comparisons" });
    }
    answer = result;
  }
  const builtin = await compareProtocolEntries(own, peer, options);
  if (builtin === "same" && answer === "distinct") {
    throw new FsError("EIO", { path: own.path, dest: peer.path, message: "explicit WebDAV comparison contradicts built-in identity" });
  }
  if (builtin === "same") return "same";
  return explicit ? answer : builtin;
};

async function compareProtocolEntries(own: EntryView, peer: EntryView, options: FsOptions): Promise<EntryComparison> {
  const left = getOwnedWebDavEntry(own);
  const right = getOwnedWebDavEntry(peer);
  const ownQuery = queries.get(own.filesystem);
  const peerQuery = queries.get(peer.filesystem);
  if (!ownQuery || !peerQuery) return "unknown";
  options.signal?.throwIfAborted();
  const ownId = await ownQuery(own.path, options);
  options.signal?.throwIfAborted();
  const peerId = await peerQuery(peer.path, options);
  options.signal?.throwIfAborted();
  if (ownId === undefined || peerId === undefined) return "unknown";
  if (left && right) {
    const same = left.storage === right.storage && left.resource === right.resource;
    if (same !== (ownId === peerId)) throw new FsError("EIO", { path: own.path, dest: peer.path, message: "conflicting owned and protocol WebDAV identities" });
  }
  return ownId === peerId ? "same" : "distinct";
}
