import type {CommandContext} from "safe-bash-contracts";
import {yieldTurn} from "safe-bash-contracts/yield";
import {JqError, JqLimitError} from "safe-bash-query-engine/limits";
import {sha256} from "safe-bash-checksum-engine/sha256";
import {attachmentDigestHex, getLlmAttachmentUrlId} from "./attachment-id.js";
import {withEmbeddingJsonDocument, EmptyJsonDocumentError} from "./import-json-document.js";
import {prettyJsonDocument} from "./json-document-output.js";
import {indentLlmText} from "./indent-text.js";
import {pythonRepr} from "./python-repr.js";
import {createLlmSpool} from "./retained-spool.js";
import type {LlmToolExecutionResult} from "./tool-execution.js";

type Spool = Awaited<ReturnType<typeof createLlmSpool>>;

/** Command formatting borrows already staged tool results; shared execution
 * owns no diagnostic state and never materializes a complete tool output. */
export async function debugToolResult(options: {
  context: CommandContext;
  result: LlmToolExecutionResult;
  output: Spool;
  attachments: readonly {mimeType: string; id?: string; url?: string; content?: {spool: Spool; size: number}}[];
  write(bytes: Uint8Array): Promise<void>;
}): Promise<void> {
  const {context, result, write} = options, {signal} = context;
  if (!result.executed) return;
  const encoder = new TextEncoder();
  const emit = async (text: string, sink = write): Promise<void> => {
    for (let offset = 0; offset < text.length;) {
      await yieldTurn(signal);
      let end = Math.min(text.length, offset + 4096);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      await sink(encoder.encode(text.slice(offset, end))); offset = end;
    }
  };
  await emit("\nTool call: "); await emit(result.call.name); await emit("(");
  for await (const bytes of pythonRepr(result.call.arguments, signal)) await write(bytes);
  await write(encoder.encode(")\n"));
  const body = await createLlmSpool(context.fs, context.cwd, signal);
  try {
    let parsed = false;
    try {
      await withEmbeddingJsonDocument({fs: context.fs, directory: context.cwd, signal, maxFileBytes: Number.MAX_SAFE_INTEGER, maxOpenFiles: 8}, options.output.replay(), async document => {
        parsed = true;
        for await (const bytes of prettyJsonDocument(document, signal)) await body.write(bytes);
      });
    } catch (error) {
      signal.throwIfAborted();
      if (parsed || !(error instanceof JqError && !(error instanceof JqLimitError) && error.message.startsWith("parse error:")
        || error instanceof EmptyJsonDocumentError)) throw error;
      for await (const bytes of options.output.replay()) await body.write(bytes);
    }
    if (options.attachments.length) await body.write(encoder.encode("\nAttachments:\n"));
    for (const attachment of options.attachments) {
      let id = attachment.id;
      if (id === undefined && attachment.content?.size) {
        const hash = sha256.create();
        try {for await (const bytes of attachment.content.spool.replay()) hash.update(bytes); id = attachmentDigestHex(hash.digest());}
        finally {hash.destroy();}
      }
      id ??= await getLlmAttachmentUrlId(attachment.url ?? null, signal);
      const append = body.write.bind(body);
      await emit(`  <Attachment: ${id} type="`, append); await emit(attachment.mimeType, append); await emit('"', append);
      if (attachment.url) {await emit(' url="', append); await emit(attachment.url, append); await emit('"', append);}
      if (attachment.content?.size) await emit(` content=${attachment.content.size} bytes`, append);
      await emit(">\n", append);
    }
    // Two independent bounded readers preserve whitespace-only lines without
    // accumulating the longest line in memory.
    const replay = {async *[Symbol.asyncIterator]() {
      const source = await body.lease(signal);
      try {yield* source.bytes;} finally {await source.dispose();}
    }};
    for await (const text of indentLlmText(replay, signal)) await write(encoder.encode(text));
    await write(encoder.encode(result.exception === undefined ? "\n\n" : "\n"));
    if (result.exception !== undefined) {
      await emit("  Exception: "); await emit(result.exception instanceof Error ? result.exception.message : String(result.exception)); await emit("\n");
    }
  } finally {await body.close();}
}
