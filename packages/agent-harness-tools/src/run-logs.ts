import path from "node:path";

export interface ResolveRunLogDirOptions {
  planPath: string;
  runner: string;
  homeDir: string;
}

export function resolveRunLogDir(options: ResolveRunLogDirOptions): string {
  const slug = slugifyPlanPath(options.planPath);
  return path.join(options.homeDir, ".poe-code", "logs", options.runner, slug);
}

export function slugifyPlanPath(planPath: string): string {
  const base = path.basename(planPath);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return slugifyLabel(stem);
}

export function makeRunLogFileName(role: string, date: Date = new Date()): string {
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}`;
  const time = `${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}${pad(date.getUTCSeconds(), 2)}`;
  const ms = pad(date.getUTCMilliseconds(), 3);
  const safeRole = slugifyLabel(role) || "role";
  return `${day}-${time}-${ms}-${safeRole}.jsonl`;
}

function slugifyLabel(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    const lower = code >= 97 && code <= 122;
    const upper = code >= 65 && code <= 90;
    const digit = code >= 48 && code <= 57;

    if (lower || digit) {
      out += char;
    } else if (upper) {
      out += String.fromCharCode(code + 32);
    } else if (char === "-" || char === "_") {
      out += char;
    } else {
      out += "-";
    }
  }

  return collapseDashes(out).replace(/^-+|-+$/g, "");
}

function collapseDashes(value: string): string {
  let out = "";
  let prevDash = false;
  for (const char of value) {
    if (char === "-") {
      if (!prevDash) {
        out += "-";
      }
      prevDash = true;
    } else {
      out += char;
      prevDash = false;
    }
  }
  return out;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
