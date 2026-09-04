export type { BoundedRegexProvider, RegexWorker, RegexWorkerRequest } from "./provider.js";
export { createBoundedRegexProvider, type BoundedRegexProviderOptions } from "./bounded-provider.js";
export { RegexExecutionError } from "./protocol.js";
export type {
  RegexExecutionOptions, Descriptor as RegexDescriptor, Request as RegexRequest,
  Reply as RegexReply, Row as RegexRow, Match as RegexMatch,
  GrepDescriptor, SearchDescriptor, GlobDescriptor,
} from "./protocol.js";
export { EreLedger } from "./ere/limits.js";
export { compileEre } from "./ere/syntax.js";
export { matchEre } from "./ere/matcher.js";
export { EreSyntaxError, EreUnsupportedError, EreProfileLimitError, EreUsageUnknownError } from "./ere/errors.js";
export type { EreLimits, EreUsage, EreResource, EreExpansionBounds, EreFragment, EreSpan, EreProgram, EreResult } from "./ere/types.js";
