export const conversions = new Set(["ascii", "ebcdic", "ibm", "block", "unblock", "lcase", "ucase", "sparse", "swab", "sync", "noerror", "notrunc", "excl", "nocreat", "fdatasync", "fsync"]);
export const flags = new Set(["append", "binary", "text", "cio", "direct", "directory", "dsync", "noatime", "nocache", "noctty", "nofollow", "nolinks", "nonblock", "sync", "fullblock", "count_bytes", "skip_bytes", "seek_bytes"]);
const maxInteger = (1n << 63n) - 1n;

export class DdError extends Error {
  constructor(message: string, readonly usage = false, readonly warnings: readonly string[] = []) { super(message); }
}

export function quote(text: string, style: "shell" | "locale" = "shell"): string {
  if (style === "shell" && text.includes("'") && !["$", "`", "\\", '"'].some(character => text.includes(character))
    && [...text].every(character => character >= " " && character <= "~")) return `"${text}"`;
  let result = "'";
  let escaped = false;
  const escapes = new Map([[7, "a"], [8, "b"], [9, "t"], [10, "n"], [11, "v"], [12, "f"], [13, "r"]]);
  for (const byte of new TextEncoder().encode(text)) {
    const special = byte < 32 || byte >= 127;
    if (style === "locale") {
      result += special ? `\\${escapes.get(byte) ?? byte.toString(8).padStart(3, "0")}`
        : byte === 39 || byte === 92 ? `\\${String.fromCharCode(byte)}` : String.fromCharCode(byte);
      continue;
    }
    if (special !== escaped) {
      result += special ? "'$'" : "''";
      escaped = special;
    }
    result += special ? `\\${escapes.get(byte) ?? byte.toString(8).padStart(3, "0")}`
      : byte === 39 ? "'\\''" : String.fromCharCode(byte);
  }
  return `${result}'`;
}

export interface DdPlan {
  input?: string;
  output?: string;
  ibs: bigint;
  obs: bigint;
  cbs: bigint;
  count?: bigint;
  countBytes: boolean;
  skip: bigint;
  seek: bigint;
  skipBytes: boolean;
  seekBytes: boolean;
  convert: Set<string>;
  inputFlags: Set<string>;
  outputFlags: Set<string>;
  status: "default" | "none" | "noxfer" | "progress";
  twoBuffers: boolean;
  warnings: string[];
}

function numberValue(text: string, warnings: string[]): bigint {
  let product = 1n;
  let overflow = false;
  const invalid = (): never => { throw new DdError(`invalid number: ${quote(text)}`, false, warnings); };
  for (const factor of text.split("x")) {
    let offset = 0;
    while (offset < factor.length && " \t\r\n\v\f".includes(factor[offset]!)) offset++;
    if (factor[offset] === "+") offset++;
    const start = offset;
    let value = 0n;
    while (offset < factor.length && factor[offset]! >= "0" && factor[offset]! <= "9") {
      if (value <= maxInteger) value = value * 10n + BigInt(factor[offset]!);
      offset++;
    }
    const suffix = factor.slice(offset);
    if (offset === start) {
      if (!suffix || !"bcEGkKMPQRTwYZ".includes(suffix[0]!)) invalid();
      value = 1n;
    }
    let multiplier = 1n;
    if (suffix === "b" || suffix === "bB") multiplier = 512n;
    else if (suffix === "w" || suffix === "wB") multiplier = 2n;
    else if (suffix !== "" && suffix !== "B" && suffix !== "c" && suffix !== "cB") {
      const power = "KMGTPEZYRQ".indexOf(suffix[0]!.toUpperCase()) + 1;
      const tail = suffix.slice(1);
      if (!power || !["", "B", "iB", "D"].includes(tail) || !"kKMGTPEZYRQ".includes(suffix[0]!)) invalid();
      multiplier = (tail === "B" || tail === "D" ? 1000n : 1024n) ** BigInt(power);
    }
    value *= multiplier;
    if (value > maxInteger) overflow = true;
    product *= value > maxInteger ? maxInteger + 1n : value;
    if (product > maxInteger) { overflow = true; product = maxInteger + 1n; }
  }
  for (const factor of text.split("x").slice(0, -1)) {
    if (factor === "0" && product === 0n) warnings.push("warning: '0x' is a zero multiplier; use '00x' if that is intended");
  }
  if (product !== 0n && overflow) throw new DdError(`invalid number: ${quote(text)}: Value too large to be stored in data type`, false, warnings);
  return product;
}

export function parseDd(args: readonly string[]): DdPlan | "help" | "version" {
  for (const argument of args) {
    if (argument === "--") break;
    if (argument.startsWith("--") && argument.length > 2) {
      const option = argument.split("=")[0]!;
      for (const name of ["help", "version"] as const) {
        if (`--${name}`.startsWith(option)) {
          if (argument.includes("=")) throw new DdError(`option '--${name}' doesn't allow an argument`, true);
          return name;
        }
      }
      throw new DdError(`unrecognized option \`${argument}'`, true);
    }
    if (argument.startsWith("-") && argument !== "-") throw new DdError(`invalid option -- ${quote(argument[1]!, "locale")}`, true);
  }
  const plan: DdPlan = { ibs: 512n, obs: 512n, cbs: 0n, countBytes: false, skip: 0n, seek: 0n,
    skipBytes: false, seekBytes: false, convert: new Set(), inputFlags: new Set(), outputFlags: new Set(),
    status: "default", twoBuffers: true, warnings: [] };
  let blockSize: bigint | undefined;
  let delimiter = false;
  for (const argument of args) {
    if (argument === "--" && !delimiter) { delimiter = true; continue; }
    const boundary = argument.indexOf("=");
    const name = argument.slice(0, boundary), value = argument.slice(boundary + 1);
    if (boundary < 0) throw new DdError(`unrecognized operand ${quote(argument)}`, true, plan.warnings);
    if (name === "if") plan.input = value;
    else if (name === "of") plan.output = value;
    else if (["conv", "iflag", "oflag", "status"].includes(name)) {
      const allowed = name === "conv" ? conversions : name === "status" ? new Set(["none", "noxfer", "progress"]) : flags;
      const category = name === "conv" ? "conversion" : name === "status" ? "status level" : name === "iflag" ? "input flag" : "output flag";
      for (const symbol of value.split(",")) {
        if (!allowed.has(symbol) || name === "oflag" && symbol === "fullblock") throw new DdError(`invalid ${category}: ${quote(symbol, "locale")}`, true, plan.warnings);
        if (name === "status") plan.status = symbol as "none" | "noxfer" | "progress";
        else (name === "conv" ? plan.convert : name === "iflag" ? plan.inputFlags : plan.outputFlags).add(symbol);
      }
    } else {
      if (!["bs", "ibs", "obs", "cbs", "count", "skip", "iseek", "seek", "oseek"].includes(name)) {
        throw new DdError(`unrecognized operand ${quote(argument)}`, true, plan.warnings);
      }
      const number = numberValue(value, plan.warnings);
      if (["bs", "ibs", "obs", "cbs"].includes(name) && number === 0n) throw new DdError(`invalid number: ${quote(value)}`, false, plan.warnings);
      if (["bs", "ibs", "obs"].includes(name) && number === maxInteger) throw new DdError(`invalid number: ${quote(value)}: Value too large to be stored in data type`, false, plan.warnings);
      if (name === "bs") blockSize = number;
      else if (name === "ibs" || name === "obs" || name === "cbs") plan[name] = number;
      else if (name === "count") { plan.count = number; plan.countBytes = value.includes("B"); }
      else if (name === "skip" || name === "iseek") { plan.skip = number; plan.skipBytes = value.includes("B"); }
      else { plan.seek = number; plan.seekBytes = value.includes("B"); }
    }
  }
  if (blockSize !== undefined) plan.ibs = plan.obs = blockSize;
  plan.twoBuffers = blockSize === undefined || [...plan.convert].some(value => ["ascii", "ebcdic", "ibm", "block", "unblock", "lcase", "ucase", "swab"].includes(value));
  if (plan.convert.has("ascii")) plan.convert.add("unblock");
  if (plan.convert.has("ebcdic") || plan.convert.has("ibm")) plan.convert.add("block");
  if (plan.cbs === 0n) { plan.convert.delete("block"); plan.convert.delete("unblock"); }
  for (const group of [["ascii", "ebcdic", "ibm"], ["block", "unblock"], ["lcase", "ucase"], ["excl", "nocreat"]]) {
    if (group.filter(value => plan.convert.has(value)).length > 1) throw new DdError(`cannot combine ${group.length === 3 ? "any two of {ascii,ebcdic,ibm}" : group.join(" and ")}`, false, plan.warnings);
  }
  if ([plan.inputFlags, plan.outputFlags].some(values => values.has("direct") && values.has("nocache"))) throw new DdError("cannot combine direct and nocache", false, plan.warnings);
  plan.countBytes ||= plan.inputFlags.has("count_bytes");
  plan.skipBytes ||= plan.inputFlags.has("skip_bytes");
  plan.seekBytes ||= plan.outputFlags.has("seek_bytes");
  return plan;
}
