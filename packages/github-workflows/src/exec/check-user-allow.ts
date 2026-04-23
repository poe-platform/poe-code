import { UserError } from "agent-kit";
import type { AutomationDefinition } from "../types.js";

export function checkUserAllow(
  automation: Pick<AutomationDefinition, "name" | "allow">,
  commentAuthorAssociation: string | undefined
): void {
  if (automation.allow === undefined) {
    return;
  }

  if (commentAuthorAssociation === undefined) {
    throw new UserError(
      `Automation "${automation.name}" requires COMMENT_AUTHOR_ASSOCIATION when "allow" frontmatter is set.`
    );
  }

  if (automation.allow.includes(commentAuthorAssociation)) {
    return;
  }

  throw new UserError(
    `Automation "${automation.name}" does not allow COMMENT_AUTHOR_ASSOCIATION "${commentAuthorAssociation}". Allowed values: ${automation.allow.join(", ")}.`
  );
}
