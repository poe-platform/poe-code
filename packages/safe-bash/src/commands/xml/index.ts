import { parseXmlSteps, XmlLimitError } from "@poe-code/safe-fs/core";
import {
  getCommandArguments,
  toByteSource,
  type CommandContext,
  type CommandDefinition,
  type VirtualShellPlugin
} from "../../contracts/index.js";
import { createXmllintCommand } from "safe-bash-command-xmllint";
import { readXmlInput } from "safe-bash-xml-engine/io";
import { yieldTurn } from "../../contracts/yield.js";
import { shellValueByteLength } from "../../contracts/value.js";
import { writeDiagnostic } from "../../escaping.js";
import { pathOf } from "../internal.js";
import { interruptible } from "../structured/limits.js";
import {
  XmlBudget,
  XmlQueryError,
  XmlQueryLimitError,
  resolveXmlQueryLimits,
  type XmlCommandsOptions,
  type XmlQueryLimits
} from "./limits.js";
import { executeJq } from "../structured/jq.js";
import { Budget, JqError, resolveJqLimits } from "../structured/limits.js";
import { stringify } from "../structured/input.js";
import { xmlToJson } from "./json.js";

export { defaultXmlQueryLimits } from "./limits.js";
export type { XmlCommandsOptions, XmlQueryLimits } from "./limits.js";

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

export function createXmlCommands(options: XmlCommandsOptions = {}): readonly CommandDefinition[] {
  const limits = resolveXmlQueryLimits(options.limits);
  return [
    { name: "xq", execute: (context) => executeXq(context, limits) },
    createXmllintCommand({ limits }, runtime)
  ];
}
export function xmlCommands(options: XmlCommandsOptions = {}): VirtualShellPlugin {
  const definitions = createXmlCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "xml-commands",
    setup(host) {
      if (!replace)
        for (const definition of definitions) {
          if (host.commands.has(definition.name))
            throw new Error(`Command already registered: ${definition.name}`);
        }
      for (const definition of definitions) host.commands.register(definition, { replace });
    }
  };
}
