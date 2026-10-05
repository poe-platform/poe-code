import { bytesFrom } from "safe-bash-byte-engine";
import { parseIgnorePatterns } from "safe-bash-regex-engine/glob";
import { RegexExecutionError, type RegexSession } from "safe-bash-regex-engine/execution/portable";
import type { GlobDescriptor, Row } from "safe-bash-regex-engine/execution/protocol";
import { SearchError } from "./options.js";

export class Glob {
  readonly basenameOnly: boolean;
  constructor(readonly source: string, readonly insensitive = false, readonly literalUnclosedClass = false) {
    const pattern = source.endsWith("/") ? source.slice(0, -1) : source;
    this.basenameOnly = pattern.length > 0 && !pattern.includes("/") && !pattern.includes("**")
      && !pattern.includes("\\") && !pattern.includes("[") && !pattern.includes("{");
  }
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
      let path = candidate?.path;
      // Plain basename globs cannot match across separators. Keep complex globs,
      // ancestor matching and non-ASCII validation on the full-path engine route.
      if (path !== undefined && candidate!.ancestors === false && glob.basenameOnly) {
        let ascii = true;
        for (let index = 0; index < path.length; index++) {
          if (path.charCodeAt(index) > 127) { ascii = false; break; }
        }
        if (ascii) path = path.slice(path.lastIndexOf("/") + 1);
      }
      const size = 48 + glob.source.length * 2 + (candidate ? 32 + path!.length * 2 : 0);
      if (batch.length && bytes + size > 64 * 1024) break;
      batch.push(glob);
      if (candidate) rows.push({ bytes: bytesFrom(path!, "utf16le"), all: false, terminated: true, directory: candidate.directory, ancestors: candidate.ancestors ?? true });
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
  const rules = parseIgnorePatterns(contents).map(({pattern, include}) => ({base, priority, include, glob: new Glob(pattern, false, true)}));
  await matchGlobs(rules.map(rule => rule.glob), [], session);
  return rules;
}
