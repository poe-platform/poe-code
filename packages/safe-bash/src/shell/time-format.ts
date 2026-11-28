export function formatTime(format: string, elapsed: number): string {
  if (!format) return "";
  let output = "";
  for (let index = 0; index < format.length; index++) {
    let character = format[index]!;
    if (character !== "%" || index === format.length - 1) {
      output += character;
      continue;
    }
    character = format[++index]!;
    if (character === "%") {
      output += "%";
      continue;
    }
    // Unlike durations, utilization accepts no precision or long modifier.
    if (character === "P") {
      output += "0.00";
      continue;
    }
    let precision = 3;
    if (character >= "0" && character <= "9") {
      precision = Math.min(Number(character), 3);
      character = format[++index]!;
    }
    const long = character === "l";
    if (long) character = format[++index]!;
    // Virtual commands have no separately attributable process CPU usage.
    if (character === "R" || character === "U" || character === "S") {
      const seconds = character === "R" ? elapsed : 0;
      const rounded = Number(seconds.toFixed(precision));
      output += long
        ? `${Math.floor(rounded / 60)}m${(rounded % 60).toFixed(precision)}s`
        : rounded.toFixed(precision);
    } else {
      return `shell: TIMEFORMAT: \`${character ?? "\0"}': invalid format character\n`;
    }
  }
  return `${output}\n`;
}
