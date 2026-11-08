import { UserError } from "toolcraft";
import type { AutomationDefinition } from "../types.js";

export function requireCommentPrefix(
  automation: Pick<AutomationDefinition, "name" | "prefix">,
  commentBody: string | undefined
): void {
  if (automation.prefix === undefined) {
    return;
  }

  if (commentBody === undefined) {
    throw new UserError(
      `Automation "${automation.name}" requires COMMENT_BODY when "prefix" frontmatter is set.`
    );
  }

  const prefixes = Array.isArray(automation.prefix) ? automation.prefix : [automation.prefix];

  if (prefixes.some((prefix) => commentBody.startsWith(prefix))) {
    return;
  }

  const expectedPrefixes =
    prefixes.length === 1
      ? `"${prefixes[0]}"`
      : `one of: ${prefixes.map((prefix) => `"${prefix}"`).join(", ")}`;

  throw new UserError(
    `Automation "${automation.name}" requires COMMENT_BODY to start with ${expectedPrefixes}.`
  );
}
