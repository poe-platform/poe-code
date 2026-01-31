import type {
  ConfigMergeMutation,
  ConfigPruneMutation,
  ConfigTransformMutation,
  ConfigObject,
  ValueResolver,
  MutationOptions
} from "../types.js";

export interface MergeOptions {
  /** Target file path (must start with ~) */
  target: ValueResolver<string>;
  /** Value to merge into the config file */
  value: ValueResolver<ConfigObject>;
  /** Optional explicit format override */
  format?: "json" | "toml";
  /** Optional prune by prefix before merging (TOML) */
  pruneByPrefix?: Record<string, string>;
  /** Optional human-readable label for logging */
  label?: string;
}

export interface PruneOptions {
  /** Target file path (must start with ~) */
  target: ValueResolver<string>;
  /** Shape to prune from the config file */
  shape: ValueResolver<ConfigObject>;
  /** Optional explicit format override */
  format?: "json" | "toml";
  /** Optional guard - only prune if predicate returns true */
  onlyIf?: (doc: ConfigObject, ctx: MutationOptions) => boolean;
  /** Optional human-readable label for logging */
  label?: string;
}

export interface TransformOptions {
  /** Target file path (must start with ~) */
  target: ValueResolver<string>;
  /** Optional explicit format override */
  format?: "json" | "toml";
  /** Transform function - receives parsed content, returns transformed content */
  transform: (
    content: ConfigObject,
    ctx: MutationOptions
  ) => { content: ConfigObject | null; changed: boolean };
  /** Optional human-readable label for logging */
  label?: string;
}

function merge(options: MergeOptions): ConfigMergeMutation {
  return {
    kind: "configMerge",
    target: options.target,
    value: options.value,
    format: options.format,
    pruneByPrefix: options.pruneByPrefix,
    label: options.label
  };
}

function prune(options: PruneOptions): ConfigPruneMutation {
  return {
    kind: "configPrune",
    target: options.target,
    shape: options.shape,
    format: options.format,
    onlyIf: options.onlyIf,
    label: options.label
  };
}

function transform(options: TransformOptions): ConfigTransformMutation {
  return {
    kind: "configTransform",
    target: options.target,
    format: options.format,
    transform: options.transform,
    label: options.label
  };
}

export const configMutation = {
  merge,
  prune,
  transform
};
