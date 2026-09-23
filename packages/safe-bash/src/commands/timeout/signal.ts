// Linux signal numbers give virtual commands stable statuses on every host.
const signalNames = ["HUP", "INT", "QUIT", "ILL", "TRAP", "ABRT", "BUS", "FPE", "KILL", "USR1", "SEGV", "USR2", "PIPE", "ALRM", "TERM", "STKFLT", "CHLD", "CONT", "STOP", "TSTP", "TTIN", "TTOU", "URG", "XCPU", "XFSZ", "VTALRM", "PROF", "WINCH", "IO", "PWR", "SYS"];

export function parseSignal(value: string): number | undefined {
  let name = value.toUpperCase();
  if (name.startsWith("SIG")) name = name.slice(3);
  if (name === "EXIT") return 0;
  if (name.length > 0 && [...name].every(character => character >= "0" && character <= "9")) {
    const number = Number(name);
    return number <= 64 ? number : undefined;
  }
  if (name === "IOT") name = "ABRT";
  if (name === "CLD") name = "CHLD";
  if (name === "POLL") name = "IO";
  const index = signalNames.indexOf(name);
  if (index >= 0) return index + 1;
  for (const [prefix, base, direction] of [["RTMIN", 34, 1], ["RTMAX", 64, -1]] as const) {
    if (name === prefix) return base;
    const separator = direction === 1 ? "+" : "-";
    if (name.startsWith(prefix + separator)) {
      const offset = name.slice(prefix.length + 1);
      if (offset.length > 0 && [...offset].every(character => character >= "0" && character <= "9")) {
        const number = base + direction * Number(offset);
        if (number >= 34 && number <= 64) return number;
      }
    }
  }
  return undefined;
}
