import * as native from "../dist/index.js";
import * as logging from "../../toolcraft/dist/runtime-logging.js";
import * as errors from "../../toolcraft/dist/http-errors.js";
import * as suggestions from "../../toolcraft/dist/suggest.js";
import * as userErrors from "../../toolcraft/dist/user-error.js";
import * as sourceSnippet from "toolcraft-rust/source-snippet";
import * as originalSnippet from "toolcraft/source-snippet";
import { S } from "toolcraft-schema";
import * as nativeSchema from "toolcraft-rust/schema";
import * as originalSchema from "toolcraft/schema";
import * as fileChanges from "toolcraft-rust/file-changes";
import * as originalFileChanges from "toolcraft/file-changes";
const fileRenderersOriginal: typeof originalFileChanges = fileChanges;
const fileRenderersOwn: typeof fileChanges = originalFileChanges;
const fileRenderer = fileChanges.createFileChangeRenderers<{ changes: readonly native.FileChange[]; revision: string }>();
const fileResult = { changes: [], revision: "main" };
const unchanged: unknown = fileRenderer.json?.(fileResult, {} as never);
void [fileRenderersOriginal, fileRenderersOwn, unchanged];

const nativeSchemaExports: typeof originalSchema = nativeSchema;
const originalSchemaExports: typeof nativeSchema = originalSchema;
const publicSchema: native.AnySchema = native.S.Object({ label: native.S.String() });
const eventSchema = nativeSchema.S.Object({ label: nativeSchema.S.String() });
const eventValue: native.Static<typeof eventSchema> = { label: "ready" };
void [nativeSchemaExports, originalSchemaExports, publicSchema, eventSchema, eventValue];

const managedStream: typeof import("toolcraft").createManagedStream = native.createManagedStream;
const originalStream: typeof native.createManagedStream = managedStream;
void originalStream;
const events = native.createManagedStream({
  eventSchema: S.Object({ message: S.String() }),
  create: async () => (async function* () { yield { message: "hello" }; })()
});
const typedEvents: native.ToolcraftStream<{ message: string }> = events;
const streamSignal: AbortSignal = typedEvents.signal;
const cancelled: Promise<void> = typedEvents.cancel({ reason: "done" });
void [streamSignal, cancelled];

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
