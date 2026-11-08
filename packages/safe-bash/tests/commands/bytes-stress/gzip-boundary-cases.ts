import type { ReferenceCase } from "./gnu-cases.js";

const member = Buffer.from("1f8b08000000000000ff010700f8ff7061796c6f6164156a2c4207000000", "hex");

export function gzipBoundaryCases(): readonly ReferenceCase[] {
  const cases: ReferenceCase[] = [];
  for (const [label, suffix] of [
    ["no suffix", Buffer.alloc(0)],
    ["one zero", Buffer.alloc(1)],
    ["eight zeros", Buffer.alloc(8)],
    ["large zero padding", Buffer.alloc(65537)],
    ["junk", Buffer.from("junk")],
    ["zeros then junk", Buffer.from([0, 0, 33])],
    ["single magic byte", Buffer.from([31])],
    ["truncated next header", Buffer.from([31, 139])],
    ["next member", member],
    ["zeros then next member", Buffer.concat([Buffer.alloc(8), member])],
  ] as const) for (const args of [["-dc"], ["-dfc"], ["-t"], ["-tf"]]) {
    cases.push({ name: `${label} ${args[0]}`, command: "gzip", args, input: Buffer.concat([member, suffix]) });
  }
  for (const input of [Buffer.alloc(0), Buffer.from([31]), Buffer.from("plain")]) {
    cases.push({ name: `forced test ${input.toString("hex") || "empty"}`, command: "gzip", args: ["-tf"], input });
  }
  for (const args of [["-d"], ["-dk"], ["-df"], ["-dfk"]]) {
    const files: Record<string, Uint8Array> = { "input.gz": Buffer.concat([member, Buffer.from("junk")]) };
    if (args[0]!.includes("f")) files.input = Buffer.from("previous output");
    cases.push({ name: `warning publication ${args[0]}`, command: "gzip", args: [...args, "input.gz"], input: Buffer.alloc(0), files });
  }
  return cases;
}
