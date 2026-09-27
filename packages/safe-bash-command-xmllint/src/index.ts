import { readXmlInput, type XmlCommandRuntime } from "safe-bash-xml-engine/io";
import { parseXmlSteps, XmlLimitError } from "@poe-code/safe-fs/core";
import {
  FsError,
  getCommandArguments,
  writeBytes,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts";
import { shellValueByteLength } from "safe-bash-contracts/value";
import {
  XmlBudget,
  XmlQueryError,
  XmlQueryLimitError,
  resolveXmlQueryLimits,
  type XmlCommandsOptions,
  type XmlQueryLimits
} from "safe-bash-xml-engine/limits";
import { parseQuery, type Query } from "safe-bash-xml-engine/query";
import { evaluate, serialize, serializeSimpleSync, stringValue } from "safe-bash-xml-engine/evaluate";
import { serializeDocument, type DocumentMode } from "safe-bash-xml-engine/document";

const sharedEncoder = new TextEncoder();
export { defaultXmlQueryLimits } from "safe-bash-xml-engine/limits";
export type { XmlCommandsOptions, XmlQueryLimits } from "safe-bash-xml-engine/limits";

async function argumentsFor(
  context: CommandContext,
  budget: XmlBudget
): Promise<{
  query?: Query;
  mode?: DocumentMode | undefined;
  format?: boolean;
  noout?: boolean;
  file: string | undefined;
}> {
  if (context.args.length > 5) throw new XmlQueryError("expected one XML input FILE or -", 2);
  const carrier = getCommandArguments(context);
  const args = carrier.args;
  async function admitted(
    position: number,
    limit: "maxSourceBytes" | "maxInputBytes"
  ): Promise<string> {
    const text = args[position]!;
    if (text.length > budget.limits[limit]) throw new XmlQueryLimitError(limit);
    const size = shellValueByteLength(carrier.values[position]!);
    if (size > budget.limits[limit]) throw new XmlQueryLimitError(limit);
    for (let offset = 0; offset < size; offset += 1024)
      await budget.tick(Math.min(1024, size - offset));
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        carrier.bytes(position)
      );
    } catch {
      throw new XmlQueryError("XPath and filenames require valid UTF-8", 2);
    }
    if (decoded !== text) throw new XmlQueryError("XPath and filenames require lossless UTF-8", 2);
    return decoded;
  }
  let index = 0;
  let mode: DocumentMode | undefined;
  let noout = false;
  let format = false;
  let xpathIndex: number | undefined;
  while (index < args.length) {
    const flag = args[index]!;
    if (flag === "--noout") {
      noout = true;
      index++;
    } else if (flag === "--format") {
      mode ??= "format";
      format = true;
      index++;
    } else if (flag === "--c14n") {
      mode = "c14n";
      index++;
    } else if (flag === "--xpath") {
      if (xpathIndex !== undefined) throw new XmlQueryError("expected one --xpath QUERY", 2);
      index++;
      if (args[index] === "--") index++;
      const source = args[index];
      if (source === undefined || source.startsWith("-"))
        throw new XmlQueryError("expected QUERY [FILE|-]", 2);
      xpathIndex = index++;
    } else break;
  }
  if (args[index] === "--") index++;
  const fileIndex = index++;
  const file = args[fileIndex];
  if (
    index < args.length ||
    (file !== undefined && file.startsWith("-") && file !== "-" && args[fileIndex - 1] !== "--")
  ) {
    throw new XmlQueryError("expected one XML input FILE or -", 2);
  }
  if (xpathIndex !== undefined) {
    if (mode !== undefined || format) throw new XmlQueryError("expected --xpath QUERY [FILE|-]", 2);
    const query = await parseQuery(await admitted(xpathIndex, "maxSourceBytes"), budget);
    return {
      query,
      file: file === undefined ? undefined : await admitted(fileIndex, "maxInputBytes")
    };
  }
  mode ??= "format";
  return {
    mode,
    format,
    noout,
    file: file === undefined ? undefined : await admitted(fileIndex, "maxInputBytes")
  };
}

async function execute(
  context: CommandContext,
  limits: XmlQueryLimits,
  runtime: XmlCommandRuntime
): Promise<{ exitCode: number }> {
  const budget = new XmlBudget(limits, context.signal, runtime.yieldTurn);
  let outputFailed = false;
  try {
    const options = await argumentsFor(context, budget);
    const source = await readXmlInput(context, options.file, budget, runtime);
    const parser = parseXmlSteps(source, {
      ...limits,
      maxContentNodes: limits.maxNodes,
      expectedEncoding: "UTF-8"
    });
    let parsed = parser.next();
    try {
      while (!parsed.done) {
        const p = budget.tick(parsed.value);
        if (p) await p;
        parsed = parser.next();
      }
    } finally {
      if (!parsed.done) parser.return(undefined as never);
    }
    const outBatch = new Uint8Array(16384);
    let outBatchUsed = 0;
    let writesCount = 0;
    async function flushWrite(): Promise<void> {
      if (outBatchUsed > 0) {
        const slice = outBatch.subarray(0, outBatchUsed);
        outBatchUsed = 0;
        writesCount++;
        try {
          await writeBytes(context.stdout, slice, context.signal);
        } catch (error) {
          outputFailed = true;
          throw error;
        }
      }
    }
    async function write(part: string): Promise<void> {
      for (let offset = 0; offset < part.length; ) {
        let end = Math.min(offset + 4096, part.length);
        if (
          end < part.length &&
          part.charCodeAt(end - 1) >= 0xd800 &&
          part.charCodeAt(end - 1) <= 0xdbff
        )
          end--;
        { const _p = budget.tick(end - offset); if (_p) await _p; }
        const slice = part.slice(offset, end);
        const bytes = sharedEncoder.encode(slice);
        const size = bytes.byteLength;
        if (size > limits.maxOutputBytes - budget.outputBytes) {
          await flushWrite();
          throw new XmlQueryLimitError("maxOutputBytes");
        }
        budget.outputBytes += size;
        if (writesCount < 2 || size >= 8192) {
          await flushWrite();
          writesCount++;
          try {
            await writeBytes(context.stdout, bytes, context.signal);
          } catch (error) {
            outputFailed = true;
            throw error;
          }
        } else {
          if (outBatchUsed + size > outBatch.byteLength) await flushWrite();
          outBatch.set(bytes, outBatchUsed);
          outBatchUsed += size;
        }
        offset = end;
      }
    }
    if (options.query === undefined) {
      if (!options.noout && options.mode !== undefined) {
        for await (const part of serializeDocument(
          parsed.value,
          options.mode,
          budget,
          options.format
        ))
          await write(part);
      }
      await flushWrite();
      return { exitCode: 0 };
    }
    const nodes = await evaluate(options.query, parsed.value, budget);
    if (options.query.scalar === "count") await write(String(nodes.length));
    else if (options.query.scalar === "boolean") await write(nodes.length ? "true" : "false");
    else if (options.query.scalar === "string") {
      for await (const part of stringValue(nodes[0], budget)) await write(part);
    } else {
      if (!nodes.length) throw new XmlQueryError("XPath set is empty", 11);
      let pendingText = "";
      for (const node of nodes) {
        const simple = writesCount >= 2 ? serializeSimpleSync(node, budget) : undefined;
        if (simple !== undefined) {
          pendingText += simple + "\n";
          if (pendingText.length >= 4096) {
            await write(pendingText);
            pendingText = "";
          }
        } else {
          if (pendingText.length > 0) {
            await write(pendingText);
            pendingText = "";
          }
          for await (const part of serialize(node, budget)) await write(part);
          await write("\n");
        }
      }
      if (pendingText.length > 0) await write(pendingText);
      await flushWrite();
      return { exitCode: 0 };
    }
    await write("\n");
    await flushWrite();
    return { exitCode: 0 };
  } catch (error) {
    context.signal.throwIfAborted();
    if (outputFailed || (error instanceof FsError && error.code === "EPIPE")) throw error;
    const status =
      error instanceof XmlQueryError
        ? error.status
        : error instanceof XmlLimitError
          ? 5
          : error instanceof SyntaxError || error instanceof FsError
            ? 1
            : undefined;
    if (status === undefined) throw error;
    const message = error instanceof Error ? error.message.slice(0, 1000) : "XML query failed";
    await runtime.writeDiagnostic(
      context.stderr,
      `${context.command}: ${message}\n`,
      context.signal
    );
    return { exitCode: status };
  }
}

export function createXmllintCommand(
  options: XmlCommandsOptions,
  runtime: XmlCommandRuntime
): CommandDefinition {
  const limits = resolveXmlQueryLimits(options.limits);
  return { name: "xmllint", execute: (context) => execute(context, limits, runtime) };
}
