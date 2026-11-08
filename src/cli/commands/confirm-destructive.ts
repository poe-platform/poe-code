import { confirmOrCancel } from "toolcraft-design";
import type { ScopedLogger } from "../logger.js";
import { OperationCancelledError } from "../errors.js";
import { requireInteractiveStdin } from "./shared.js";

export interface DestructiveConfirmation {
  logger: ScopedLogger;
  flags: { dryRun: boolean; assumeYes: boolean };
  /** Command wording used in the danger copy and the non-interactive error, e.g. "worktree remove wt". */
  action: string;
  /** Blast radius: everything the executor is about to destroy. */
  summary: readonly string[];
  message: string;
}

/**
 * Gate placed in front of a destructive executor. Prints the blast radius, then
 * requires either --yes or an interactive confirmation. --dry-run previews never
 * prompt, so the safe preview path stays usable without a TTY.
 */
export async function confirmDestructive(confirmation: DestructiveConfirmation): Promise<void> {
  if (confirmation.flags.dryRun || confirmation.flags.assumeYes) {
    return;
  }

  confirmation.logger.warn(`Danger: ${confirmation.action} cannot be undone.`);
  for (const line of confirmation.summary) {
    confirmation.logger.warn(`- ${line}`);
  }

  requireInteractiveStdin(
    `${confirmation.action} requires --yes when running without an interactive TTY.`
  );

  const confirmed = await confirmOrCancel({
    message: confirmation.message,
    initialValue: false
  });
  if (!confirmed) {
    throw new OperationCancelledError();
  }
}
