import { bytesFrom } from "safe-bash-byte-engine";
import { parseIgnorePatterns } from "safe-bash-regex-engine/glob";
import { RegexExecutionError, type RegexSession } from "safe-bash-regex-engine/execution/portable";
import type { GlobDescriptor, Row } from "safe-bash-regex-engine/execution/protocol";
import { SearchError } from "./options.js";

export class Glob {
  readonly basenameOnly: boolean;
  private readonly literalEdges?: { prefix: string; suffix: string; anchored: boolean };
  constructor(readonly source: string, readonly insensitive = false, readonly literalUnclosedClass = false) {
    const pattern = source.endsWith("/") ? source.slice(0, -1) : source;
    // Positive literal character classes cannot consume a separator. Negated
    // classes, ranges and named classes may, so keep their full paths.
    const separatorClass = pattern.includes("[") && ["!", "^", "-", ":"].some(character => pattern.includes(character));
    this.basenameOnly = pattern.length > 0 && !pattern.includes("/") && !pattern.includes("**")
      && !pattern.includes("\\") && !separatorClass && !pattern.includes("{");
    // Only simple ASCII patterns have literal edges we can safely recognize
    // without duplicating the glob parser (escapes, classes and braces included).
    if ([...pattern].every(character => character.charCodeAt(0) < 128 && !"\\[]{}".includes(character))) {
      const anchored = source.startsWith("/") || source.slice(0, -1).includes("/");
      const body = pattern.startsWith("/") ? pattern.slice(1) : pattern;
      let first = 0;
      while (first < body.length && body[first] !== "*" && body[first] !== "?") first++;
      let last = body.length;
      while (last > first && body[last - 1] !== "*" && body[last - 1] !== "?") last--;
      const prefix = body.slice(0, first);
      // A **/ segment can consume zero directories, including its separator.
      const suffix = body.slice(Math.max(last, body.lastIndexOf("/") + 1));
      // Unanchored ** may consume separators; basename trimming is unsafe.
      if (anchored || this.basenameOnly) this.literalEdges = {
        prefix: insensitive ? prefix.toLowerCase() : prefix,
        suffix: insensitive ? suffix.toLowerCase() : suffix,
        anchored,
      };
    }
  }
  /** Conservative rejection only, after engine validation and without ancestors. */
  mayMatch(path: string, directory: boolean): boolean {
    if (!this.literalEdges) return true;
    // Preserve the engine's scalar validation and ASCII case-folding errors.
    for (let index = 0; index < path.length; index++) if (path.charCodeAt(index) > 127) return true;
    if (!directory && this.source.endsWith("/")) return false;
    const { prefix, suffix, anchored } = this.literalEdges;
    const candidate = anchored ? path : path.slice(path.lastIndexOf("/") + 1);
    const folded = this.insensitive ? candidate.toLowerCase() : candidate;
    return folded.startsWith(prefix) && folded.endsWith(suffix);
  }
  /** Conservative subtree rejection for ASCII paths after engine validation. */
  mayMatchDescendant(directory: string): boolean {
    const edges = this.literalEdges;
    if (!edges?.anchored || !directory) return true;
    for (let index = 0; index < directory.length; index++) if (directory.charCodeAt(index) > 127) return true;
    const candidate = this.insensitive ? directory.toLowerCase() : directory;
    return candidate.startsWith(edges.prefix) || edges.prefix.startsWith(`${candidate}/`);
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
