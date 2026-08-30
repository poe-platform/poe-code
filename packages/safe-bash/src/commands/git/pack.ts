import { inflatePackedFrame, type GitObject } from "./codec.js";
import { crc32 } from "./crc.js";
import { applyDelta } from "./delta.js";
import type { Session } from "./io.js";
import { GIT_LIMITS, demand } from "./limits.js";

interface Row {
  readonly oid: string;
  readonly offset: number;
  readonly crc: number;
  end: number;
  type: number;
  declared: number;
  compressed: number;
  base: Row | undefined;
  state: 0 | 1 | 2;
  depth: number;
  object: GitObject | undefined;
}

const packName = /^pack-([0-9a-f]{40})\.(pack|idx|rev|bitmap|keep|mtimes)$/;

export class PackCatalogue {
  readonly objects = new Map<string, GitObject>();
  private readonly owners = new Set<Buffer>();

  constructor(private readonly session: Session) { session.onFinish(() => this.close()); }

  close(): void {
    for (const body of this.owners) this.session.release(body);
    this.owners.clear();
    this.objects.clear();
  }

  private async retain(oid: string, object: GitObject): Promise<GitObject> {
    const prior = this.objects.get(oid);
    if (!prior) {
      this.owners.add(object.bytes);
      this.objects.set(oid, object);
      return object;
    }
    let same = prior.type === object.type && prior.bytes.length === object.bytes.length;
    for (let offset = 0; same && offset < object.bytes.length; offset += 4096) {
      const end = Math.min(object.bytes.length, offset + 4096);
      await this.session.step(end - offset);
      same = prior.bytes.subarray(offset, end).equals(object.bytes.subarray(offset, end));
    }
    demand(same, "conflicting Git packed duplicate object");
    this.session.release(object.bytes);
    return prior;
  }

  async admit(gitdir: string): Promise<void> {
    const session = this.session;
    const census = async (): Promise<string[]> => {
      const pairs = new Map<string, Set<string>>();
      const observations: string[] = [];
      for (const part of ["pack", "info"]) {
        const directory = session.path(gitdir, `objects/${part}`);
        const parent = await session.stat(directory);
        if (!parent) { observations.push(`${part}:absent`); continue; }
        demand(parent.type === "directory", "Git packed metadata directory required");
        observations.push(`${part}:directory`);
        for (const entry of await session.list(directory)) {
          const path = session.path(directory, entry.name);
          const stat = await session.stat(path);
          demand(entry.type === "file" && stat?.type === "file", "Git packed sidecar/link/type refused");
          demand(Number.isSafeInteger(stat.size) && stat.size >= 0, "invalid Git packed metadata size");
          const matched = part === "pack" ? packName.exec(entry.name) : null;
          if (matched) {
            const name = matched[1]!, kind = matched[2]!;
            if (!pairs.has(name)) { session.reserve(256); pairs.set(name, new Set()); }
            pairs.get(name)!.add(kind);
            demand(stat.size <= (kind === "pack" ? GIT_LIMITS.maxPackBytes : GIT_LIMITS.maxIndexBytes), "Git pack/idx/sidecar size exceeded");
          } else {
            demand(part === "pack" ? entry.name === "multi-pack-index" : entry.name === "packs" || entry.name === "commit-graph", "unsupported Git unknown/promisor packed storage");
            demand(stat.size <= GIT_LIMITS.maxIndexBytes, "Git inert sidecar size exceeded");
          }
          const observation = `${part}/${entry.name}:${stat.type}:${stat.size}:${stat.mode}:${stat.mtimeMs}:${stat.ctimeMs}`;
          session.reserve(observation.length * 2);
          observations.push(observation);
        }
      }
      for (const kinds of pairs.values()) demand(kinds.has("pack") && kinds.has("idx"), "Git incomplete pack/idx pair");
      demand(pairs.size <= GIT_LIMITS.maxPacks, "Git maxPacks exceeded");
      return session.sorted(observations);
    };
    const before = await census();
    session.observe(async () => {
      const after = await census();
      demand(after.length === before.length, "Git pack membership changed before output");
      for (let index = 0; index < before.length; index++) {
        await session.step(before[index]!.length + 1);
        demand(after[index] === before[index], "Git pack/sidecar observations changed before output");
      }
    });
    for (const row of before) {
      const match = /^pack\/(pack-([0-9a-f]{40})\.pack):/.exec(row);
      if (!match) continue;
      session.charge("maxPacks", 1);
      await this.readPack(session.path(gitdir, `objects/pack/${match[1]}`), match[2]!);
    }
  }

  private async index(bytes: Buffer, pack: Buffer): Promise<Row[]> {
    const session = this.session;
    demand(bytes.length >= 1072 && bytes.subarray(0, 8).equals(Buffer.from("ff744f6300000002", "hex")), "Git idx2 header/size refused");
    demand(await session.hash(bytes.subarray(0, -20)) === bytes.subarray(-20).toString("hex"), "Git idx checksum mismatch");
    demand(bytes.subarray(-40, -20).equals(pack.subarray(-20)), "Git idx pack checksum mismatch");
    const count = bytes.readUInt32BE(1028);
    session.charge("maxEntries", count);
    const base = 1072 + count * 28, extra = bytes.length - base;
    demand(Number.isSafeInteger(base) && extra >= 0 && extra % 8 === 0 && (count === 0 ? extra === 0 : extra / 8 <= count - 1), "Git idx extent refused");
    demand(pack.readUInt32BE(8) === count, "Git pack/index object count mismatch");
    const largeStart = 1032 + count * 28, largeCount = extra / 8;
    session.reserve(count * 256);
    const slots = session.allocate(largeCount);
    let buckets: Buffer | undefined;
    try {
      buckets = session.allocate(1024);
      const rows: Row[] = [];
      let previous = "";
      for (let index = 0; index < count; index++) {
        await session.step(40);
        const oid = bytes.subarray(1032 + index * 20, 1052 + index * 20).toString("hex");
        demand(oid > previous, "Git idx OID order/duplicate refused");
        previous = oid;
        const bucket = bytes[1032 + index * 20]!;
        buckets.writeUInt32BE(buckets.readUInt32BE(bucket * 4) + 1, bucket * 4);
        const value = bytes.readUInt32BE(1032 + count * 24 + index * 4);
        let offset = value;
        if (value >= 0x80000000) {
          const slot = value - 0x80000000;
          demand(slot < largeCount && slots[slot] === 0, "Git idx large slot invalid/duplicate");
          slots[slot] = 1;
          const large = bytes.readBigUInt64BE(largeStart + slot * 8);
          demand(large <= BigInt(Number.MAX_SAFE_INTEGER), "Git idx offset unsafe");
          offset = Number(large);
        }
        demand(offset >= 12 && offset < pack.length - 20, "Git idx offset outside pack");
        rows.push({ oid, offset, crc: bytes.readUInt32BE(1032 + count * 20 + index * 4), end: 0, type: 0, declared: 0, compressed: 0, base: undefined, state: 0, depth: 0, object: undefined });
      }
      for (let slot = 0; slot < largeCount; slot++) { await session.step(); demand(slots[slot] === 1, "unused Git idx large slot"); }
      let cumulative = 0;
      for (let bucket = 0; bucket < 256; bucket++) {
        await session.step();
        cumulative += buckets.readUInt32BE(bucket * 4);
        demand(bytes.readUInt32BE(8 + bucket * 4) === cumulative, "Git idx fanout mismatch");
      }
      return rows;
    } finally { session.release(slots); if (buckets) session.release(buckets); }
  }

  private async readPack(path: string, name: string): Promise<void> {
    const session = this.session;
    const pack = await session.readExact(path, GIT_LIMITS.maxPackBytes);
    let index: Buffer | undefined;
    try {
      demand(pack.length >= 32 && pack.subarray(0, 4).toString("ascii") === "PACK", "Git pack header refused");
      demand(pack.readUInt32BE(4) === 2 || pack.readUInt32BE(4) === 3, "Git pack version refused");
      const checksum = pack.subarray(-20).toString("hex");
      demand(await session.hash(pack.subarray(0, -20)) === checksum && name === checksum, "Git pack checksum/name mismatch");
      index = await session.readExact(path.slice(0, -5) + ".idx", GIT_LIMITS.maxIndexBytes);
      const rows = await this.index(index, pack);
      const byOid = new Map<string, Row>();
      const byOffset = new Map<number, Row>();
      const offsets: string[] = [];
      for (const row of rows) {
        await session.step(4);
        byOid.set(row.oid, row);
        byOffset.set(row.offset, row);
        offsets.push(row.offset.toString().padStart(10, "0"));
      }
      demand(byOffset.size === rows.length, "duplicate Git idx pack offset");
      const order = await session.sorted(offsets);
      const ordered: Row[] = [];
      for (const offset of order) { await session.step(); ordered.push(byOffset.get(Number(offset))!); }
      if (!ordered.length) demand(pack.length === 32, "Git empty pack trailing bytes");
      for (let position = 0; position < ordered.length; position++) {
        const row = ordered[position]!;
        demand(position !== 0 || row.offset === 12, "Git first pack entry offset mismatch");
        row.end = ordered[position + 1]?.offset ?? pack.length - 20;
        demand(await crc32(session, pack.subarray(row.offset, row.end)) === row.crc, "Git pack entry CRC mismatch");
        let cursor = row.offset;
        const byte = (): number => { demand(cursor < row.end, "truncated Git pack entry header"); return pack[cursor++]!; };
        let part = byte(), factor = 16;
        row.type = (part >>> 4) & 7;
        demand([1, 2, 3, 4, 6, 7].includes(row.type), "Git pack entry type refused");
        row.declared = part & 15;
        while (part >= 128) {
          await session.step();
          part = byte(); row.declared += (part & 127) * factor;
          demand(Number.isSafeInteger(row.declared) && row.declared <= GIT_LIMITS.maxObjectBytes, "Git pack declared size exceeded");
          factor *= 128; demand(Number.isSafeInteger(factor), "Git pack size overflow");
        }
        if (row.type === 6) {
          part = byte(); let distance = part & 127;
          while (part >= 128) {
            await session.step(); part = byte(); distance = (distance + 1) * 128 + (part & 127);
            demand(Number.isSafeInteger(distance), "Git OFS distance overflow");
          }
          row.base = byOffset.get(row.offset - distance);
          demand(distance > 0 && row.base && row.base.offset < row.offset, "Git OFS base is not earlier entry");
        } else if (row.type === 7) {
          demand(cursor + 20 <= row.end, "truncated Git REF base");
          row.base = byOid.get(pack.subarray(cursor, cursor + 20).toString("hex"));
          cursor += 20;
          demand(row.base, "Git REF base outside same pack");
        }
        row.compressed = cursor;
      }
      for (const target of ordered) {
        const pending: Row[] = [];
        let current = target;
        while (current.state !== 2) {
          await session.step();
          demand(current.state === 0, "Git delta cycle");
          current.state = 1; pending.push(current);
          demand(pending.length <= GIT_LIMITS.maxDeltaDepth + 1, "Git delta depth exceeded");
          if (!current.base) break;
          current = current.base;
        }
        while (pending.length) {
          const row = pending.pop()!;
          row.depth = row.base ? row.base.depth + 1 : 0;
          demand(row.depth <= GIT_LIMITS.maxDeltaDepth, "Git delta intrinsic depth exceeded");
          const inflated = await inflatePackedFrame(session, pack.subarray(row.compressed, row.end), row.declared);
          let object: GitObject | undefined;
          let transferred = false;
          try {
            if (row.base) {
              demand(row.base.state === 2 && row.base.object, "Git delta base not verified");
              object = await applyDelta(session, row.base.object, inflated, row.oid);
            } else {
              const type = (["commit", "tree", "blob", "tag"] as const)[row.type - 1]!;
              demand(await session.hash(inflated, type) === row.oid, "Git packed object hash mismatch");
              object = { type, bytes: inflated };
            }
            row.object = await this.retain(row.oid, object);
            transferred = true; row.state = 2;
          } finally {
            if (row.base || !transferred) session.release(inflated);
            if (object && !transferred) session.release(object.bytes);
          }
        }
      }
      await session.observeExact(path, GIT_LIMITS.maxPackBytes, pack);
      await session.observeExact(path.slice(0, -5) + ".idx", GIT_LIMITS.maxIndexBytes, index);
    } finally { session.release(pack); if (index) session.release(index); }
  }
}
