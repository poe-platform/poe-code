import { InputError, observe, Session, type Input } from "./io.js";
import { integerMaximum, quote, type CmpArguments } from "./options.js";
import { yieldTurn } from "../../contracts/yield.js";

function displayByte(byte: number): string {
  const high = byte >= 128;
  const value = high ? byte - 128 : byte;
  return `${high ? "M-" : ""}${value < 32 ? `^${String.fromCharCode(value + 64)}` : value === 127 ? "^?" : String.fromCharCode(value)}`;
}

function remaining(input: Input, skip: bigint): bigint | undefined {
  if (input.stat?.type !== "file" || !Number.isSafeInteger(input.stat.size) || input.stat.size < 0) return undefined;
  const size = BigInt(input.stat.size);
  return skip < size ? size - skip : 0n;
}

export async function compare(session: Session, args: CmpArguments): Promise<number> {
  const left = await session.open(args.files[0]);
  if (args.files[0] === args.files[1] && (args.files[0] === "-" || args.skips[0] === args.skips[1] && args.skips[0] <= integerMaximum)) return 0;
  const right = await session.open(args.files[1]);
  if (left.path !== undefined && right.path !== undefined && args.skips[0] === args.skips[1] && args.skips[0] <= integerMaximum
    && session.context.fs.compareEntry && await observe(() => session.context.fs.compareEntry!(left.path!, session.context.fs, right.path!, { signal: session.signal }), session.signal) === "same") return 0;
  const sizes = [remaining(left, args.skips[0]), remaining(right, args.skips[1])];
  if (args.mode === "silent" && sizes[0] !== undefined && sizes[1] !== undefined && sizes[0] !== sizes[1]
    && (sizes[0] < sizes[1] ? sizes[0] : sizes[1]) < args.count) return 1;
  const comparisonBlockBytes = session.comparisonBlockBytes ?? left.stat?.ioBlockSize ?? 65536;
  if (!Number.isSafeInteger(comparisonBlockBytes) || comparisonBlockBytes < 1) {
    throw new InputError(left.name, new Error("invalid preferred I/O block size"), false);
  }
  let maximum = args.count;
  for (const size of sizes) if (size !== undefined && size < maximum) maximum = size;
  const width = maximum.toString().length;
  const inputs = [left, right] as const;
  const cursors = inputs.map((input, index) => session.cursor(input, args.skips[index]!));
  for (let index = 0; index < 2; index++) {
    const skip = args.skips[index]!;
    if (skip > integerMaximum && inputs[index]!.stat?.type !== "file") throw new InputError(inputs[index]!.name, new Error("Value too large to be stored in data type"), false);
    if (inputs[index]!.path === undefined || session.context.fs.readStream && (inputs[index]!.stat?.type !== "file" || inputs[index]!.stat!.size < 0)) await cursors[index]!.skip(skip);
    if (inputs[index]!.stat?.type === "directory") await cursors[index]!.available();
  }
  let compared = 0n, line = 1n, atLineStart = true, work = 0;
  while (true) {
    const remaining = args.count - compared;
    const requested = Number(remaining < BigInt(comparisonBlockBytes) ? remaining : BigInt(comparisonBlockBytes));
    const first = await cursors[0]!.block(requested), second = await cursors[1]!.block(requested);
    const count = Math.min(first.length, second.length);
    let different = false, output = "";
    for (let offset = 0; offset < count; offset++) {
      const byteLeft = first[offset]!, byteRight = second[offset]!;
      compared++;
      if (byteLeft !== byteRight) {
        different = true;
        if (args.mode === "silent") return 1;
        const octalLeft = byteLeft.toString(8).padStart(3, " "), octalRight = byteRight.toString(8).padStart(3, " ");
        if (args.mode === "first") {
          await session.output(`${left.name} ${right.name} differ: ${args.printBytes ? "byte" : "char"} ${compared}, line ${line}${args.printBytes ? ` is ${octalLeft} ${displayByte(byteLeft)} ${octalRight} ${displayByte(byteRight)}` : ""}\n`);
          return 1;
        }
        output += `${compared.toString().padStart(width, " ")} ${octalLeft} ${args.printBytes ? `${displayByte(byteLeft).padEnd(4, " ")} ` : ""}${octalRight}${args.printBytes ? ` ${displayByte(byteRight)}` : ""}\n`;
        if (output.length >= 16384) { await session.output(output); output = ""; }
      }
      if (byteLeft === 10) line++;
      atLineStart = byteLeft === 10;
    }
    if (output) await session.output(output);
    if (first.length !== second.length) {
      if (args.mode !== "silent") {
        const name = first.length < second.length ? left.name : right.name;
        const extra = compared === 0n ? "which is empty" : args.mode === "all" ? `after byte ${compared}`
          : `after byte ${compared}, ${atLineStart ? "line" : "in line"} ${atLineStart ? line - 1n : line}`;
        await session.output(`cmp: EOF on ${quote(name)} ${extra}\n`, true);
      }
      return 1;
    }
    if (first.length !== comparisonBlockBytes) return different ? 1 : 0;
    work += count;
    if (work >= 65536) { await yieldTurn(session.signal); work = 0; }
  }
}
