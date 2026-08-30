const literal = (name, args, suffix = "") => `import { search } from "companion"; import { setExitCode } from "command"; setExitCode(await search(${JSON.stringify(name)}, ${JSON.stringify(args)}));${suffix}`;
const bridge = source => `import { exec } from "shell"; import { write } from "stdio"; import { setExitCode } from "command"; const result = await exec(${JSON.stringify(source)}); await write(result.stdout); setExitCode(result.exitCode);`;

export const cases = [
  { id: "literal-grep-success", guest: literal("grep", ["-E", "^alpha", "/work/input"]), output: "alpha 1\nalpha 2\n", exitCode: 0 },
  { id: "literal-rg-success", guest: literal("rg", ["--no-heading", "^alpha", "/work/input"]), output: "alpha 1\nalpha 2\n", exitCode: 0 },
  { id: "literal-grep-early-close", guest: literal("grep", ["-E", "^alpha", "/work/many"]), pipeline: true, output: "alpha 0\n", exitCode: 0 },
  { id: "literal-rg-early-close", guest: literal("rg", ["--no-heading", "^alpha", "/work/many"]), pipeline: true, output: "alpha 0\n", exitCode: 0 },
  { id: "literal-grep-caller-abort", guest: literal("grep", ["-E", "^alpha", "/work/input"]), action: "abort", reason: "error" },
  { id: "literal-rg-caller-abort-record", guest: literal("rg", ["^alpha", "/work/input"]), action: "abort", reason: "record" },
  { id: "literal-grep-dispose", guest: literal("grep", ["-E", "^alpha", "/work/input"]), action: "dispose" },
  { id: "literal-rg-overlap-abort-dispose", guest: literal("rg", ["^alpha", "/work/input"]), action: "overlap", reason: "error" },
  { id: "literal-grep-guest-budget", guest: literal("grep", ["-E", "^alpha", "/work/input"], ' let total = 0; for (let counter = 0; counter < 10000; counter++) { total += counter; } await search("grep", ["^NEVER", "/work/input"]);'), maxSteps: 1000, output: "alpha 1\nalpha 2\n", exitCode: 124, budget: true },
  { id: "literal-grep-guest-error", guest: literal("grep", ["-E", "^alpha", "/work/input"], ' throw new Error("bounded guest failure");'), output: "alpha 1\nalpha 2\n", exitCode: 1, guestError: true },
  { id: "literal-grep-retained-lifetime", guest: literal("grep", ["-E", "^alpha", "/work/input"]), output: "alpha 1\nalpha 2\n", exitCode: 0, retained: true },
  { id: "literal-grep-caller-sink-error", guest: literal("grep", ["-E", "^alpha", "/work/input"]), sinkError: true },
  { id: "literal-grep-caller-sink-status-control", guest: literal("grep", ["-E", "^alpha", "/work/input"]), sinkError: true, statusControl: true },
  { id: "literal-grep-cooperative-hook", guest: literal("grep", ["-E", "^alpha", "/work/input"]), action: "overlap", reason: "error", cooperative: true },
  { id: "literal-preabort-no-admission", guest: literal("grep", ["-E", "^alpha", "/work/input"]), preabort: true, reason: "error" },
  { id: "bridge-grep-success", route: "bridge", guest: bridge("grep -E '^alpha' /work/input"), output: "alpha 1\nalpha 2\n", exitCode: 0 },
  { id: "bridge-rg-early-close", route: "bridge", guest: bridge("rg '^alpha' /work/many | head -n 1"), output: "alpha 0\n", exitCode: 0 },
  { id: "bridge-grep-caller-abort", route: "bridge", guest: bridge("grep -E '^alpha' /work/input"), action: "abort", reason: "error" },
  { id: "bridge-rg-dispose", route: "bridge", guest: bridge("rg '^alpha' /work/input"), action: "dispose" },
];
