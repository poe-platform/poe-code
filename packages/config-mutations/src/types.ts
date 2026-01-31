// ============================================================================
// Config Object Types
// ============================================================================

export type ConfigPrimitive = string | number | boolean | null;
export type ConfigValue = ConfigPrimitive | ConfigObject | ConfigArray | Date;
export interface ConfigObject {
  [key: string]: ConfigValue;
}
export type ConfigArray = ConfigValue[];

// ============================================================================
// FileSystem Interface
// ============================================================================

export interface FileSystem {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(
    path: string,
    content: string,
    options?: { encoding: "utf8" }
  ): Promise<void>;
  mkdir(path: string, options?: { recursive: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
  stat(path: string): Promise<{ mode?: number }>;
  chmod?(path: string, mode: number): Promise<void>;
}

// ============================================================================
// Template Loader
// ============================================================================

export type TemplateLoader = (templateId: string) => Promise<string>;

// ============================================================================
// Config Format Interface
// ============================================================================

export interface ConfigFormat {
  /** Parse string content into object */
  parse(content: string): ConfigObject;

  /** Serialize object to string (with consistent formatting) */
  serialize(obj: ConfigObject): string;

  /** Deep merge patch into base, returning new object */
  merge(base: ConfigObject, patch: ConfigObject): ConfigObject;

  /** Remove keys matching shape from object, returning new object */
  prune(
    obj: ConfigObject,
    shape: ConfigObject
  ): { changed: boolean; result: ConfigObject };
}

// ============================================================================
// Path Mapper (for isolated configurations)
// ============================================================================

export interface PathMapper {
  /** Map a target directory to a different location (e.g., for isolated configs) */
  mapTargetDirectory(input: { targetDirectory: string }): string;
}

// ============================================================================
// Mutation Context (passed to runMutations)
// ============================================================================

export interface MutationContext {
  /** Filesystem interface - required */
  fs: FileSystem;

  /** Home directory for ~ expansion - required */
  homeDir: string;

  /** Optional dry-run mode */
  dryRun?: boolean;

  /** Optional observers for logging */
  observers?: MutationObservers;

  /** Required for template mutations */
  templates?: TemplateLoader;

  /** Optional path mapper for redirecting paths (used for isolated configs) */
  pathMapper?: PathMapper;
}

// ============================================================================
// Value Resolver (static value or context-aware function)
// ============================================================================

export interface MutationOptions {
  [key: string]: unknown;
}

export type ValueResolver<T> = T | ((ctx: MutationOptions) => T);

// ============================================================================
// Mutation Types
// ============================================================================

interface BaseMutation {
  /** Human-readable label for logging */
  label?: string;
}

// Config mutations
export interface ConfigMergeMutation extends BaseMutation {
  kind: "configMerge";
  target: ValueResolver<string>;
  value: ValueResolver<ConfigObject>;
  format?: "json" | "toml";
  pruneByPrefix?: Record<string, string>;
}

export interface ConfigPruneMutation extends BaseMutation {
  kind: "configPrune";
  target: ValueResolver<string>;
  shape: ValueResolver<ConfigObject>;
  format?: "json" | "toml";
  onlyIf?: (doc: ConfigObject, ctx: MutationOptions) => boolean;
}

export interface ConfigTransformMutation extends BaseMutation {
  kind: "configTransform";
  target: ValueResolver<string>;
  format?: "json" | "toml";
  transform: (
    content: ConfigObject,
    ctx: MutationOptions
  ) => { content: ConfigObject | null; changed: boolean };
}

// File mutations
export interface EnsureDirectoryMutation extends BaseMutation {
  kind: "ensureDirectory";
  path: ValueResolver<string>;
}

export interface RemoveFileMutation extends BaseMutation {
  kind: "removeFile";
  target: ValueResolver<string>;
  whenEmpty?: boolean;
  whenContentMatches?: RegExp;
}

export interface ChmodMutation extends BaseMutation {
  kind: "chmod";
  target: ValueResolver<string>;
  mode: number;
}

export interface BackupMutation extends BaseMutation {
  kind: "backup";
  target: ValueResolver<string>;
}

// Template mutations
export interface TemplateWriteMutation extends BaseMutation {
  kind: "templateWrite";
  target: ValueResolver<string>;
  templateId: string;
  context?: ValueResolver<ConfigObject>;
}

export interface TemplateMergeTomlMutation extends BaseMutation {
  kind: "templateMergeToml";
  target: ValueResolver<string>;
  templateId: string;
  context?: ValueResolver<ConfigObject>;
}

export interface TemplateMergeJsonMutation extends BaseMutation {
  kind: "templateMergeJson";
  target: ValueResolver<string>;
  templateId: string;
  context?: ValueResolver<ConfigObject>;
}

export type Mutation =
  | ConfigMergeMutation
  | ConfigPruneMutation
  | ConfigTransformMutation
  | EnsureDirectoryMutation
  | RemoveFileMutation
  | ChmodMutation
  | BackupMutation
  | TemplateWriteMutation
  | TemplateMergeTomlMutation
  | TemplateMergeJsonMutation;

// ============================================================================
// Mutation Result
// ============================================================================

export type MutationEffect =
  | "none"
  | "mkdir"
  | "write"
  | "delete"
  | "chmod"
  | "copy";

export type MutationDetail =
  | "create"
  | "update"
  | "delete"
  | "noop"
  | "backup";

export interface MutationOutcome {
  changed: boolean;
  effect: MutationEffect;
  detail?: MutationDetail;
}

export interface MutationDetails {
  kind: string;
  label: string;
  targetPath?: string;
}

export interface MutationObservers {
  onStart?(details: MutationDetails): void;
  onComplete?(details: MutationDetails, outcome: MutationOutcome): void;
  onError?(details: MutationDetails, error: unknown): void;
}

export interface MutationResult {
  changed: boolean;
  effects: MutationOutcome[];
}
