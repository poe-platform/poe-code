export { parseFrontmatter, type ParsedFrontmatter } from "./frontmatter.js";
export { discoverAutomations, loadAutomation } from "./discover.js";
export { ghGroup } from "./commands.js";
export { checkUserAllow } from "./exec/check-user-allow.js";
export { requireCommentPrefix } from "./exec/require-comment-prefix.js";
export {
  parseTruffleHogFindings,
  renderTruffleHogComment,
  renderTruffleHogFindingsTable,
  runTruffleHogPrScanCommand,
  uniqueTruffleHogFindings
} from "./exec/trufflehog-pr-scan.js";
export type { AutomationDefinition } from "./types.js";
