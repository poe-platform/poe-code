import path from "node:path";
import ignoreModule from "ignore";
import type { Ignore } from "ignore";
import type { AgentStashContext, AgentStashScope } from "./types.js";
import { assertNoSymlinkAncestors, assertNotSymlink, readFileIfExists } from "./fs-utils.js";

export interface IgnoreMatcher {
  ignores(relativePath: string): boolean;
}

export async function loadIgnoreMatcher(ctx: AgentStashContext, scope: AgentStashScope): Promise<IgnoreMatcher> {
  const matcher: Ignore = (ignoreModule as unknown as () => Ignore)();
  const ignorePath =
    scope === "project"
      ? path.join(ctx.cwd, ".agent-stashignore")
      : path.join(ctx.homeDir, ".agent-stash", "ignore");
  await assertNoSymlinkAncestors(ctx.fs, ignorePath, scope === "project" ? ctx.cwd : ctx.homeDir);
  await assertNotSymlink(ctx.fs, ignorePath);
  const content = await readFileIfExists(ctx.fs, ignorePath);
  if (content) {
    matcher.add(content);
  }
  return {
    ignores(relativePath) {
      return matcher.ignores(relativePath);
    }
  };
}
