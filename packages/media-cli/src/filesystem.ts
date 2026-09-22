import { createEffectStore, createJobBinding, type JobBindingOptions } from '@poe-code/remote-execution';

/** Own one invocation's inspection/retrieval ledger while native callbacks act
 * directly on the scoped canonical filesystem. The host must fork independent
 * output read retains; it must not reopen former output pathnames. The session
 * owner closes effects after retrieval, separately from native job cleanup.
 * effects.inspect/download expose the partial ledger and retained files;
 * effects.freshness issues an optional host-qualified content version for
 * guarded stat/download calls, including direct interrupted range resumes.
 * A retained identity alone does not certify an unchanged downloaded prefix.
 * direct stat/download reject untouched retained inputs, just as tree retrieval
 * excludes them; a settled mutation grants output membership immediately.
 * effects.inspectTree exposes surviving byte paths and detached identities;
 * unavailablePaths identifies settled outputs lacking a usable retained identity;
 * failed output retains stay in the effect manifest with retrievalFailures;
 * tree retrieval copies independent available files before reporting failure.
 * unresolvedEffects identifies unknown or unlocated namespace settlement,
 * including receipts without both pathname and identity; independent known
 * outputs still transfer, while the result reports incomplete reconstruction.
 * effects.retrieve copies a surviving byte-path tree for API-only consumers.
 * effects.reconstruct replays ordered settlement receipts. Preserve its returned
 * transfer.cursor to resume only on the same invocation and destination authority.
 * Retrieval cursors belong to their destination authority. Recreated download
 * adapters must supply the same identity and preserve acknowledged contents.
 * Settled opens after output creation locate surviving retained aliases and
 * displace stale names without treating untouched replacement files as outputs.
 * Initial opens also preserve locations through renames before the first write;
 * untouched input spellings remain excluded from the retrieved output tree.
 * Settled namespace removals are recorded alongside writes; retrieval does not
 * recreate removed generated directories or unchanged zero-progress inputs.
 * Native callbacks continue applying live canonical effects during execution. */
export function createCanonicalMediaFilesystem(options: Omit<JobBindingOptions, 'effects'> & { retainOutput: NonNullable<JobBindingOptions['retainOutput']> }): {
  job: ReturnType<typeof createJobBinding>;
  effects: ReturnType<typeof createEffectStore>;
} {
  const effects = createEffectStore({ maxEffects: options.maxCallbacks, maxFrameBytes: options.maxIoBytes ?? 1048576 });
  const job = createJobBinding({ ...options, effects });
  return { job, effects };
}
