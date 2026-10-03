import { commandRuntimeIdentity, getCommandArguments, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { InputByteBudget, collectBytes, writeBytes } from "safe-bash-contracts/io";
import { resolvePath } from "safe-bash-contracts/path";
import { yieldTurn } from "safe-bash-contracts/yield";

export interface WdiffLimits { readonly maxInputBytes: number; readonly maxMatrixCells: number }
export interface WdiffCommandsOptions { readonly limits?: Partial<WdiffLimits>; readonly replace?: boolean }

interface Word { text: string; space: string }
async function words(bytes: Uint8Array, signal: AbortSignal): Promise<{ words: Word[]; trailing: string }> {
  // One code unit per byte keeps invalid UTF-8 and distinct byte words intact.
  let text = "";
  for (let start = 0; start < bytes.length; start += 16384) {
    text += String.fromCharCode(...bytes.subarray(start, start + 16384));
    await yieldTurn(signal);
  }
  const isSpace = (offset: number): boolean => {
    const byte = text.charCodeAt(offset);
    return byte === 32 || (byte >= 9 && byte <= 13);
  };
  const result: Word[] = [];
  let offset = 0;
  while (offset < text.length) {
    const start = offset;
    while (offset < text.length && isSpace(offset)) {
      if (++offset % 16384 === 0) await yieldTurn(signal);
    }
    const space = text.slice(start, offset);
    const first = offset;
    while (offset < text.length && !isSpace(offset)) {
      if (++offset % 16384 === 0) await yieldTurn(signal);
    }
    if (first === offset) return { words: result, trailing: space };
    result.push({ space, text: text.slice(first, offset) });
  }
  return { words: result, trailing: "" };
}

export function createWdiffCommand(options: WdiffCommandsOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes ?? 8 * 1024 * 1024);
  const maxMatrixCells = InputByteBudget.limit(options.limits?.maxMatrixCells ?? 4_000_000);
  return {
    name: "wdiff", runtimeIdentity: commandRuntimeIdentity,
    async execute(context) {
      return new InputByteBudget(maxInputBytes, context.inputBudget).run(context, async context => {
        const args = getCommandArguments(context).args;
        if (args.length === 1 && args[0] === "--help") {
          await writeBytes(context.stdout, new TextEncoder().encode("Usage: wdiff OLD NEW\nCompare whitespace-delimited words; [-deleted-] and {+inserted+}.\n"), context.signal);
          return { exitCode: 0 };
        }
        const operands = args[0] === "--" ? args.slice(1) : args;
        if (operands.length !== 2 || operands.filter(name => name === "-").length > 1) {
          await writeBytes(context.stderr, new TextEncoder().encode("wdiff: expected two files (at most one stdin operand)\n"), context.signal);
          return { exitCode: 2 };
        }
        const inputs: Awaited<ReturnType<typeof words>>[] = [];
        for (const name of operands) {
          const bytes = name === "-" ? await collectBytes(context.stdin, { signal: context.signal })
            : await context.fs.readFile(resolvePath(context.cwd, name), { signal: context.signal });
          inputs.push(await words(bytes, context.signal));
        }
        const old = inputs[0]!; const next = inputs[1]!;
        const a = old.words; const b = next.words;
        const width = b.length + 1;
        const cells = (a.length + 1) * width;
        if (!Number.isSafeInteger(cells) || cells > maxMatrixCells) throw new RangeError("wdiff: matrix cell limit exceeded");
        const matrix = new Uint32Array(cells);
        let operations = 0;
        for (let i = a.length - 1; i >= 0; i--) {
          for (let j = b.length - 1; j >= 0; j--) {
            matrix[i * width + j] = a[i]!.text === b[j]!.text ? 1 + matrix[(i + 1) * width + j + 1]!
              : Math.max(matrix[(i + 1) * width + j]!, matrix[i * width + j + 1]!);
            if (++operations % 32768 === 0) await yieldTurn(context.signal);
          }
          if (i % 32 === 0) await yieldTurn(context.signal);
        }
        let output = ""; let i = 0; let j = 0; let changed = false;
        while (i < a.length || j < b.length) {
          if (++operations % 16384 === 0) await yieldTurn(context.signal);
          if (i < a.length && j < b.length && a[i]!.text === b[j]!.text) {
            output += b[j]!.space + b[j]!.text; i++; j++; continue;
          }
          changed = true;
          const removed: Word[] = []; const added: Word[] = [];
          while ((i < a.length || j < b.length) && !(i < a.length && j < b.length && a[i]!.text === b[j]!.text)) {
            if (++operations % 16384 === 0) await yieldTurn(context.signal);
            if (i < a.length && (j === b.length || matrix[(i + 1) * width + j]! >= matrix[i * width + j + 1]!)) removed.push(a[i++]!);
            else added.push(b[j++]!);
          }
          if (removed.length) output += removed[0]!.space + "[-" + removed.map((word, index) => (index ? word.space : "") + word.text).join("") + "-]";
          if (added.length) output += (removed.length ? " " : added[0]!.space) + "{+" + added.map((word, index) => (index ? word.space : "") + word.text).join("") + "+}";
          await yieldTurn(context.signal);
        }
        output += next.trailing;
        const outputBytes = new Uint8Array(output.length);
        for (let offset = 0; offset < output.length; offset++) {
          outputBytes[offset] = output.charCodeAt(offset);
          if (offset % 16384 === 0) await yieldTurn(context.signal);
        }
        await writeBytes(context.stdout, outputBytes, context.signal);
        return { exitCode: changed ? 1 : 0 };
      });
    },
  };
}

export function createWdiffCommands(options: WdiffCommandsOptions = {}): readonly CommandDefinition[] { return [createWdiffCommand(options)]; }
export function wdiffCommands(options: WdiffCommandsOptions = {}): VirtualShellPlugin {
  const commands = createWdiffCommands(options);
  return { name: "wdiff", setup(host) { for (const command of commands) host.commands.register(command, { replace: options.replace ?? false }); } };
}
