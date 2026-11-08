import { PagedStorage, PagedStorageCache } from "@poe-code/safe-fs/storage";
import { closeDocumentResources } from "safe-bash-diff-engine/document";
import { host, ToolError, type Budget } from "safe-bash-diff-engine/shared";
import { pathOf } from "safe-bash-io-engine/internal";
import { FsError } from "safe-bash-contracts";

/** Variable records plus a two-tape merge index; only two records are decoded at once. */
class Rows<T> {
  readonly data: PagedStorage;
  readonly index: PagedStorage;
  length = 0;
  private base = 8;
  constructor(private readonly budget: Budget, cache: PagedStorageCache) {
    this.data = new PagedStorage(budget.context, 16, cache);
    this.index = new PagedStorage(budget.context, 16, cache);
  }
  async append(row: T): Promise<void> {
    const text = JSON.stringify(row), start = this.data.allocate(0);
    for (let offset = 0; offset < text.length;) {
      // JSON escapes lone surrogates; preserve pairs across encoding blocks.
      let end = Math.min(text.length, offset + 4096);
      const last = text.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff && end < text.length) end--;
      await this.data.append(new TextEncoder().encode(text.slice(offset, end)));
      offset = end;
    }
    const cell = new Uint8Array(24), view = new DataView(cell.buffer);
    view.setFloat64(0, start, true); view.setFloat64(8, this.data.allocate(0) - start, true);
    await this.index.append(cell); this.length++;
  }
  async read(position: number): Promise<T> {
    this.budget.step(); const pause = this.budget.checkpoint(); if (pause) await pause;
    const cell = await this.index.read(this.base + position * 24, 16), view = new DataView(cell.buffer, cell.byteOffset, cell.byteLength);
    const start = view.getFloat64(0, true), end = start + view.getFloat64(8, true), decoder = new TextDecoder();
    let text = "";
    for (let offset = start; offset < end; offset += 16384) text += decoder.decode(await this.data.read(offset, Math.min(16384, end - offset)), { stream: true });
    return JSON.parse(text + decoder.decode()) as T;
  }
  async mark(position: number): Promise<void> { await this.index.write(this.base + position * 24 + 16, new Uint8Array([1])); }
  async marked(position: number): Promise<boolean> { return (await this.index.read(this.base + position * 24 + 16, 1))[0] === 1; }
  async sort(compare: (left: T, right: T) => number): Promise<void> {
    let target = this.index.allocate(this.length * 24);
    for (let width = 1; width < this.length; width *= 2) {
      for (let start = 0; start < this.length; start += width * 2) {
        const middle = Math.min(start + width, this.length), end = Math.min(start + width * 2, this.length);
        let left = start, right = middle, a = left < middle ? await this.read(left) : undefined, b = right < end ? await this.read(right) : undefined;
        for (let position = start; position < end; position++) {
          this.budget.step(); const pause = this.budget.checkpoint(); if (pause) await pause;
          const takeLeft = b === undefined || a !== undefined && compare(a, b) <= 0;
          const source = takeLeft ? left : right;
          await this.index.write(target + position * 24, await this.index.read(this.base + source * 24, 24));
          if (takeLeft) a = ++left < middle ? await this.read(left) : undefined;
          else b = ++right < end ? await this.read(right) : undefined;
        }
      }
      const previous = this.base; this.base = target; target = previous;
    }
  }
  close(): Promise<void> { return closeDocumentResources([this.data, this.index]); }
}

interface Entry { readonly name: string; readonly side: "left" | "right" }
export interface DirectoryMatch { readonly left?: string; readonly right?: string }
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Replay matches backwards so the caller's depth-first stack retains GNU order. */
export async function* directoryMatches(left: string | undefined, right: string | undefined, budget: Budget,
  ignoreCase: boolean, maxEntries: number, excluded: (name: string) => Promise<boolean>, startingFile?: string): AsyncGenerator<DirectoryMatch> {
  const cache = new PagedStorageCache(16), matches = new Rows<DirectoryMatch>(budget, cache);
  let entries = new Rows<Entry>(budget, cache);
  const context = budget.context, key = (name: string) => ignoreCase ? name.replace(/[A-Z]/gu, letter => letter.toLowerCase()) : name;
  try {
    const restart = Symbol("prepare directory backing storage");
    for (let prepared = false;; prepared = true) {
      let admittedBytes = 0;
      try {
        for (const [side, path] of [["left", left], ["right", right]] as const) {
          if (path === undefined) continue;
          const absolute = pathOf(context, path);
          if (Number.isFinite(maxEntries) && (!Number.isSafeInteger(maxEntries) || maxEntries < 0))
            throw new FsError("EINVAL", { syscall: "readdir", path: absolute, message: "directory entry limit must be a nonnegative safe integer or Infinity" });
          const source = context.fs.iterateDirectory ? context.fs.iterateDirectory(absolute, { signal: context.signal })
            : await host(context, () => context.fs.readdir(absolute, { signal: context.signal, ...(Number.isFinite(maxEntries) ? { maxEntries } : {}) }));
          let count = 0;
          const iterator = Array.isArray(source) ? source[Symbol.iterator]() : source[Symbol.asyncIterator]();
          try { for (;;) {
            const item = await host(context, async () => iterator.next());
            if (item.done) break;
            const entry = item.value;
            if (++count > maxEntries) throw new FsError("EFBIG", { syscall: "readdir", path: absolute, message: "directory entry limit exceeded" });
            budget.step(); const pause = budget.checkpoint(); if (pause) await pause;
            if (!entry.name || entry.name === "." || entry.name === ".." || /[/\\\0\r\n\t]/u.test(entry.name)) throw new ToolError("unsafe directory entry name");
            if (!await excluded(entry.name)) {
              // Admit a conservative JSON/index upper bound before any cache eviction.
              // A restart occurs only for our own storage acquisition, never for EBUSY.
              admittedBytes += entry.name.length * 6 + 128;
              if (!prepared && admittedBytes > 128 * 1024) throw restart;
              await entries.append({ name: entry.name, side });
            }
          } } finally { await iterator.return?.(); }
        }
        break;
      } catch (error) {
        if (error !== restart) throw error;
        await entries.close();
        entries = new Rows<Entry>(budget, cache);
        await entries.data.prepare(); await entries.index.prepare();
      }
    }
    await entries.sort((a, b) => compareText(key(a.name), key(b.name)) || compareText(a.name, b.name) || compareText(a.side, b.side));
    let count = 0;
    for (let begin = 0; begin < entries.length;) {
      const group = key((await entries.read(begin)).name);
      let end = begin, leftCount = 0, rightCount = 0;
      while (end < entries.length) {
        const entry = await entries.read(end);
        if (key(entry.name) !== group) break;
        if (entry.side === "left") leftCount++; else rightCount++;
        end++;
      }
      count += Math.max(leftCount, rightCount);
      if (count > maxEntries) throw new ToolError("file/entry limit exceeded");
      if (startingFile === undefined || group >= key(startingFile)) {
        const next = async (position: number, side: Entry["side"], unmatched = false): Promise<{ position: number; name: string } | undefined> => {
          while (position < end) {
            const entry = await entries.read(position);
            if (entry.side === side && (!unmatched || !await entries.marked(position))) return { position, name: entry.name };
            position++;
          }
          return undefined;
        };
        let a = await next(begin, "left"), b = await next(begin, "right");
        while (a && b) {
          budget.step(); const pause = budget.checkpoint(); if (pause) await pause;
          const order = compareText(a.name, b.name);
          if (order === 0) {
            await matches.append({ left: a.name, right: b.name });
            await entries.mark(a.position); await entries.mark(b.position);
          }
          if (order <= 0) a = await next(a.position + 1, "left");
          if (order >= 0) b = await next(b.position + 1, "right");
        }
        a = await next(begin, "left", true); b = await next(begin, "right", true);
        while (a || b) {
          await matches.append({ ...(a ? { left: a.name } : {}), ...(b ? { right: b.name } : {}) });
          if (a) a = await next(a.position + 1, "left", true);
          if (b) b = await next(b.position + 1, "right", true);
        }
      }
      begin = end;
    }
    await matches.sort((a, b) => {
      const first = a.left ?? a.right!, second = b.left ?? b.right!;
      return compareText(key(first), key(second))
        || Number(a.left === undefined || a.right === undefined) - Number(b.left === undefined || b.right === undefined)
        || compareText(first, second);
    });
    for (let index = matches.length - 1; index >= 0; index--) yield await matches.read(index);
  } finally { await closeDocumentResources([entries, matches]); }
}
