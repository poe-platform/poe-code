import type {
  Mutation,
  MutationContext,
  MutationDetails,
  MutationResult,
  MutationOptions
} from "../types.js";
import { applyMutation, resolveMutationDetails } from "./apply-mutation.js";

/**
 * Execute an array of mutations in order.
 *
 * All dependencies must be injected - no defaults, no globals.
 */
export async function runMutations(
  mutations: Mutation[],
  context: MutationContext,
  options?: MutationOptions
): Promise<MutationResult> {
  const effects: MutationResult["effects"] = [];
  let anyChanged = false;
  const resolverOptions = options ?? {};

  for (const mutation of mutations) {
    const { outcome } = await executeMutation(
      mutation,
      context,
      resolverOptions
    );
    effects.push(outcome);
    if (outcome.changed) {
      anyChanged = true;
    }
  }

  return {
    changed: anyChanged,
    effects
  };
}

async function executeMutation(
  mutation: Mutation,
  context: MutationContext,
  options: MutationOptions
): Promise<{ outcome: MutationResult["effects"][number]; details: MutationDetails }> {
  const pendingDetails = resolveMutationDetails(mutation, context, options);

  // Call onStart observer
  context.observers?.onStart?.(pendingDetails);

  try {
    const { outcome, details } = await applyMutation(mutation, context, options);

    // Call onComplete observer
    context.observers?.onComplete?.(details, outcome);

    return { outcome, details };
  } catch (error) {
    // Call onError observer
    context.observers?.onError?.(pendingDetails, error);

    // Re-throw the error
    throw error;
  }
}
