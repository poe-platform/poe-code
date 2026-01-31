import type {
  TemplateWriteMutation,
  TemplateMergeTomlMutation,
  TemplateMergeJsonMutation,
  ConfigObject,
  ValueResolver
} from "../types.js";

export interface WriteOptions {
  /** Target file path (must start with ~) */
  target: ValueResolver<string>;
  /** Template ID to load via template loader */
  templateId: string;
  /** Context to pass to Mustache.render() */
  context?: ValueResolver<ConfigObject>;
  /** Optional human-readable label for logging */
  label?: string;
}

export interface MergeTomlOptions {
  /** Target TOML file path (must start with ~) */
  target: ValueResolver<string>;
  /** Template ID to load via template loader */
  templateId: string;
  /** Context to pass to Mustache.render() */
  context?: ValueResolver<ConfigObject>;
  /** Optional human-readable label for logging */
  label?: string;
}

export interface MergeJsonOptions {
  /** Target JSON file path (must start with ~) */
  target: ValueResolver<string>;
  /** Template ID to load via template loader */
  templateId: string;
  /** Context to pass to Mustache.render() */
  context?: ValueResolver<ConfigObject>;
  /** Optional human-readable label for logging */
  label?: string;
}

function write(options: WriteOptions): TemplateWriteMutation {
  return {
    kind: "templateWrite",
    target: options.target,
    templateId: options.templateId,
    context: options.context,
    label: options.label
  };
}

function mergeToml(options: MergeTomlOptions): TemplateMergeTomlMutation {
  return {
    kind: "templateMergeToml",
    target: options.target,
    templateId: options.templateId,
    context: options.context,
    label: options.label
  };
}

function mergeJson(options: MergeJsonOptions): TemplateMergeJsonMutation {
  return {
    kind: "templateMergeJson",
    target: options.target,
    templateId: options.templateId,
    context: options.context,
    label: options.label
  };
}

export const templateMutation = {
  write,
  mergeToml,
  mergeJson
};
