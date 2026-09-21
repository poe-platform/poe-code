type PathInspectionFileSystem = {
  lstat(filePath: string): Promise<{
    isSymbolicLink(): boolean;
  }>;
};
export declare function isObjectRecord(value: unknown): value is Record<string, unknown>;
export declare function getRequiredString(
  args: unknown,
  key: string,
  allowEmptyString?: boolean
): string;
export declare function getOptionalString(args: unknown, key: string): string | undefined;
export declare function getOptionalBoolean(args: unknown, key: string): boolean | undefined;
export declare function getOptionalNumber(args: unknown, key: string): number | undefined;
export declare function getOptionalNonNegativeInteger(
  args: unknown,
  key: string
): number | undefined;
export declare function assertAllowedPathEntries(
  allowedPaths: readonly string[],
  key?: string
): void;
export declare function normalizeAllowedPaths(
  cwd: string,
  allowedPaths: string[] | undefined
): string[];
export declare function resolveAllowedPath(
  cwd: string,
  allowedPaths: string[],
  inputPath: string
): string;
export declare function assertNoSymbolicLinkPath(
  fs: PathInspectionFileSystem,
  filePath: string
): Promise<void>;
export {};
