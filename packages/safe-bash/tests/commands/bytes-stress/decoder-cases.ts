import type { ReferenceCase } from "./gnu-cases.js";

export function decoderCases(): readonly ReferenceCase[] {
  const cases: ReferenceCase[] = [];
  for (const command of ["base64", "base32"]) {
    const canonical = command === "base64" ? "Zg==" : "MY======";
    const foobar = command === "base64" ? "Zm9vYmFy" : "MZXW6YTBOI======";
    const invalid = command === "base64"
      ? ["A", "Zg", "Zg=", "=g==", "Z===", "Zg=A", "Zg===", "Zh==", "Zm9=", "Zm!v", "Zm9v\r"]
      : ["M", "MY", "MY=====", "=Y======", "M=======", "MY=====A", "MY=======", "MZ======", "MZXW7===", "mzxw6===", "MZX!6==="];
    const inputs = new Set(["", ...invalid, canonical.slice(1), canonical + canonical, canonical + canonical.replaceAll("=", ""),
      canonical + "A", canonical + "!", canonical.slice(0, -1) + "\n", canonical.slice(0, -1) + "\r\n",
      canonical + "\n", canonical.replaceAll("=", "") + "!", canonical.replaceAll("=", "") + "\0",
      ...Array.from({ length: foobar.length }, (_, offset) => foobar.slice(0, offset + 1)),
    ]);
    for (const text of inputs) for (const args of [["-d"], ["-di"]]) {
      cases.push({ name: `${command} ${args[0]} ${JSON.stringify(text)}`, command, args, input: Buffer.from(text) });
    }
  }
  return cases;
}
