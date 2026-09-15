import {ExecutionLimitError, type ExecutionMeter} from './execution-budget.js';

/** Rejecting a replacement can restore and chain the guest exception through
 * an explicit service. Cancellation must win over catchable service failures,
 * while an existing fatal failure keeps its identity and reason. */
export function rejectEncodingReplacement(
  recovery: {failure?: unknown; rejectReplacement?: () => never},
  original: unknown,
  meter?: ExecutionMeter
): never {
  try {
    recovery.rejectReplacement?.();
    throw recovery.failure ?? original;
  } catch (error) {
    if (!(error instanceof ExecutionLimitError)) meter?.checkpoint();
    throw error;
  }
}
