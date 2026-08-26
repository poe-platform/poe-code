export const payload = "alpha\nbeta\n";
export const created = "fresh\nrecord\n";
export const decoys = { "old-label": "old decoy\n", "new-label": "new decoy\n", sentinel: "do not touch\n" };
export type Format = "normal" | "context" | "unified";
export const formats: readonly Format[] = ["normal", "context", "unified"];

export function deletion(format: Format, target = "target"): string {
  if (format === "normal") return "1,2d0\n< alpha\n< beta\n";
  if (format === "context") return `*** ${target}\n--- ${target}\n***************\n*** 1,2 ****\n- alpha\n- beta\n--- 0 ----\n`;
  return `--- ${target}\n+++ ${target}\n@@ -1,2 +0,0 @@\n-alpha\n-beta\n`;
}

export function creation(format: "context" | "unified", target = "target"): string {
  return format === "context"
    ? `*** /dev/null\n--- ${target}\n***************\n*** 0 ****\n--- 1,2 ----\n+ fresh\n+ record\n`
    : `--- /dev/null\n+++ ${target}\n@@ -0,0 +1,2 @@\n+fresh\n+record\n`;
}

export interface Vector {
  name: string;
  args: string[];
  input: string;
  initial: string | null;
  expected: string | null;
  status: number;
  native: boolean;
}

export const vectors: Vector[] = [];
for (const format of formats) {
  const input = deletion(format, "old-label").replace(format === "context" ? "--- old-label" : "+++ old-label",
    format === "context" ? "--- new-label" : "+++ new-label");
  vectors.push({ name: `${format}/without-E-retains-empty`, args: ["/authorized/target"], input,
    initial: payload, expected: "", status: 0, native: true });
  for (const flag of ["-E", "--remove-empty-files"]) {
    for (const mode of ["apply", "dry", "reverse"] as const) {
      vectors.push({ name: `${format}/${flag}/${mode}`, input,
        args: [flag, ...(mode === "dry" ? ["--dry-run"] : mode === "reverse" ? ["-R"] : []), "/authorized/target"],
        initial: mode === "reverse" ? null : payload, expected: mode === "apply" ? null : payload,
        status: 0, native: flag === "-E" || mode === "apply" });
    }
  }
}

for (const format of ["context", "unified"] as const) {
  for (const reverse of [false, true]) for (const explicit of [false, true]) {
    const input = reverse
      ? deletion(format, explicit ? "old-label" : "target").replace(format === "context" ? `--- ${explicit ? "old-label" : "target"}` : `+++ ${explicit ? "old-label" : "target"}`,
        format === "context" ? "--- /dev/null" : "+++ /dev/null")
      : creation(format, explicit ? "new-label" : "target");
    for (const initial of [null, "", "occupied\n"]) for (const dry of [false, true]) {
      vectors.push({ name: `${format}/null/${reverse ? "reverse" : "forward"}/${explicit ? "absolute" : "auto"}/${initial === null ? "missing" : initial === "" ? "empty" : "occupied"}/${dry ? "dry" : "apply"}`,
        args: [...(reverse ? ["-R"] : []), ...(dry ? ["--dry-run"] : []), ...(explicit ? ["/authorized/target"] : [])], input, initial,
        expected: dry || initial === "occupied\n" ? initial : reverse ? payload : created,
        status: initial === "occupied\n" ? 1 : 0, native: explicit && !dry });
    }
  }
}
