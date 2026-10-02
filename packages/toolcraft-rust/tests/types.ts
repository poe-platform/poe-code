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


import * as design from "toolcraft-rust/design";
import {renderTable as designTable, type TableColumn} from "toolcraft-rust/design/render-table";
import {renderMarkdownPlaintext as designPlaintext} from "toolcraft-rust/design/render-markdown-plaintext";
import {singleDetail as designSingleDetail, type Row as DesignRow} from "toolcraft-rust/design/single-detail";
import type {SelectOptions as DesignSelectOptions} from "toolcraft-rust/design/select";
import type {ExplorerConfig as DesignExplorerConfig} from "toolcraft-rust/design/run-explorer";
const designTableOriginal: typeof import("toolcraft/design/render-table").renderTable = designTable;
const designTableOwn: typeof designTable = null as unknown as typeof import("toolcraft/design/render-table").renderTable;
const designColumns: TableColumn[] = [{name:"name",title:"Name",alignment:"left",maxLen:40}];
const designRendered: string = designTable({theme:design.getTheme(),rows:[{name:"Example"}],columns:designColumns});
const designPlain: string = designPlaintext("# Heading");
const designTheme: typeof import("toolcraft-design-rust").getTheme = design.getTheme;
const designSelection: DesignSelectOptions<"one"|"two"> = {message:"Pick",options:[{value:"one",label:"One"},{value:"two",label:"Two"}]};
const designRows: DesignRow[] = [{id:"a",title:"A"}];
const designExplorer: DesignExplorerConfig<{title:string}> = {title:"Example",actions:[],rows:async()=>designRows,detail:designSingleDetail(row=>row.title)};
// @ts-expect-error selection values must preserve the caller's option type
const invalidDesignSelection: DesignSelectOptions<"one"> = {message:"Pick",options:[{value:"two",label:"Two"}]};
void [designTableOriginal,designTableOwn,designRendered,designPlain,designTheme,designSelection,designExplorer,invalidDesignSelection];

import * as stackTrim from "../dist/stack-trim.js";
import type * as referenceStackTrim from "../../toolcraft/dist/stack-trim.js";
const stackTrimOriginal: typeof referenceStackTrim = stackTrim;
const stackTrimNative: typeof stackTrim = null as unknown as typeof referenceStackTrim;
const stackMode: referenceStackTrim.DebugStackMode = null as unknown as import("../dist/stack-trim.js").DebugStackMode;
void [stackTrimOriginal,stackTrimNative,stackMode];

import * as numberSchema from "../dist/number-schema.js";
import type * as referenceNumberSchema from "../../toolcraft/dist/number-schema.js";
const numberSchemaOriginal: typeof referenceNumberSchema = numberSchema;
const numberSchemaNative: typeof numberSchema = null as unknown as typeof referenceNumberSchema;
void [numberSchemaOriginal,numberSchemaNative];

import * as renderer from "../dist/renderer.js";
import type * as referenceRenderer from "../../toolcraft/dist/renderer.js";
const rendererOriginal: typeof referenceRenderer = renderer;
const rendererNative: typeof renderer = null as unknown as typeof referenceRenderer;
const outputMode: referenceRenderer.OutputMode = null as unknown as import("../dist/renderer.js").OutputMode;
const renderStatus: referenceRenderer.RenderResultStatus = null as unknown as import("../dist/renderer.js").RenderResultStatus;
void [rendererOriginal,rendererNative,outputMode,renderStatus];
