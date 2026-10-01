import type { FileStat } from "safe-bash-contracts";
import { UsageError } from "safe-bash-contracts/diagnostics";


type ModeChange = (stat: Pick<FileStat, "mode" | "type">) => number;


export function modeChange(text: string, umask: number): ModeChange {
  const numeric = /^([+=-]?)([0-7]+)$/u.exec(text);
  if (numeric) {
    const bits = Number.parseInt(numeric[2]!, 8);
    if (bits > 0o7777) throw new UsageError(`invalid mode: '${text}'`);
    return stat => {
      const current = stat.mode & 0o7777;
      if (numeric[1] === "+") return current | bits;
      if (numeric[1] === "-") return current & ~bits;
      return bits | (stat.type === "directory" && !numeric[1] && numeric[2]!.length < 5 ? current & 0o6000 : 0);
    };
  }
  const clauses = text.split(",").map(clause => {
    const match = /^([ugoa]*)((?:[+=-](?:[rwxXst]*|[ugo]))+)$/u.exec(clause);
    if (!match) throw new UsageError(`invalid mode: '${text}'`);
    const who = match[1]!;
    const operations = [...match[2]!.matchAll(/([+=-])([^+=-]*)/gu)].map(operation => ({ operator: operation[1]!, permissions: operation[2]! }));
    return { who, operations };
  });
  return stat => {
    let current = stat.mode & 0o7777;
    for (const { who, operations } of clauses) {
      const all = !who || who.includes("a");
      const users = (all || who.includes("u") ? 0o4700 : 0) | (all || who.includes("g") ? 0o2070 : 0) | (all || who.includes("o") ? 0o1007 : 0);
      for (const { operator, permissions } of operations) {
        let bits = 0;
        if (/^[ugo]$/u.test(permissions)) {
          const shift = permissions === "u" ? 6 : permissions === "g" ? 3 : 0;
          const copied = current >> shift & 7;
          bits = copied << 6 | copied << 3 | copied;
        } else {
          if (permissions.includes("r")) bits |= 0o444;
          if (permissions.includes("w")) bits |= 0o222;
          if (permissions.includes("x") || permissions.includes("X") && (stat.type === "directory" || (current & 0o111) !== 0)) bits |= 0o111;
          if (permissions.includes("s")) bits |= 0o6000;
          if (permissions.includes("t")) bits |= 0o1000;
        }
        bits &= users;
        if (!who) bits &= ~umask;
        if (operator === "+") current |= bits;
        else if (operator === "-") current &= ~bits;
        else {
          const preserve = stat.type === "directory" && !permissions.includes("s") ? 0o6000 : 0;
          current = current & ~(users & ~preserve) | bits;
        }
      }
    }
    return current;
  };
}