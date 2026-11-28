import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { portableWidth } from "safe-bash-command-fold";
import { integer, options as parseOptions, UsageError } from "safe-bash-io-engine/internal";
import { command, settings, type StreamInspectionCommandsOptions, type StreamInspectionLimits } from "safe-bash-text-stream-engine/stream-inspection/shared";

export type ColrmCommandsOptions = StreamInspectionCommandsOptions;
export type ColrmLimits = StreamInspectionLimits;

export function createColrmCommand(options: ColrmCommandsOptions = {}): CommandDefinition {
  const limits = settings({ limits: {
    maxInputBytes: 16 * 1024 * 1024, maxOutputBytes: 32 * 1024 * 1024,
    maxChunkBytes: 16 * 1024 * 1024, maxSteps: 64 * 1024 * 1024,
    maxArgumentBytes: 65536, ...options.limits,
  } });
  return command("colrm", limits, async session => {
    const parsed = parseOptions(session.context.args, "hV", { help: "h", version: "V" });
    const encoder = new TextEncoder();
    if (parsed.flags.has("h") || parsed.flags.has("V")) {
      await session.output(encoder.encode(parsed.flags.has("h")
        ? "Usage: colrm [startcol [endcol]]\nRemove inclusive, one-based display columns from standard input.\nOmit endcol to remove through the end of each line.\n  -h, --help\n  -V, --version\n"
        : "colrm (safe-bash virtual implementation)\n"));
      return;
    }
    if (parsed.operands.length > 2) throw new UsageError("too many operands");
    const start = parsed.operands[0] === undefined ? 0 : integer(parsed.operands[0], 0);
    const end = parsed.operands[1] === undefined ? Infinity : integer(parsed.operands[1], 0) || Infinity;
    let column = 0, cutting = false, finished = false;
    const consume = async (text: string) => {
      for (const character of text) {
        const step = session.step(); if (step) await step;
        if (character === "\n") {
          column = 0; cutting = false; finished = false;
          await session.output(Uint8Array.of(10));
          continue;
        }
        if (finished) { await session.output(encoder.encode(character)); continue; }
        const width = character === "\t" ? 8 - column % 8
          : character === "\b" ? (column > 0 ? -1 : 0) : Math.max(0, portableWidth(character.codePointAt(0)!));
        const previous = column;
        column += width;
        if (!cutting && column < start) { await session.output(encoder.encode(character)); continue; }
        if (!cutting) {
          cutting = true;
          if (width > 1 && previous < start - 1) await session.output(encoder.encode(" ".repeat(start - 1 - previous)));
        }
        if (column >= end) {
          if (column > end) await session.output(encoder.encode(" ".repeat(column - end)));
          finished = true;
        }
      }
    };
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    await session.files(["-"], async source => {
      for await (const bytes of source) {
        if (start === 0) await session.output(bytes);
        else await consume(decoder.decode(bytes, { stream: true }));
      }
      if (start !== 0) await consume(decoder.decode());
    });
  });
}

export function createColrmCommands(options: ColrmCommandsOptions = {}): readonly CommandDefinition[] {
  return [createColrmCommand(options)];
}
export function colrmCommands(options: ColrmCommandsOptions = {}): VirtualShellPlugin {
  return { name: "colrm-commands", setup(host) {
    for (const command of createColrmCommands(options)) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
