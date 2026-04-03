import { UserError } from "@poe-code/cmdkit";
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

  if (commentBody.startsWith(automation.prefix)) {
    return;
  }

  throw new UserError(
    `Automation "${automation.name}" requires COMMENT_BODY to start with "${automation.prefix}".`
  );
}
