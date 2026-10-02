export interface PptxPublicationRequest {
  readonly inputPath?: string;
  readonly protectedInputPaths?: readonly string[];
  readonly outputPath: string;
  readonly bytes: Uint8Array;
  readonly originalBytes: Uint8Array;
  readonly inPlace: boolean;
  readonly force: boolean;
  readonly dryRun: boolean;
}
