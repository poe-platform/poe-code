import { RegexExecutionError, type RegexSession } from "../regex-execution/portable.js";
import type { GlobDescriptor, Row } from "../regex-execution/protocol.js";
import { SearchError } from "./options.js";

export class Glob {
  constructor(readonly source: string, readonly insensitive = false, readonly literalUnclosedClass = false) {}
  async matches(path: string, directory: boolean, session: RegexSession, ancestors = true): Promise<boolean> {
    return (await matchGlobs([this], [{ path, directory, ancestors }], session))[0]!;
  }
}

export async function matchGlobs(globs: readonly Glob[], candidates: readonly { readonly path: string; readonly directory: boolean; readonly ancestors?: boolean }[], session: RegexSession): Promise<boolean[]> {
  if (candidates.length && candidates.length !== globs.length) throw new SearchError("invalid glob candidate count");
  const results: boolean[] = [];
  for (let offset = 0; offset < globs.length;) {
    const batch: Glob[] = [];
    const rows: Row[] = [];
    let bytes = 128;
    while (offset < globs.length && batch.length < 128) {
      const glob = globs[offset]!;
      const candidate = candidates[offset];
      const size = 48 + glob.source.length * 2 + (candidate ? 32 + candidate.path.length * 2 : 0);
      if (batch.length && bytes + size > 64 * 1024) break;
      batch.push(glob);
      if (candidate) rows.push({ bytes: Buffer.from(candidate.path, "utf16le"), all: false, terminated: true, directory: candidate.directory, ancestors: candidate.ancestors ?? true });
      bytes += size;
      offset++;
    }
    const descriptor: GlobDescriptor = {
      kind: "glob", patterns: batch.map(glob => glob.source),
      globOptions: batch.map(glob => ({ insensitive: glob.insensitive, literalUnclosedClass: glob.literalUnclosedClass })),
    };
    try { results.push(...(await session.run(descriptor, rows)).map(result => result.length > 0)); }
    catch (error) {
      if (error instanceof RegexExecutionError && error.code === "MATCH") throw new SearchError(error.message);
      throw error;
    }
  }
  return results;
}

export interface IgnoreRule { readonly base: string; readonly priority: number; readonly include: boolean; readonly glob: Glob }

export async function ignoreRules(contents: string, base: string, priority: number, session: RegexSession): Promise<IgnoreRule[]> {
  const rules: IgnoreRule[] = [];
  for (let source of contents.split(/\r?\n/u)) {
    if (!source || source.startsWith("#")) continue;
    while (source.endsWith(" ")) {
      let backslashes = 0;
      for (let offset = source.length - 2; offset >= 0 && source[offset] === "\\"; offset--) backslashes++;
      if (backslashes % 2) break;
      source = source.slice(0, -1);
    }
    if (!source) continue;
    const include = source.startsWith("!");
    if (include) source = source.slice(1);
    if (source) rules.push({ base, priority, include, glob: new Glob(source, false, true) });
    if (rules.length > 10000) break;
  }
  await matchGlobs(rules.map(rule => rule.glob), [], session);
  if (rules.length > 10000) throw new SearchError("ignore rule count limit exceeded");
  return rules;
}
