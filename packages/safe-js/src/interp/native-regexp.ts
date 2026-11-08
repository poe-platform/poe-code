export function readNativeRegExp(value: RegExp): { source: string; flags: string } {
  const source = Object.getOwnPropertyDescriptor(RegExp.prototype, "source")!.get!.call(value) as string;
  const flags = ([ ["hasIndices", "d"], ["global", "g"], ["ignoreCase", "i"],
    ["multiline", "m"], ["dotAll", "s"], ["unicode", "u"],
    ["unicodeSets", "v"], ["sticky", "y"] ] as const)
    .filter(([name]) => Object.getOwnPropertyDescriptor(RegExp.prototype, name)?.get?.call(value))
    .map(([, flag]) => flag).join("");
  return { source, flags };
}
