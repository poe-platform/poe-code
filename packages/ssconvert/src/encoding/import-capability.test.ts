import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand } from "../index.js";
import { decodeText } from "./decode.js";

// These native converters have no captured JS multibyte mapping/error profile.
// WHATWG support is not evidence of iconv compatibility.
it.each(["SHIFT_JIS", "SJIS", "BIG5", "GBK", "EUC-JP", "ISO-2022-JP"])(
  "refuses uncaptured native import capability %s even when TextDecoder admits it", charset => {
    expect(() => decodeText(new Uint8Array([65, 10]), charset))
      .toThrow("uncaptured import charset");
  }
);

it("refuses SHIFT_JIS backslash/tilde rather than returning WHATWG's different characters", () => {
  // Native 1.12.61, forced Gnumeric_stf:stf_csvtab import, UTF-8 export:
  // input 5c7e0a -> c2a5e280be0a (yen, overline, LF), status 0, no stderr.
  // The old TextDecoder path returned 5c7e0a unchanged.
  expect(() => decodeText(new Uint8Array([0x5c, 0x7e, 10]), "SHIFT_JIS"))
    .toThrow("uncaptured import charset");
});

it("shares capability refusal between CLI and SDK without publishing a destination", async () => {
  const volume = Volume.fromJSON({ "/input.csv": "A\n", "/output.csv": "preserve" });
  const engine = createEngine({ codecs: [],
    limits: { inputBytes: 4096, outputBytes: 4096, cells: 10, sheets: 2, operations: 100 },
    environment: { env: {}, locale: "C", timezone: "UTC" },
    filesystem: {
      async read(path) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path, bytes) { volume.writeFileSync(path, bytes); }
    }
  });
  const errors: Uint8Array[] = [];
  const operation = { signal: new AbortController().signal,
    stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(new Uint8Array(bytes)); } }
  };
  try {
    const result = await runCommand(["-E", "BIG5", "/input.csv", "/output.csv"], engine, operation);
    expect(result.exitCode).toBe(1);
    expect(errors).toEqual([new TextEncoder().encode("Unsupported ssconvert feature: uncaptured import charset\n")]);
    await expect(engine.readWorkbook({ kind: "resource", uri: "/input.csv" }, { importEncoding: "BIG5" }, operation))
      .rejects.toThrow("uncaptured import charset");
    expect(volume.toJSON()).toEqual({ "/input.csv": "A\n", "/output.csv": "preserve" });
  } finally { await engine.dispose(); }
});
