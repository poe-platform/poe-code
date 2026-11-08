import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { encodeQr, reedSolomon } from "./encoder.js";

const nativeAvailable = spawnSync("qrencode", ["--version"]).status === 0;

test("matrix fixtures cover standard, Byte and Micro encodings without native tools", () => {
  const fixtures = [
    [{}, "e3294515cb8ad8103e0388784a4764f76ef2be33dea6b5375ee71d8a48cf5ada"],
    [{ byte: true }, "b5cc1b3c949537266d8d468033f4a58967e2d9c47a7a66e12e53a16e6c320c43"],
    [
      { micro: true, version: 4, level: "Q" as const },
      "4f3160a0efc9d22dae97e195420a2e8e3bbae0daef0e2efe64203f3928345ab6"
    ]
  ] as const;
  for (const [options, hash] of fixtures) {
    const qr = encodeQr(new TextEncoder().encode("HELLO"), options);
    const ascii =
      qr.modules.map((row) => row.map((v) => (v ? "##" : "  ")).join("")).join("\n") + "\n";
    assert.equal(createHash("sha256").update(ascii).digest("hex"), hash);
  }
});

test("Micro QR padding and level combinations match native", { skip: !nativeAvailable }, () => {
  for (const version of [1, 2, 3, 4])
    for (const level of ["L", "M", "Q"] as const) {
      if ((version === 1 && level !== "L") || (version < 4 && level === "Q")) continue;
      for (const text of ["1", "12345"]) {
        const expected = execFileSync(
          "qrencode",
          ["--micro", "-v", String(version), "-l", level, "-t", "ASCII", "-m", "0", text],
          { encoding: "utf8" }
        );
        const qr = encodeQr(new TextEncoder().encode(text), { micro: true, version, level });
        assert.equal(
          qr.modules.map((row) => row.map((v) => (v ? "##" : "  ")).join("")).join("\n") + "\n",
          expected,
          `M${version}-${level}: ${text}`
        );
      }
    }
});

test("Reed Solomon matches the published version 1-M HELLO WORLD example", () => {
  assert.deepEqual(
    [
      ...reedSolomon(
        Uint8Array.from([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]),
        10
      )
    ],
    [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]
  );
});

test(
  "representative versions and all correction levels match native matrices",
  { skip: !nativeAvailable },
  () => {
    for (const level of ["L", "M", "Q", "H"] as const)
      for (const version of [1, 2, 5, 7, 10, 14, 21, 27, 32, 40]) {
        const text = "TEST";
        const expected = execFileSync(
          "qrencode",
          ["-t", "ASCII", "-m", "0", "-v", String(version), "-l", level, text],
          { encoding: "utf8" }
        );
        const qr = encodeQr(new TextEncoder().encode(text), { version, level });
        assert.equal(
          qr.modules.map((row) => row.map((v) => (v ? "##" : "  ")).join("")).join("\n") + "\n",
          expected,
          `${version}-${level}`
        );
      }
  }
);

test("QR and Micro QR matrices match native qrencode", { skip: !nativeAvailable }, () => {
  const cases = [
    { text: "01234567", args: [] },
    { text: "HELLO WORLD", args: [] },
    { text: "hello world", args: ["-8"] },
    { text: "https://example.org/π", args: ["-8", "-l", "H"] },
    { text: "12345", args: ["--micro"] },
    { text: "HELLO", args: ["--micro", "-v", "2"] },
    { text: "hello", args: ["--micro", "-v", "3", "-8"] }
  ];
  for (const { text, args } of cases) {
    const output = execFileSync("qrencode", ["-t", "ASCII", "-m", "0", ...args, text], {
      encoding: "utf8"
    });
    const versionIndex = args.indexOf("-v");
    const qr = encodeQr(new TextEncoder().encode(text), {
      micro: args.includes("--micro"),
      byte: args.includes("-8"),
      level: args.includes("H") ? "H" : "L",
      version: versionIndex < 0 ? 0 : Number(args[versionIndex + 1])
    });
    const actual =
      qr.modules.map((row) => row.map((dark) => (dark ? "##" : "  ")).join("")).join("\n") + "\n";
    assert.equal(actual, output, JSON.stringify({ text, args }));
  }
});
