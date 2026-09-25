import { options, type ParsedOptions } from "../internal.js";

export function numericOptions(
  args: readonly string[], short: string, long: Readonly<Record<string, string | false>>, key?: string,
  onOption?: (key: string, value: string | undefined) => void,
  allowNumericSuffixOptions = false,
): ParsedOptions & { readonly legacyValue?: string } {
  const normalized: string[] = [], ordered: string[] = [], operands: string[] = [];
  let ended = false, legacyIndex: number | undefined, legacyFallback = "";
  for (let index = 0; index < args.length; index++) {
    let argument = args[index]!;
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
          if (!allowNumericSuffixOptions) {
            normalized[normalized.length - 1] = `${argument.slice(0, offset)}${key}${argument.slice(offset)}`;
            break;
          }
          let end = offset;
          while (
            end < argument.length &&
            ((argument[end]! >= "0" && argument[end]! <= "9") ||
              argument[end] === "," ||
              argument[end] === "+" ||
              argument[end] === "/")
          ) {
            end++;
          }
          normalized.pop();
          if (offset > 1) normalized.push(argument.slice(0, offset));
          normalized.push(`-${key}${argument.slice(offset, end)}`);
          if (end < argument.length) {
            argument = `-${argument.slice(end)}`;
            normalized.push(argument);
            offset = 0;
            continue;
          }
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
  const parsed = options(normalized, key ? short : `${short}0123456789`, long, false, undefined, undefined, onOption);
  return legacyIndex === undefined ? parsed : {
    ...parsed, legacyValue: [...ordered, ...operands][legacyIndex]?.slice(1) ?? legacyFallback,
  };
}
