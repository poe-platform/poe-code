import { builtInDirectContextExecutors } from "safe-bash-command-io-engine/internal";
import type { XmlElement } from "@poe-code/safe-fs/core";
import type { CommandDefinition } from "safe-bash-contracts";
import { resolveXmlQueryLimits, type XmlCommandsOptions } from "safe-bash-xml-engine/limits";
import { parseXmlSteps, XmlLimitError } from "@poe-code/safe-fs/core";
import { getCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { readXmlInput } from "safe-bash-xml-engine/io";
import { yieldTurn } from "safe-bash-contracts/yield";
import { shellValueByteLength } from "safe-bash-contracts/value";
import { writeDiagnostic } from "safe-bash-contracts/escaping";
import { pathOf } from "safe-bash-command-io-engine/internal";
import { interruptible } from "safe-bash-query-engine/limits";
import { XmlBudget, XmlQueryError, XmlQueryLimitError, type XmlQueryLimits } from "safe-bash-xml-engine/limits";
import { executeJq } from "safe-bash-command-jq/jq";
import { Budget, JqError, resolveJqLimits } from "safe-bash-query-engine/limits";
import { stringify } from "safe-bash-query-engine/input";
import { xmlToJson } from "safe-bash-xml-engine/json";
const runtime = { yieldTurn, pathOf, interruptible, writeDiagnostic };
async function executeXq(
  context: CommandContext,
  limits: XmlQueryLimits
): Promise<{ exitCode: number }> {
  const budget = new XmlBudget(limits, context.signal, yieldTurn);
  try {
    const carrier = getCommandArguments(context);
    for (let index = 0; index < carrier.args.length; index++) {
      if (shellValueByteLength(carrier.values[index]!) > limits.maxInputBytes)
        throw new XmlQueryLimitError("maxInputBytes");
      let decoded: string;
      try {
        decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          carrier.bytes(index)
        );
      } catch {
        throw new XmlQueryError("filters and filenames require valid UTF-8", 2);
      }
      if (decoded !== carrier.args[index])
        throw new XmlQueryError("filters and filenames require lossless UTF-8", 2);
      await budget.tick(decoded.length);
    }
    const jqLimits = resolveJqLimits({
      maxOutputBytes: limits.maxOutputBytes,
      maxSourceBytes: limits.maxSourceBytes,
      maxDepth: limits.maxDepth * 2 + 2,
      maxSteps: limits.maxSteps,
      maxResults: limits.maxResults
    });
    const conversionBudget = new Budget(jqLimits, context.signal);
    // Only XML conversion errors are translated; jq owns its sink failures.
    return executeJq(context, jqLimits, async (bytes) => {
      try {
        const source = await readXmlInput({ ...context, stdin: bytes }, undefined, budget, runtime);
        const parser = parseXmlSteps(source, {
          ...limits,
          maxContentNodes: limits.maxNodes,
          expectedEncoding: "UTF-8"
        });
        let parsed = parser.next();
        try {
          while (!parsed.done) {
            await budget.tick(parsed.value);
            parsed = parser.next();
          }
        } finally {
          if (!parsed.done) parser.return(undefined as never);
        }
        const value = await xmlToJson(parsed.value, budget);
        conversionBudget.value(value);
        return toByteSource(
          (await stringify(
            value,
            conversionBudget,
            false,
            jqLimits.maxValueBytes,
            "maxValueBytes"
          )) + "\n"
        );
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof XmlQueryError) throw new JqError(error.message, error.status);
        if (error instanceof XmlLimitError) throw new JqError(error.message, 5);
        if (error instanceof SyntaxError) throw new JqError(error.message, 1);
        throw error;
      }
    });
  } catch (error) {
    context.signal.throwIfAborted();
    if (!(error instanceof XmlQueryError)) throw error;
    await writeDiagnostic(
      context.stderr,
      `${context.command}: ${error.message.slice(0, 1000)}\n`,
      context.signal
    );
    return { exitCode: error.status };
  }
}
import type { VirtualShellPlugin } from "safe-bash-contracts";
export type { XmlCommandsOptions as XqCommandsOptions, XmlQueryLimits as XqLimits } from "safe-bash-xml-engine/limits";
export function createXqCommand(options: XmlCommandsOptions = {}): CommandDefinition { const limits = resolveXmlQueryLimits(options.limits); const definition: CommandDefinition = { name: "xq", execute: context => executeXq(context, limits) }; if (options.limits === undefined) builtInDirectContextExecutors.add(definition.execute); return definition; }
export function createXqCommands(options: XmlCommandsOptions = {}): readonly CommandDefinition[] { return [createXqCommand(options)]; }
export function xqCommands(options: XmlCommandsOptions = {}): VirtualShellPlugin { const commands = createXqCommands(options); return { name: "xq-commands", setup(host) { if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`); for (const command of commands) host.commands.register(command, {replace: options.replace ?? false}); } }; }

const syncXmlDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function xmlElementToJsonSync(node: XmlElement): unknown {
  const result: Record<string, unknown> = Object.create(null);
  const names = new Set<string>();
  for (const attribute of node.attributes) {
    result["@" + attribute.name] = attribute.value;
  }
  const text: string[] = [];
  for (const child of node.content) {
    if (child.kind === "text" || child.kind === "cdata") text.push(child.text);
    else if (child.kind === "element") {
      const value = xmlElementToJsonSync(child);
      if (!names.has(child.name)) {
        result[child.name] = value;
        names.add(child.name);
      } else {
        const previous = result[child.name];
        if (Array.isArray(previous)) previous.push(value);
        else result[child.name] = [previous, value];
      }
    }
  }
  const value = text.join("").trim();
  if (Object.keys(result).length === 0) return value || null;
  if (value) result["#text"] = value;
  return result;
}

let lastXqXmlText: string | undefined;
let lastXqJsonStr: string | undefined;

export function evalSyncXq(
  inBytes: Uint8Array,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): { jsonStr: string; jqArgs: string[] } | undefined {
  if (inBytes.byteLength > 8192 || opArgs.length > 5) return undefined;
  let rawOut = false;
  let compactOut = false;
  let ended = false;
  const positional: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (!ended && a === "--") { ended = true; continue; }
    if (!ended && a.startsWith("-") && a !== "-") {
      if (a === "-r" || a === "--raw-output") { rawOut = true; continue; }
      if (a === "-c" || a === "--compact-output") { compactOut = true; continue; }
      if (a === "-rc" || a === "-cr") { rawOut = true; compactOut = true; continue; }
      return undefined;
    }
    positional.push(a);
  }
  const filter = positional[0] ?? ".";
  const fileArg = positional[1];
  if (positional.length > 2) return undefined;
  let srcBytes = inBytes;
  if (fileArg !== undefined && fileArg !== "-") {
    if (!readFileSync) return undefined;
    const fBytes = readFileSync(fileArg);
    if (!fBytes || fBytes.byteLength > 8192) return undefined;
    srcBytes = fBytes;
  }
  let xmlText: string;
  try {
    xmlText = syncXmlDecoder.decode(srcBytes);
  } catch {
    return undefined;
  }
  let jsonStr: string;
  if (xmlText === lastXqXmlText && lastXqJsonStr !== undefined) {
    jsonStr = lastXqJsonStr;
  } else {
    let root: XmlElement;
    try {
      const limits = resolveXmlQueryLimits(undefined);
      const parser = parseXmlSteps(xmlText, { ...limits, maxContentNodes: limits.maxNodes, expectedEncoding: "UTF-8" });
      let step = parser.next();
      while (!step.done) step = parser.next();
      root = step.value;
    } catch {
      return undefined;
    }
    const rootObj: Record<string, unknown> = Object.create(null);
    rootObj[root.name] = xmlElementToJsonSync(root);
    jsonStr = JSON.stringify(rootObj);
    lastXqXmlText = xmlText;
    lastXqJsonStr = jsonStr;
  }
  const jqArgs: string[] = [];
  if (rawOut && compactOut) jqArgs.push("-rc");
  else if (rawOut) jqArgs.push("-r");
  else if (compactOut) jqArgs.push("-c");
  jqArgs.push(filter);
  return { jsonStr, jqArgs };
}
