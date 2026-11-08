import { expect, it } from "vitest";
import { run } from "../tests/fixtures/deep-numbering-native-math-worker.js";

const all: { strict: boolean; kind: string; prefix: string; carrier: string; codec: string; route: string; action: string; radicals: number }[] = [];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"])
for (const prefix of ["w", "alternate", "default"]) for (const carrier of ["direct", "choice", "fallback", "process"])
for (const codec of ["utf8", "bom", "le", "be"]) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"])
for (const action of ["edit", "dry"]) for (const radicals of [32, 1280, 1792]) all.push({ strict, kind, prefix, carrier, codec, route, action, radicals });
for (let sample = 0; sample < 48; sample++) {
  const identity = all[sample * 97 % all.length]!;
  it(`preserves native math and opaque numbering through independent variant dispatch; ${JSON.stringify(identity)}`, async () => {
    const { strict, kind, prefix, carrier, codec, route, action, radicals } = identity;
    const result = await run([strict ? "strict" : "transitional", String(radicals), route, action, kind, prefix, carrier, codec]);
    expect(result).toEqual({ strict, radicals, exactNativeMathAndNumberingPreservation: true, route, dryRun: action === "dry", actualPublicDispatchAndRetention: true, kind, prefix, carrier, codec, exactDirtyFramingCodecRTLAndOpaqueSignatureInteraction: true });
  });
}
