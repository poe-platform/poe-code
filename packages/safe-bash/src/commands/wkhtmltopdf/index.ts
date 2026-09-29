import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createPdfAstWkhtmltopdfCommand,
  informationText,
  parseInvocation,
  renderPdfAstSync,
  wkhtmltopdfLimits,
  type WkhtmltopdfCommandOptions,
  type WkhtmltopdfCommandsOptions,
} from "safe-bash-command-wkhtmltopdf";

export * from "safe-bash-command-wkhtmltopdf";

function isDefaultWkhtmltopdfOptions(options?: Partial<WkhtmltopdfCommandOptions>): boolean {
  if (!options) return true;
  return options.limits === undefined && options.renderer === undefined;
}

export function createWkhtmltopdfCommand(options: Partial<WkhtmltopdfCommandOptions> = {}): CommandDefinition {
  const def = createPdfAstWkhtmltopdfCommand(options);
  if (isDefaultWkhtmltopdfOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createWkhtmltopdfCommands(options: Partial<WkhtmltopdfCommandsOptions> = {}): readonly CommandDefinition[] {
  return [createWkhtmltopdfCommand(options)];
}

export function wkhtmltopdfCommands(options: Partial<WkhtmltopdfCommandOptions> = {}): VirtualShellPlugin {
  const command = createWkhtmltopdfCommand(options);
  return {
    name: "wkhtmltopdf",
    setup(host) {
      host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}

export function evalSyncWkhtmltopdf(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  if (opArgs.length === 0) return undefined;
  try {
    const signal = new AbortController().signal;
    const initial = parseInvocation(opArgs, { endOfOptions: true, signal });
    if (initial.mode === "information") {
      return informationText(initial.global.action);
    }
    if (initial.mode === "conversion") {
      const inputs: Uint8Array[] = [];
      for (const obj of initial.objects) {
        if (obj.input === null) return undefined;
        if (obj.input === "-") {
          if (inBytes === undefined || inBytes.byteLength > 262144) return undefined;
          inputs.push(inBytes);
        } else {
          if (initial.output !== "-" && obj.input === initial.output) return undefined;
          const b = readFileSync?.(obj.input);
          if (!b || b.byteLength > 262144) return undefined;
          inputs.push(b);
        }
      }
      const pdfBytes = renderPdfAstSync({
        job: initial,
        inputs,
        signal,
        limits: wkhtmltopdfLimits,
      });
      if (initial.output === "-") {
        return new TextDecoder("utf-8", { fatal: true }).decode(pdfBytes);
      }
      if (!writeFileSync || !initial.output) return undefined;
      if (!writeFileSync(initial.output, pdfBytes)) return undefined;
      return "";
    }
    return undefined;
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncWkhtmltopdf = evalSyncWkhtmltopdf;
