import { dirname, readBytes, resolvePath, type ByteSource, type CommandContext, type FileStat } from "../../contracts/index.js";
import { escapeText } from "../../escaping.js";
import { encodeEntry, type Entry } from "./format.js";
import { Budget, checkPath, display, fail, fileSource, hasIdentity, maybeStat, operation, sameIdentity, vfsPath } from "./internal.js";
import { Exclusions, type TarOptions } from "./options.js";
import { quoteName } from "./listing.js";
import { recordPadding } from "./stream.js";
import { TransformedNames } from "./transform.js";

interface SourceEntry { readonly path: string; readonly stat: FileStat; readonly entry: Entry }

function safeName(name: string): string {
  const relative = name.replace(/^\/+/u, "");
  const components = relative.split("/");
  return components.slice(components.lastIndexOf("..") + 1).join("/") || ".";
}

export async function manifest(context: CommandContext, options: TarOptions, budget: Budget): Promise<{ entries: SourceEntry[]; output?: string; outputStat?: FileStat }> {
  const exclusions = new Exclusions(options.excludes, budget.limits.maxPatternSteps);
  const transformedNames = new TransformedNames(context, options.transforms, budget.limits);
  const entries: SourceEntry[] = [];
  let archiveBytes = 1024;
  let output: string | undefined;
  let outputStat: FileStat | undefined;
  if (options.archive !== "-") {
    const path = vfsPath(context.cwd, options.archive);
    outputStat = await maybeStat(context, path);
    if (outputStat && outputStat.type !== "file") fail("output archive must be a regular file, not a symlink or directory");
    if (outputStat && !hasIdentity(outputStat)) fail("cannot safely replace an archive with unknown backing identity");
    const parent = await operation(context, () => context.fs.realpath(dirname(path), { signal: context.signal }));
    output = resolvePath(parent, path.slice(path.lastIndexOf("/") + 1));
  }
  const identities = new Map<object | symbol, Map<string, Map<string, SourceEntry>>>();
  const bindings = new Map<string, { scope: object | symbol; key: string }>();
  const visit = async (path: string, name: string, depth: number, explicit: boolean, ancestors: readonly string[]): Promise<void> => {
    checkPath(name, budget.limits);
    if (depth > budget.limits.maxDepth) fail("source traversal depth limit exceeded");
    await budget.member();
    if (exclusions.matches(name)) return;
    let stat = await operation(context, () => context.fs.lstat(path, { signal: context.signal }));
    if (stat.type === "symlink" && options.dereference) {
      path = await operation(context, () => context.fs.realpath(path, { signal: context.signal }));
      stat = await operation(context, () => context.fs.lstat(path, { signal: context.signal }));
    }
    const canonical = stat.type === "symlink" ? path : await operation(context, () => context.fs.realpath(path, { signal: context.signal }));
    if (stat.type === "directory" && ancestors.includes(canonical)) fail(`source directory cycle: ${display(name)}`);
    if (output && (canonical === output || (outputStat && sameIdentity(stat, outputStat)))) {
      if (explicit) fail(`input is the output archive: ${display(name)}`);
      await budget.output(`tar: ${escapeText(display(name), "diagnostic")}: file is the archive; not included\n`, true);
      return;
    }
    if (stat.type !== "file" && stat.type !== "directory" && stat.type !== "symlink") fail(`unsupported source type: ${display(name)}`);
    const rawName = stat.type === "directory" && !name.endsWith("/") ? `${name}/` : name;
    const transformedName = options.transforms.length ? await transformedNames.apply(rawName) : rawName;
    if (!transformedName || transformedName.split("/").includes("..")) fail(`unsafe transformed member name: ${display(transformedName)}`);
    const entry: Entry = {
      name: stat.type === "directory" && !transformedName.endsWith("/") ? `${transformedName}/` : transformedName,
      type: stat.type === "directory" ? "5" : stat.type === "symlink" ? "2" : "0",
      linkname: "", size: stat.type === "file" ? stat.size : 0,
      mode: options.metadata.mode ?? (stat.mode & 0o7777), uid: options.metadata.uid ?? stat.uid ?? 0, gid: options.metadata.gid ?? stat.gid ?? 0,
      mtime: options.format === "ustar" ? Math.floor(options.metadata.mtime ?? stat.mtimeMs / 1000) : options.metadata.mtime ?? stat.mtimeMs / 1000,
    };
    if (options.format === "pax") entry.atime = stat.atimeMs / 1000;
    if (stat.type === "symlink") {
      if ((stat.nlink ?? 1) > 1) fail("hardlinked symbolic-link sources are unsupported");
      if (!context.fs.readlink) fail("filesystem does not support readlink");
      entry.linkname = await operation(context, () => context.fs.readlink!(path, { signal: context.signal }));
      if (options.transforms.length) entry.linkname = await transformedNames.apply(entry.linkname);
      checkPath(entry.linkname, budget.limits);
    }
    const archivePath = resolvePath("/", entry.name);
    const binding = bindings.get(archivePath);
    if (binding) {
      identities.get(binding.scope)?.get(binding.key)?.delete(archivePath);
      bindings.delete(archivePath);
    }
    if (stat.type === "file") {
      if (outputStat && !hasIdentity(stat)) fail("cannot replace an existing archive when a source has unknown backing identity");
      if ((stat.nlink ?? 1) > 1 && !hasIdentity(stat)) fail(`cannot preserve hardlinks without complete backing identity: ${display(name)}`);
      if (hasIdentity(stat)) {
        let scope = identities.get(stat.identityScope!);
        if (!scope) { scope = new Map(); identities.set(stat.identityScope!, scope); }
        const key = `${stat.dev}:${stat.ino}`;
        let paths = scope.get(key);
        if (!paths) { paths = new Map(); scope.set(key, paths); }
        const previous = paths.values().next().value;
        if (previous) {
          entry.type = "1"; entry.linkname = previous.entry.name; entry.size = 0;
        }
        paths.set(archivePath, { path, stat, entry });
        bindings.set(archivePath, { scope: stat.identityScope!, key });
      }
      if (entry.type === "0" && (!context.fs.openReadFile || !hasIdentity(stat))) fail(`cannot safely read source without retained backing identity: ${display(name)}`);
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > budget.limits.maxEntryBytes) fail("entry byte limit exceeded");
      if (entry.size > budget.limits.maxTotalBytes - budget.totalBytes) fail("total payload byte limit exceeded");
      budget.totalBytes += entry.size;
    }
    if (options.metadata.preserveAtime && (entry.type === "0" || entry.type === "5")) {
      const capabilities = await operation(context, () => context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities);
      if (!context.fs.utimes || capabilities.timestamps === false) fail("filesystem does not support preserving source access times");
    }
    const headers = encodeEntry(entry, budget.limits);
    archiveBytes += headers.reduce((size, header) => size + header.length, 0) + Math.ceil(entry.size / 512) * 512;
    if (options.format === "ustar" && headers.length > 1) fail(`metadata requires PAX format: ${display(name)}`);
    entries.push({ path, stat, entry });
    if (stat.type === "directory" && options.recursion) {
      const maxEntries = budget.limits.maxMembers - budget.members;
      const children = await operation(context, () => context.fs.readdir(path, { signal: context.signal,
        ...(Number.isFinite(maxEntries) ? { maxEntries } : {}) }));
      if (children.length > budget.limits.maxMembers - budget.members) fail("member/header limit exceeded");
      if (options.sort === "name") children.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
      let cache = false;
      if (options.excludeCaches && children.some(child => child.name === "CACHEDIR.TAG")) {
        const tag = resolvePath(canonical, "CACHEDIR.TAG");
        const tagStat = await operation(context, () => context.fs.stat(tag, { signal: context.signal }));
        if (tagStat.type === "file") {
          const signature = Buffer.from("Signature: 8a477f597d28d172789f06886806bc55");
          let offset = 0;
          for await (const chunk of readBytes(fileSource(context, tag, budget.limits), context.signal)) {
            const length = Math.min(chunk.length, signature.length - offset);
            if (!Buffer.from(chunk.subarray(0, length)).equals(signature.subarray(offset, offset + length))) break;
            offset += length;
            if (offset === signature.length) { cache = true; break; }
          }
        }
      }
      for (const child of children) {
        if (!child.name || child.name === "." || child.name === ".." || /[/\0]/u.test(child.name)) fail("invalid filesystem directory entry");
        if (cache && child.name !== "CACHEDIR.TAG") continue;
        await visit(resolvePath(canonical, child.name), `${rawName}${child.name}`, depth + 1, false, [...ancestors, canonical]);
      }
    }
  };
  for (const operand of options.operands) {
    const base = await operation(context, () => context.fs.stat(operand.cwd, { signal: context.signal }));
    if (base.type !== "directory") fail(`not a directory: ${display(operand.cwd)}`);
    if (operand.name.startsWith("/")) await budget.output("tar: removing leading '/' from member names\n", true);
    if (operand.name.split("/").includes("..")) await budget.output("tar: removing member-name prefix through '..'\n", true);
    await visit(vfsPath(operand.cwd, operand.name), safeName(operand.name), 0, true, []);
  }
  if (options.mode === "c") recordPadding(archiveBytes, options.recordSize, budget.limits.maxArchiveBytes);
  return { entries, ...(output === undefined ? {} : { output }), ...(outputStat === undefined ? {} : { outputStat }) };
}

function checkSource(source: SourceEntry, current: FileStat): void {
  if (current.type !== source.stat.type || (source.stat.type !== "directory" && (current.size !== source.stat.size || current.mtimeMs !== source.stat.mtimeMs
    || current.ctimeMs !== source.stat.ctimeMs)) || (hasIdentity(source.stat) && !sameIdentity(source.stat, current))) fail(`source changed while archiving: ${display(source.entry.name)}`);
}

async function unchanged(context: CommandContext, source: SourceEntry): Promise<void> {
  checkSource(source, await operation(context, () => context.fs.lstat(source.path, { signal: context.signal })));
  if (source.stat.type === "symlink") {
    const target = await operation(context, () => context.fs.readlink!(source.path, { signal: context.signal }));
    if (target !== source.entry.linkname) fail("source symlink changed while archiving");
  }
}

export async function* createArchive(context: CommandContext, entries: readonly SourceEntry[], options: TarOptions, budget: Budget): ByteSource {
  let headers = 0;
  for (const source of entries) {
    await unchanged(context, source);
    const encoded = encodeEntry(source.entry, budget.limits);
    headers += encoded.length > 1 ? 2 : 1;
    if (headers > budget.limits.maxMembers) fail("member/header limit exceeded");
    for (const chunk of encoded) if (chunk.length) yield chunk;
    if (options.verbose) await budget.output(`${quoteName(source.entry.name, options.quotingStyle)}\n`, options.archive === "-");
    if (source.entry.type === "0") {
      let bytes = 0;
      if (!context.fs.openReadFile || !hasIdentity(source.stat)) fail(`cannot safely read source without retained backing identity: ${display(source.entry.name)}`);
      // Await acquisition itself so cancellation cannot abandon a newly opened handle.
      const handle = await context.fs.openReadFile(source.path, { signal: context.signal });
      try {
        const opened = await operation(context, () => handle.stat({ signal: context.signal }));
        if (!sameIdentity(source.stat, opened)) fail(`source changed while archiving: ${display(source.entry.name)}`);
        checkSource(source, opened);
        while (true) {
          const chunk = await operation(context, () => handle.read(bytes, budget.limits.chunkSize, { signal: context.signal }));
          if (!chunk.length) break;
          if (chunk.length > source.entry.size - bytes) fail(`source grew while archiving: ${display(source.entry.name)}`);
          bytes += chunk.length;
          yield chunk;
        }
        checkSource(source, await operation(context, () => handle.stat({ signal: context.signal })));
      } finally {
        await handle.close();
      }
      if (bytes !== source.entry.size) fail(`source shrank while archiving: ${display(source.entry.name)}`);
      await unchanged(context, source);
      const padding = (512 - bytes % 512) % 512;
      if (padding) yield new Uint8Array(padding);
    }
  }
  if (options.metadata.preserveAtime) {
    const restored = new Set<string>();
    for (const source of entries) {
      if ((source.entry.type !== "0" && source.entry.type !== "5") || restored.has(source.path)) continue;
      await unchanged(context, source);
      await operation(context, () => context.fs.utimes!(source.path, source.stat.atimeMs, source.stat.mtimeMs, { signal: context.signal }));
      restored.add(source.path);
    }
  }
  yield new Uint8Array(1024);
}
