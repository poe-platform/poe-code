/** Execution budget failures retire a browser; snapshot reads can be recoverable. */
export class PlaywrightResourceLimitError extends Error {
  override readonly name = 'PlaywrightResourceLimitError';
}

/** A completed read exceeded its output budget; the browser remains usable. */
export class PlaywrightSnapshotLimitError extends PlaywrightResourceLimitError {}

export function isPlaywrightResourceLimitError(error: unknown): boolean {
  return error instanceof PlaywrightResourceLimitError || error instanceof AggregateError && error.errors.some(isPlaywrightResourceLimitError);
}

/** Optional resource ceilings. Omitted values and Infinity disable the ceiling. */
export interface PlaywrightStructureLimits {
  readonly maxViewportDimension?: number | undefined;
  readonly maxOperationOutcomes?: number | undefined;
  readonly maxOperationOutcomeAgeMs?: number | undefined;
  readonly maxHighlights?: number | undefined;
  readonly maxEventEntries?: number | undefined;
  readonly maxTracePathBytes?: number | undefined;
  readonly maxSessionNameBytes?: number | undefined;
  readonly maxConfigBytes?: number | undefined;
  readonly maxConfigEntries?: number | undefined;
  readonly maxConfigDepth?: number | undefined;
  readonly maxOutputFiles?: number | undefined;
  readonly maxSnapshotDepth?: number | undefined;
  readonly maxEvaluationInputBytes?: number | undefined;
  readonly maxEvaluationBytes?: number | undefined;
  readonly maxEvaluationEntries?: number | undefined;
  readonly maxEvaluationDepth?: number | undefined;
  readonly maxScreenshotPixels?: number | undefined;
  readonly maxStorageNodes?: number | undefined;
  readonly maxStorageDepth?: number | undefined;
  readonly maxDownloads?: number | undefined;
  readonly maxRoutes?: number | undefined;
  readonly maxRoutePatternLength?: number | undefined;
  readonly maxWebMCPParameterBytes?: number | undefined;
  readonly maxWebMCPParameterNodes?: number | undefined;
  readonly maxWebMCPParameterDepth?: number | undefined;
  readonly maxRecordingActions?: number | undefined;
  readonly maxTraceFiles?: number | undefined;
  readonly webMCPDiscoveryTimeoutMs?: number | undefined;
  readonly maxWebMCPFrames?: number | undefined;
  readonly maxWebMCPMetadataBytes?: number | undefined;
  readonly maxWebMCPMetadataEntries?: number | undefined;
  readonly maxWebMCPMetadataDepth?: number | undefined;
}
export const playwrightStructureDefaults: Required<PlaywrightStructureLimits> = Object.freeze({
  maxViewportDimension: Infinity, maxOperationOutcomes: Infinity, maxOperationOutcomeAgeMs: Infinity, maxHighlights: Infinity, maxEventEntries: Infinity, maxTracePathBytes: Infinity, maxSessionNameBytes: Infinity,
  maxConfigBytes: Infinity, maxConfigEntries: Infinity, maxConfigDepth: Infinity,
  maxOutputFiles: Infinity, maxSnapshotDepth: Infinity, maxRecordingActions: Infinity,
  maxEvaluationInputBytes: Infinity, maxEvaluationBytes: Infinity, maxEvaluationEntries: Infinity, maxEvaluationDepth: Infinity, maxScreenshotPixels: Infinity, maxStorageNodes: Infinity, maxStorageDepth: Infinity, maxDownloads: Infinity,
  maxRoutes: Infinity, maxRoutePatternLength: Infinity, maxWebMCPParameterBytes: Infinity, maxWebMCPParameterNodes: Infinity, maxWebMCPParameterDepth: Infinity,
  webMCPDiscoveryTimeoutMs: Infinity, maxTraceFiles: Infinity, maxWebMCPFrames: Infinity, maxWebMCPMetadataBytes: Infinity,
  maxWebMCPMetadataEntries: Infinity, maxWebMCPMetadataDepth: Infinity,
});

/** Playwright uses zero, rather than Infinity, to disable native timeouts. */
export function playwrightNativeTimeout(timeout = Infinity): number {
  return timeout === Infinity ? 0 : timeout;
}
