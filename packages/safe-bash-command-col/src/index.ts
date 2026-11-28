import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { portableWidth } from "safe-bash-command-fold";
import { options as parseOptions, UsageError } from "safe-bash-io-engine/internal";
import { command, settings, type StreamInspectionCommandsOptions, type StreamInspectionLimits } from "safe-bash-text-stream-engine/stream-inspection/shared";

export type ColCommandsOptions = StreamInspectionCommandsOptions;
export type ColLimits = StreamInspectionLimits;

export function createColCommand(options: ColCommandsOptions = {}): CommandDefinition {
  const limits = settings({ limits: {
    maxInputBytes: 16 * 1024 * 1024, maxOutputBytes: 32 * 1024 * 1024,
    maxRecordBytes: 1024 * 1024, maxChunkBytes: 16 * 1024 * 1024,
    maxSteps: 64 * 1024 * 1024, maxArgumentBytes: 65536, ...options.limits,
  } });
  return command("col", limits, async session => {
    let tabs = true;
    const parsed = parseOptions(session.context.args, "bhxpHV", {
      "no-backspaces": "b", tabs: "h", spaces: "x", pass: "p", help: "H", version: "V",
    }, false, undefined, undefined, flag => {
      if (flag === "h" || flag === "x") tabs = flag === "h";
    });
    const encoder = new TextEncoder();
    if (parsed.flags.has("H") || parsed.flags.has("V")) {
      await session.output(encoder.encode(parsed.flags.has("H")
        ? "Usage: col [options]\nFilter reverse line feeds and overstrikes from standard input.\n  -b, --no-backspaces  keep the last character at each column\n  -x, --spaces         expand tabs to spaces\n  -h, --tabs           compress spaces to tabs (default)\n  -p, --pass           preserve unknown control characters\n  -H, --help\n  -V, --version\n"
        : "col (safe-bash virtual implementation)\n"));
      return;
    }
    if (parsed.operands.length) throw new UsageError("unexpected operand");
    const noBackspaces = parsed.flags.has("b");
    const rows = new Map<number, Map<number, { text: string; width: number }[]>>();
    let row = 0, column = 0, lastLine = 0, firstLine = 0, retained = 0, escape = false;
    const consume = async (text: string) => {
      for (const character of text) {
        const step = session.step(); if (step) await step;
        if (escape) { escape = false; continue; }
        if (character === "\x1b") { escape = true; continue; }
        if (character === "\n") { row++; column = 0; lastLine = Math.max(lastLine, row); continue; }
        if (character === "\v") { row--; firstLine = Math.min(firstLine, row); continue; }
        if (character === "\r") { column = 0; continue; }
        if (character === "\b") { column = Math.max(0, column - 1); continue; }
        if (character === "\t") { column += 8 - column % 8; continue; }
        if (character === " ") { column++; continue; }
        const width = portableWidth(character.codePointAt(0)!);
        if (width < 0 && !parsed.flags.has("p")) continue;
        session.check(column + 1, limits.maxRecordBytes, "column");
        retained += encoder.encode(character).length;
        session.check(retained, limits.maxRecordBytes, "record");
        let line = rows.get(row);
        if (!line) { line = new Map(); rows.set(row, line); }
        const cell = { text: character, width: Math.max(0, width) };
        const previous = line.get(column);
        if (noBackspaces || !previous) line.set(column, [cell]);
        else previous.push(cell);
        column += cell.width;
        lastLine = Math.max(lastLine, row + 1);
      }
    };
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    await session.files(["-"], async source => {
      for await (const bytes of source) await consume(decoder.decode(bytes, { stream: true }));
      await consume(decoder.decode());
    });
    for (let lineNumber = firstLine; lineNumber < lastLine; lineNumber++) {
      const step = session.step(); if (step) await step;
      let outputColumn = 0;
      for (const [position, cells] of [...(rows.get(lineNumber) ?? [])].sort((a, b) => a[0] - b[0])) {
        while (outputColumn < position) {
          const step = session.step(); if (step) await step;
          const nextTab = outputColumn + 8 - outputColumn % 8;
          const useTab = tabs && nextTab <= position && nextTab > outputColumn + 1;
          await session.output(Uint8Array.of(useTab ? 9 : 32));
          outputColumn = useTab ? nextTab : outputColumn + 1;
        }
        for (let index = 0; index < cells.length; index++) {
          const cell = cells[index]!;
          if (index) await session.output(encoder.encode("\b".repeat(cells[index - 1]!.width)));
          await session.output(encoder.encode(cell.text));
        }
        outputColumn = position + cells.at(-1)!.width;
      }
      await session.output(Uint8Array.of(10));
    }
  });
}

export function createColCommands(options: ColCommandsOptions = {}): readonly CommandDefinition[] {
  return [createColCommand(options)];
}
export function colCommands(options: ColCommandsOptions = {}): VirtualShellPlugin {
  return { name: "col-commands", setup(host) {
    for (const command of createColCommands(options)) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
