import { JqLimitError, type JqLimits } from "../structured/limits.js";

export type YqCategory = "cli" | "query" | "input" | "schema" | "alias" | "limit" | "vfs" | "encode";

export type YqCode =
  | "CLI_ARGV_ENTRIES_LIMIT" | "CLI_ARGV_BYTES_LIMIT" | "CLI_INVALID_UNICODE" | "CLI_INFO_COMBINATION"
  | "CLI_UNSUPPORTED_COMMAND" | "CLI_MISSING_OPTION_VALUE" | "CLI_INVALID_OPTION_VALUE" | "CLI_UNSUPPORTED_OPTION"
  | "CLI_UNKNOWN_OPTION" | "CLI_DUPLICATE_OPTION" | "CLI_INCOMPATIBLE_OPTIONS" | "CLI_DUPLICATE_STDIN"
  | "CLI_VFS_OPERAND_LIMIT" | "QUERY_COMPILE_FAILED" | "QUERY_RUNTIME_FAILED" | "INPUT_INVALID_UTF8"
  | "INPUT_YAML_SYNTAX" | "INPUT_DOCUMENT_STRUCTURE" | "SCHEMA_UNSUPPORTED_DIRECTIVE" | "SCHEMA_UNSUPPORTED_TAG"
  | "SCHEMA_TAG_KIND_MISMATCH" | "SCHEMA_TAG_LEXEME_MISMATCH" | "SCHEMA_NONSTRING_KEY" | "SCHEMA_DUPLICATE_KEY"
  | "SCHEMA_PLAIN_MERGE_KEY" | "SCHEMA_NONFINITE_NUMBER" | "SCHEMA_UNSAFE_INTEGER" | "SCHEMA_DECIMAL_RANGE"
  | "ALIAS_UNDEFINED" | "ALIAS_FORWARD" | "ALIAS_CURRENT_NODE" | "ALIAS_CYCLE" | "ALIAS_DUPLICATE_ANCHOR"
  | "LIMIT_MAX_INPUT_BYTES" | "LIMIT_MAX_DOCUMENT_BYTES" | "LIMIT_MAX_VALUE_BYTES" | "LIMIT_MAX_SCALAR_BYTES"
  | "LIMIT_MAX_QUERY_SOURCE_BYTES" | "LIMIT_MAX_DEPTH" | "LIMIT_MAX_AST_DEPTH" | "LIMIT_MAX_STEPS"
  | "LIMIT_MAX_RESULTS" | "LIMIT_MAX_COLLECTION_SIZE" | "LIMIT_MAX_DOCUMENTS" | "LIMIT_MAX_ANCHORS_PER_DOCUMENT"
  | "LIMIT_MAX_ALIAS_REFERENCES" | "LIMIT_MAX_DOCUMENT_NODES" | "LIMIT_MAX_OUTPUT_BYTES" | "DIAGNOSTIC_TRUNCATED"
  | "VFS_INPUT_OPEN" | "VFS_INPUT_READ" | "ENCODE_UNSUPPORTED_VALUE" | "ENCODE_INVALID_UNICODE" | "ENCODE_CYCLIC_GRAPH";

export class YqError extends Error {
  constructor(
    readonly category: YqCategory,
    readonly code: YqCode,
    readonly status: number,
    readonly source?: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(`${category}: ${code}`);
  }
}

const budgetLimits: Readonly<Record<keyof JqLimits, YqCode>> = Object.freeze({
  maxInputBytes: "LIMIT_MAX_INPUT_BYTES",
  maxValueBytes: "LIMIT_MAX_VALUE_BYTES",
  maxOutputBytes: "LIMIT_MAX_OUTPUT_BYTES",
  maxSourceBytes: "LIMIT_MAX_QUERY_SOURCE_BYTES",
  maxDepth: "LIMIT_MAX_DEPTH",
  maxAstDepth: "LIMIT_MAX_AST_DEPTH",
  maxSteps: "LIMIT_MAX_STEPS",
  maxResults: "LIMIT_MAX_RESULTS",
  maxCollectionSize: "LIMIT_MAX_COLLECTION_SIZE",
});

export function fromJqLimit(error: JqLimitError): YqError {
  const prefix = error.message.slice(0, error.message.indexOf(" ")) as keyof JqLimits;
  return new YqError("limit", budgetLimits[prefix] ?? "LIMIT_MAX_STEPS", 5);
}

export function limit(code: YqCode, source?: string, line?: number, column?: number): YqError {
  return new YqError("limit", code, 5, source, line, column);
}
