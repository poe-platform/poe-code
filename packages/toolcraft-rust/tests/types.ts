import * as native from "../dist/index.js";
import * as logging from "../../toolcraft/dist/runtime-logging.js";
import * as errors from "../../toolcraft/dist/http-errors.js";
import * as suggestions from "../../toolcraft/dist/suggest.js";
import * as userErrors from "../../toolcraft/dist/user-error.js";
import * as sourceSnippet from "toolcraft-rust/source-snippet";
import * as originalSnippet from "toolcraft/source-snippet";

const renderSnippet: typeof originalSnippet.renderSourceSnippet = sourceSnippet.renderSourceSnippet;
const nativeSnippet: typeof sourceSnippet.renderSourceSnippet = originalSnippet.renderSourceSnippet;
void [renderSnippet, nativeSnippet];
sourceSnippet.renderSourceSnippet({ source: "one\ntwo", line: 2, column: 3, context: 1, filePath: "example.ts" });
// @ts-expect-error source and line are required
sourceSnippet.renderSourceSnippet({ source: "one" });

const expected: Pick<
  typeof native,
  | keyof typeof errors
  | keyof typeof suggestions
  | keyof typeof userErrors
  | "createRuntimeLogger"
  | "isLogLevel"
  | "shouldEmitDiagnostic"
> = { ...logging, ...errors, ...suggestions, ...userErrors };
const actual: typeof expected = native;
const original: Pick<
  typeof logging,
  "createRuntimeLogger" | "isLogLevel" | "shouldEmitDiagnostic"
> &
  typeof errors &
  typeof suggestions &
  typeof userErrors = actual;
void [original, expected];

const level: string = "warn";
if (native.isLogLevel(level)) {
  const narrowed: native.LogLevel = level;
  void narrowed;
}
native.createRuntimeLogger({
  logger: (event) => {
    const message: string = event.message;
    void message;
  }
});
// @ts-expect-error diagnostic events cannot use silent as an event level
native.createRuntimeLogger().emit({ level: "silent", message: "silent" });
