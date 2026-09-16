import { InstallError, quote } from "./options.js";

export interface InstallMode { readonly file: number; readonly directory: number; readonly directoryMask: number }

export function parseMode(text: string | undefined, rawBytes?: Uint8Array): InstallMode {
  if (text === undefined) return { file: 0o755, directory: 0o755, directoryMask: 0o7777 };
  const invalid = () => new InstallError(`invalid mode ${quote(text, true, rawBytes)}`);
  const numeric = "+-=".includes(text[0] ?? "!") ? text.slice(1) : text;
  if (numeric && Array.from(numeric).every(character => character >= "0" && character <= "7")) {
    const bits = Number.parseInt(numeric, 8);
    if (bits > 0o7777 || !Number.isSafeInteger(bits)) throw invalid();
    const subtract = text[0] === "-";
    return { file: subtract ? 0 : bits, directory: subtract ? 0 : bits, directoryMask: text[0] === "+" || subtract ? bits : 0o7777 };
  }
  let file = 0, directory = 0, directoryMask = 0;
  for (const clause of text.split(",")) {
    let offset = 0, who = "";
    while (offset < clause.length && "ugoa".includes(clause[offset]!)) who += clause[offset++]!;
    const all = !who || who.includes("a");
    const users = (all || who.includes("u") ? 0o4700 : 0) | (all || who.includes("g") ? 0o2070 : 0) | (all || who.includes("o") ? 0o1007 : 0);
    if (offset === clause.length) throw invalid();
    while (offset < clause.length) {
      const operator = clause[offset++]!;
      if (!"+-=".includes(operator)) throw invalid();
      let permissions = "";
      while (offset < clause.length && !"+-=".includes(clause[offset]!)) permissions += clause[offset++]!;
      const copy = permissions.length === 1 && "ugo".includes(permissions);
      if (!copy && !Array.from(permissions).every(character => "rwxXst".includes(character))) throw invalid();
      const bitsFor = (current: number, isDirectory: boolean) => {
        let bits = 0;
        if (copy) { const shift = permissions === "u" ? 6 : permissions === "g" ? 3 : 0; const value = current >> shift & 7; bits = value << 6 | value << 3 | value; }
        else {
          if (permissions.includes("r")) bits |= 0o444;
          if (permissions.includes("w")) bits |= 0o222;
          if (permissions.includes("x") || permissions.includes("X") && (isDirectory || (current & 0o111) !== 0)) bits |= 0o111;
          if (permissions.includes("s")) bits |= 0o6000;
          if (permissions.includes("t")) bits |= 0o1000;
        }
        return bits & users;
      };
      const fileBits = bitsFor(file, false), directoryBits = bitsFor(directory, true);
      if (operator === "+") { file |= fileBits; directory |= directoryBits; }
      else if (operator === "-") { file &= ~fileBits; directory &= ~directoryBits; }
      else { file = file & ~users | fileBits; directory = directory & ~users | directoryBits; }
      directoryMask |= operator === "=" ? users : directoryBits;
    }
  }
  return { file, directory, directoryMask };
}
