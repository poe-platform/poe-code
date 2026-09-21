import {
  SsconvertError,
  type Engine,
  type Operation,
  type ByteSink,
  type ConversionRequest
} from "./contracts.js";

export { parseCommand } from "./cli/parser.js";
export type { ParsedCommand, CommandOperation, CommandProfile, CommandArgument } from "./cli/parser.js";
import { parseCommand, type CommandArgument, type CommandProfile } from "./cli/parser.js";
import { compareServiceIds } from "./codecs/ordering.js";
import { imageFormats } from "./rendering/images/formats.js";

export async function runCommand(
  argv: readonly CommandArgument[],
  engine: Engine,
  operation: Operation & { readonly stdout: ByteSink; readonly stderr: ByteSink },
  profile?: CommandProfile
): Promise<{ readonly exitCode: number }> {
  operation.signal.throwIfAborted();
  let argumentBytes = 0;
  try {
    const maximum = engine.limits.argumentBytes ?? 1024 * 1024;
    if (argv.length > maximum) throw new SsconvertError("resource-limit", "ssconvert arguments limit exceeded");
    for (const argument of argv) {
      if (typeof argument === "string") {
        if (argument.length > maximum - argumentBytes)
          throw new SsconvertError("resource-limit", "ssconvert argument bytes limit exceeded");
        for (const character of argument) {
          const code = character.codePointAt(0)!;
          argumentBytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
          if (argumentBytes > maximum) throw new SsconvertError("resource-limit", "ssconvert argument bytes limit exceeded");
        }
      } else argumentBytes += argument.byteLength;
      if (argumentBytes > maximum) throw new SsconvertError("resource-limit", "ssconvert argument bytes limit exceeded");
    }
  } catch (error) {
    if (!(error instanceof SsconvertError)) throw error;
    await operation.stderr.write(new TextEncoder().encode(`${error.message}\n`));
    operation.signal.throwIfAborted();
    return { exitCode: error.exitCode };
  }
  const parsed = parseCommand(argv, profile);
  const encoder = new TextEncoder();
  let stderrFailed = false;
  async function report(bytes: Uint8Array) {
    operation.signal.throwIfAborted();
    try { await operation.stderr.write(bytes); }
    catch (error) { stderrFailed = true; throw error; }
    operation.signal.throwIfAborted();
  }
  let outputBytes = 0;
  function encodeOutput(text: string): Uint8Array {
    for (const character of text) {
      const code = character.codePointAt(0)!;
      outputBytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
      if (outputBytes > (engine.limits.commandOutputBytes ?? 1024 * 1024))
        throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
    }
    return encoder.encode(text);
  }
  try {
    if (parsed.kind === "terminal") {
      if (parsed.stdout) await operation.stdout.write(encodeOutput(parsed.stdout));
      if (parsed.stderr) {
        if (parsed.stderrBytes) {
          if (parsed.stderrBytes.byteLength > (engine.limits.commandOutputBytes ?? 1024 * 1024) - outputBytes)
            throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
          outputBytes += parsed.stderrBytes.byteLength;
          await report(parsed.stderrBytes);
        } else await report(encodeOutput(parsed.stderr));
      }
      operation.signal.throwIfAborted();
      return { exitCode: parsed.exitCode };
    }
    if (parsed.action === "list-importers" || parsed.action === "list-exporters" || parsed.action === "list-image-formats") {
      const services = parsed.action === "list-image-formats" ? imageFormats :
        [...engine.listServices(parsed.action === "list-importers" ? "read" : "write")]
          .filter((service) => !service.interactiveOnly).sort(compareServiceIds);
      const maximum = engine.limits.commandOutputBytes ?? 1024 * 1024;
      if (services.length > maximum) throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
      function textLength(text: string, ascii: boolean): number {
        let length = 0;
        for (const character of text) {
          const code = character.codePointAt(0)!;
          length += ascii || code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
          if (length > maximum) throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
        }
        return length;
      }
      const widths = services.map(service => textLength(service.id, false));
      const width = widths.reduce((max, length) => Math.max(max, length), 0);
      const ascii = profile?.listingEncoding !== "utf8";
      let total = 2 + Math.max(0, width - 2) + " | Description\n".length;
      if (total > maximum) throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
      for (let index = 0; index < services.length; index++) {
        const service = services[index]!;
        const length = textLength(service.id, ascii) + Math.max(0, width - widths[index]!) + 3 + textLength(service.description, ascii) + 1;
        if (length > maximum - total)
          throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
        total += length;
      }
      await report(encodeOutput(`ID${" ".repeat(Math.max(0, width - 2))} | Description\n`));
      for (let index = 0; index < services.length; index++) {
        operation.signal.throwIfAborted();
        const service = services[index]!;
        const padding = Math.max(0, width - widths[index]!);
        const length = textLength(service.id, ascii) + padding + 3 + textLength(service.description, ascii) + 1;
        if (length > maximum - outputBytes)
          throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
        const line = `${service.id}${" ".repeat(padding)} | ${service.description}\n`;
        const display = ascii
          ? Array.from(line, character => character.codePointAt(0)! < 128 ? character : "?").join("")
          : line;
        await report(encodeOutput(display));
      }
      operation.signal.throwIfAborted();
      return { exitCode: 0 };
    }
    if (parsed.action !== "convert" && parsed.action !== "merge" && parsed.action !== "clipboard")
      throw new SsconvertError(
        "unsupported-feature",
        `Unsupported ssconvert feature: ${parsed.action}`
      );
    for (const name of Object.keys(parsed.arrays).filter((name) => name !== "set" && name !== "goal-seek" && name !== "tool-test"))
      throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: --${name}`);
    if (parsed.operandBytes) {
      const filenameDecoder = new TextDecoder("utf8", { fatal: true, ignoreBOM: true });
      for (const bytes of parsed.operandBytes) {
        try { filenameDecoder.decode(bytes); }
        catch {
          throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: non-UTF-8 resource name");
        }
      }
    }
    const output = parsed.action === "merge" ? parsed.scalars["merge-to"] : parsed.operands[1];
    const request: ConversionRequest = {
      input: { kind: "resource", uri: parsed.operands[0]! },
      ...(output === undefined ? {} : { destination: output === "fd://1" && parsed.scalars["export-type"] !== undefined
        ? { kind: "stream", sink: operation.stdout }
        : { kind: "resource", uri: output } }),
      ...(parsed.scalars["import-type"] === undefined
        ? {}
        : { importType: parsed.scalars["import-type"] }),
      ...(parsed.scalars["import-encoding"] === undefined
        ? {}
        : { importEncoding: parsed.scalars["import-encoding"] }),
      ...(parsed.scalars["export-type"] === undefined
        ? {}
        : { exportType: parsed.scalars["export-type"] }),
      ...(parsed.scalars["export-options"] === undefined
        ? {}
        : { exportOptions: [parsed.scalars["export-options"]] }),
      recalc: parsed.flags.includes("recalc"),
      solve: parsed.flags.includes("solve"),
      verbose: parsed.flags.includes("verbose"),
      perSheet: parsed.flags.includes("export-file-per-sheet"),
      graphs: parsed.flags.includes("export-graphs"),
      ...(parsed.scalars.clipboard === undefined ? {} : { clipboard: parsed.scalars.clipboard }),
      ...(parsed.arrays.set === undefined ? {} : { updateExpressions: parsed.arrays.set }),
      ...(parsed.arrays["goal-seek"] === undefined ? {} : { goalSeekExpressions: parsed.arrays["goal-seek"] }),
      ...(parsed.arrays["tool-test"] === undefined ? {} : { toolTest: parsed.arrays["tool-test"] }),
      ...(parsed.scalars.resize === undefined ? {} : { resizeExpression: parsed.scalars.resize }),
      ...(parsed.scalars["export-range"] === undefined ? {} : { exportRangeExpression: parsed.scalars["export-range"] })
    };
    const emitted = new Set<import("./contracts.js").Diagnostic>();
    const diagnosticOperation = {
      ...operation,
      async diagnostic(diagnostic: import("./contracts.js").Diagnostic) {
        operation.signal.throwIfAborted();
        await report(diagnostic.bytes ?? encoder.encode(`${diagnostic.message}\n`));
        emitted.add(diagnostic);
        operation.signal.throwIfAborted();
      }
    };
    const result = parsed.action === "merge" ? await engine.merge({
      ...request, inputs: parsed.operands.map((uri) => ({ kind: "resource" as const, uri }))
    }, diagnosticOperation) : await engine.convert(request, diagnosticOperation);
    for (const diagnostic of result.diagnostics) {
      if (emitted.has(diagnostic)) continue;
      operation.signal.throwIfAborted();
      await report(diagnostic.bytes ?? encoder.encode(`${diagnostic.message}\n`));
    }
    operation.signal.throwIfAborted();
    return result;
  } catch (error) {
    operation.signal.throwIfAborted();
    if (stderrFailed) throw error;
    if (!(error instanceof SsconvertError)) throw error;
    await report(encoder.encode(`${error.message}\n`));
    operation.signal.throwIfAborted();
    return { exitCode: error.exitCode };
  }
}
