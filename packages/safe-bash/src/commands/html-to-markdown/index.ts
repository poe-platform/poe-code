export * from "safe-bash-command-html-to-markdown";

import { syncCommandEvaluators } from "../internal.js";
import { evalSyncHtmlToMarkdown } from "safe-bash-command-html-to-markdown";
syncCommandEvaluators.evalSyncHtmlToMarkdown = evalSyncHtmlToMarkdown;
