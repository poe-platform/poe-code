import { createHash } from "node:crypto";

export interface ReferenceCase {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly input: Uint8Array;
  readonly files?: Readonly<Record<string, Uint8Array>>;
}

const payloadMember = Buffer.from("1f8b08000000000000ff010700f8ff7061796c6f6164156a2c4207000000", "hex");
const reservedMember = Buffer.from(payloadMember); reservedMember[3] = 32;

export const dialectCases: readonly ReferenceCase[] = [
  { name: "empty forced input", command: "gzip", args: ["-dfc"], input: Buffer.alloc(0) },
  { name: "one-byte forced input", command: "gzip", args: ["-dfc"], input: Buffer.from([31]) },
  { name: "zero padding after member", command: "gzip", args: ["-t"], input: Buffer.concat([payloadMember, Buffer.alloc(8)]) },
  { name: "reserved header flag", command: "gzip", args: ["-t"], input: reservedMember },
];

export function coreutilsCases(): readonly ReferenceCase[] {
  const cases: ReferenceCase[] = [];
  const binary = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
  for (const command of ["base64", "base32"]) {
    for (const args of [[], ["-w0"], ["-w1"], ["-w19"]]) {
      cases.push({ name: `${command} binary ${args.join(" ") || "default"}`, command, args, input: binary });
    }
    const encoded = command === "base64" ? "Zm9vYmFy" : "MZXW6YTBOI======";
    cases.push({ name: `${command} garbage`, command, args: ["-di"], input: Buffer.from(` \t!${encoded}\r\n`) });
  }
  const names = ["data", "back\\slash", "new\nline", "return\rname", "é😀", " leading "];
  const data = Buffer.from([0, 255, 128, 13, 10, 5]);
  const files = Object.fromEntries(names.map(name => [name, data]));
  for (const [command, algorithm] of [["sha256sum", "sha256"], ["sha1sum", "sha1"], ["md5sum", "md5"]] as const) {
    const digest = createHash(algorithm).update(data).digest("hex");
    const manifest = names.map(name => /[\\\n\r]/u.test(name)
      ? `\\${digest}  ${name.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r")}\n`
      : `${digest}  ${name}\n`).join("");
    for (const flags of [[], ["-b"], ["-btb", "--text"], ["-z"]]) {
      cases.push({ name: `${command} filenames ${flags.join(" ") || "default"}`, command, args: [...flags, ...names], input: Buffer.alloc(0), files });
    }
    for (const flags of [[], ["--quiet"], ["--status"], ["--strict"], ["--warn"], ["--quiet", "--status", "--warn"]]) {
      cases.push({ name: `${command} check ${flags.join(" ") || "default"}`, command, args: ["-c", ...flags], input: Buffer.from(manifest), files });
    }
    const first = `${digest}  data\n`;
    for (const [label, input, flags] of [
      ["malformed", first + "invalid\n", []],
      ["strict malformed", first + "invalid\n", ["--strict"]],
      ["all missing", `${digest}  missing\n`, ["--ignore-missing"]],
      ["some missing", `${digest}  missing\n` + first, ["--ignore-missing"]],
      ["mismatch", `${digest[0] === "f" ? "0" : "f"}${first.slice(1)}`, ["--quiet"]],
    ] as const) {
      cases.push({ name: `${command} ${label}`, command, args: ["-c", ...flags], input: Buffer.from(input), files });
    }
  }
  return cases;
}

export function caseHash(value: ReferenceCase): string {
  return createHash("sha256").update(JSON.stringify({
    name: value.name, command: value.command, args: value.args, inputHex: Buffer.from(value.input).toString("hex"),
    files: Object.fromEntries(Object.entries(value.files ?? {}).map(([name, bytes]) => [name, Buffer.from(bytes).toString("hex")])),
  })).digest("hex");
}
