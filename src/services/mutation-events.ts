import type { ScopedLogger } from "../cli/logger.js";
import type {
  MutationDetails,
  MutationObservers,
  MutationOutcome
} from "@poe-code/config-mutations";

export function createMutationReporter(
  logger: ScopedLogger
): MutationObservers {
  return {
    onComplete(details, outcome) {
      logger.verbose(formatMutationMessage(details, outcome));
    },
    onError(details, error) {
      logger.error(
        `${details.label} failed: ${describeError(error)}`
      );
    }
  };
}

export function combineMutationObservers(
  ...observers: Array<MutationObservers | undefined>
): MutationObservers | undefined {
  const active = observers.filter(
    (observer): observer is MutationObservers => observer != null
  );
  if (active.length === 0) {
    return undefined;
  }
  return {
    onStart(details) {
      for (const observer of active) {
        observer.onStart?.(details);
      }
    },
    onComplete(details, outcome) {
      for (const observer of active) {
        observer.onComplete?.(details, outcome);
      }
    },
    onError(details, error) {
      for (const observer of active) {
        observer.onError?.(details, error);
      }
    }
  };
}

function formatMutationMessage(
  details: MutationDetails,
  outcome: MutationOutcome
): string {
  const status = describeOutcome(outcome);
  return `${details.label}: ${status}`;
}

function describeOutcome(outcome: MutationOutcome): string {
  if (outcome.changed) {
    return outcome.detail ?? outcome.effect;
  }
  if (outcome.detail && outcome.detail !== "noop") {
    return outcome.detail;
  }
  return "no changes";
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "Unknown error");
}
