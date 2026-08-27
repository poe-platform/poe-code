import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gnuStringsCases } from "./gnu-strings-cases.js";
import { capture, identity } from "./oracle.js";

export const defaultStrings = "/tmp/safe-bash-gnu-strings-20260827-YJqPHf/build-system-zlib/binutils/strings";

export function captureGnuStrings() {
  const executable = process.env.STREAM_GNU_STRINGS ?? defaultStrings;
  const details = identity(executable);
  assert.equal(details.sha256, "90b9c9257095110594ae58a4bb1531d9670bd6aed297b8dbf0dc01914c5de09f");
  assert.ok(details.version.startsWith("GNU strings (GNU Binutils) 2.44"));
  return {
    identity: details, profile: "GNU Binutils2.44 raw-all configured DEFAULT_STRINGS_ALL=1; LC_ALL=C TZ=UTC; Darwin, not GNU/Linux",
    provenance: {
      archiveSha256: "ce2017e059d63e67ddb9240e9d4ec49c2893605035cd60e92ad53177f4377237",
      archiveSource: "https://ftp.gnu.org/gnu/binutils/binutils-2.44.tar.xz",
      authenticity: "Official HTTPS retrieval; local SHA256; no signature-verification claim",
      providerEvidence: "/tmp/safe-bash-gnu-strings-20260827-YJqPHf/PROVENANCE.md",
      configuration: "--enable-default-strings-all --with-system-zlib; unmodified upstream source, existing system runtime, no install or product dependency",
    },
    observations: gnuStringsCases.map(specimen => capture(specimen, executable, defaultStrings)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const content = JSON.stringify(captureGnuStrings(), null, 2) + "\n";
  execFileSync("apply_patch", [], { input: "*** Begin Patch\n*** Add File: tests/commands/stream-inspection/evidence/gnu-strings.json\n" + content.split("\n").slice(0, -1).map(line => "+" + line).join("\n") + "\n*** End Patch\n", stdio: ["pipe", "inherit", "inherit"] });
}
