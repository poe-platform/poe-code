import { options, type ParsedOptions } from "../internal.js";

export function numericOptions(
  args: readonly string[], short: string, long: Readonly<Record<string, string>>, key?: string,
): ParsedOptions & { readonly legacyValue?: string } {
  const normalized: string[] = [], ordered: string[] = [], operands: string[] = [];
  let ended = false, legacyIndex: number | undefined, legacyFallback = "";
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    normalized.push(argument);
    if (ended || argument === "-" || !argument.startsWith("-")) {
      operands.push(argument);
      continue;
    }
    ordered.push(argument);
    if (argument === "--") { ended = true; continue; }
    if (argument.startsWith("--")) {
      const name = argument.slice(2);
      if (long[name] && short.includes(`${long[name]}:`) && index + 1 < args.length) {
        const argumentValue = args[++index]!;
        normalized.push(argumentValue); ordered.push(argumentValue);
      }
      continue;
    }
    for (let offset = 1; offset < argument.length; offset++) {
      const option = argument[offset]!;
      if (option >= "0" && option <= "9") {
        if (key) {
          normalized[normalized.length - 1] = `${argument.slice(0, offset)}${key}${argument.slice(offset)}`;
          break;
        }
        legacyIndex = index - (offset === argument.length - 1 ? 0 : 1);
        legacyFallback = argument.slice(1);
      } else if (short.includes(`${option}:`)) {
        if (offset === argument.length - 1 && index + 1 < args.length) {
          const argumentValue = args[++index]!;
          normalized.push(argumentValue); ordered.push(argumentValue);
        }
        break;
      } else if (!short.includes(option)) break;
    }
  }
  const parsed = options(normalized, key ? short : `${short}0123456789`, long);
  return legacyIndex === undefined ? parsed : {
    ...parsed, legacyValue: [...ordered, ...operands][legacyIndex]?.slice(1) ?? legacyFallback,
  };
}
