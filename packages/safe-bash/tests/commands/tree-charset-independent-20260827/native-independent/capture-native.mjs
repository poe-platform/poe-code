import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const expectedOracle =
  "/tmp/safe-bash-tree-oracle-MlUjmM/unix-tree-2.2.1/tree";
const expectedOracleRealpath =
  "/private/tmp/safe-bash-tree-oracle-MlUjmM/unix-tree-2.2.1/tree";
const expectedOracleHash =
  "34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a";
const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixture");
const emptyDirectory = join(fixture, "empty");
const baseEnvironment = Object.freeze({ PATH: "/usr/bin:/bin" });
const deadlineMilliseconds = 3_000;
const streamByteCap = 65_536;

const cases = [
  { id: "ascii_fallback_minimal_env", args: ["."], env: {} },
  {
    id: "cli_ascii_over_tree_utf8_and_locale_utf8",
    args: ["--charset", "ASCII", "."],
    env: { TREE_CHARSET: "UTF-8", LC_ALL: "en_US.UTF-8" },
  },
  {
    id: "cli_utf8_over_tree_ascii_and_locale_c",
    args: ["--charset", "UTF-8", "."],
    env: { TREE_CHARSET: "ASCII", LC_ALL: "C" },
  },
  {
    id: "tree_ascii_over_locale_utf8",
    args: ["."],
    env: { TREE_CHARSET: "ASCII", LC_ALL: "en_US.UTF-8" },
  },
  {
    id: "tree_utf8_over_locale_c",
    args: ["."],
    env: { TREE_CHARSET: "UTF-8", LC_ALL: "C" },
  },
  {
    id: "lc_all_c_over_ctype_and_lang_utf8",
    args: ["."],
    env: { LC_ALL: "C", LC_CTYPE: "en_US.UTF-8", LANG: "en_US.UTF-8" },
  },
  {
    id: "lc_ctype_c_over_lang_utf8",
    args: ["."],
    env: { LC_CTYPE: "C", LANG: "en_US.UTF-8" },
  },
  {
    id: "lc_ctype_utf8_over_lang_c",
    args: ["."],
    env: { LC_CTYPE: "en_US.UTF-8", LANG: "C" },
  },
  { id: "lang_utf8", args: ["."], env: { LANG: "en_US.UTF-8" } },
  {
    id: "native_lowercase_dot_utf8_locale",
    args: ["."],
    env: { LANG: "en_US.utf8" },
  },
  {
    id: "empty_tree_charset_over_locale_utf8",
    args: ["."],
    env: { TREE_CHARSET: "", LC_ALL: "en_US.UTF-8" },
  },
  {
    id: "unknown_tree_charset_over_locale_utf8",
    args: ["."],
    env: { TREE_CHARSET: "X-NOT-A-CHARSET", LC_ALL: "en_US.UTF-8" },
  },
  {
    id: "empty_cli_charset_over_tree_and_locale_utf8",
    args: ["--charset", "", "."],
    env: { TREE_CHARSET: "UTF-8", LC_ALL: "en_US.UTF-8" },
  },
  {
    id: "unknown_cli_charset_over_tree_and_locale_utf8",
    args: ["--charset", "X-NOT-A-CHARSET", "."],
    env: { TREE_CHARSET: "UTF-8", LC_ALL: "en_US.UTF-8" },
  },
  {
    id: "empty_lc_all_defers_to_ctype_utf8",
    args: ["."],
    env: { LC_ALL: "", LC_CTYPE: "en_US.UTF-8", LANG: "C" },
  },
  {
    id: "empty_lc_ctype_defers_to_lang_utf8",
    args: ["."],
    env: { LC_CTYPE: "", LANG: "en_US.UTF-8" },
  },
  { id: "empty_lang_ascii_fallback", args: ["."], env: { LANG: "" } },
  {
    id: "unknown_lc_all_native_fallback",
    args: ["."],
    env: { LC_ALL: "xx_YY.NOT-A-CHARSET", LC_CTYPE: "en_US.UTF-8", LANG: "en_US.UTF-8" },
  },
  {
    id: "cli_compact_utf8_alias_over_c",
    args: ["--charset", "UTF8", "."],
    env: { LC_ALL: "C" },
  },
  {
    id: "cli_lowercase_utf8_alias_over_c",
    args: ["--charset", "utf8", "."],
    env: { LC_ALL: "C" },
  },
];

function appendBounded(chunks, chunk, state, child, streamName) {
  state.bytes += chunk.length;
  if (state.bytes > streamByteCap) {
    state.exceeded = streamName;
    child.kill("SIGKILL");
    return;
  }
  chunks.push(Buffer.from(chunk));
}

async function runCase(testCase) {
  const environment = { ...baseEnvironment, ...testCase.env };
  const invocation = [expectedOracle, ...testCase.args];
  const child = spawn(expectedOracle, testCase.args, {
    cwd: fixture,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdoutState = { bytes: 0, exceeded: null };
  const stderrState = { bytes: 0, exceeded: null };
  let spawnError = null;
  let deadlineExceeded = false;
  child.on("error", (error) => {
    spawnError = { name: error.name, message: error.message, code: error.code ?? null };
  });
  child.stdout.on("data", (chunk) =>
    appendBounded(stdoutChunks, chunk, stdoutState, child, "stdout"),
  );
  child.stderr.on("data", (chunk) =>
    appendBounded(stderrChunks, chunk, stderrState, child, "stderr"),
  );
  const timer = setTimeout(() => {
    deadlineExceeded = true;
    child.kill("SIGKILL");
  }, deadlineMilliseconds);
  const close = await new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  const stdout = Buffer.concat(stdoutChunks);
  const stderr = Buffer.concat(stderrChunks);
  return {
    id: testCase.id,
    invocation,
    cwd: ".",
    absoluteCwd: fixture,
    environment,
    stdin: "ignored",
    closeEventObserved: true,
    close,
    deadlineMilliseconds,
    deadlineExceeded,
    streamByteCap,
    capExceeded: stdoutState.exceeded ?? stderrState.exceeded,
    spawnError,
    stdoutBytes: stdout.length,
    stderrBytes: stderr.length,
    stdoutBase64: stdout.toString("base64"),
    stderrBase64: stderr.toString("base64"),
  };
}

const oracleRealpath = await realpath(expectedOracle);
const oracleBytes = await readFile(oracleRealpath);
const oracleHash = createHash("sha256").update(oracleBytes).digest("hex");
if (oracleRealpath !== expectedOracleRealpath || oracleHash !== expectedOracleHash) {
  throw new Error(`oracle authentication failed: ${oracleRealpath} ${oracleHash}`);
}

try {
  await mkdir(emptyDirectory);
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
}
const fixtureEntries = await readdir(fixture, { recursive: true });
const expectedEntries = [
  "alpha.txt",
  "empty",
  "nest",
  "nest/beta.txt",
  "nest/deep",
  "nest/deep/gamma.txt",
];
if (JSON.stringify(fixtureEntries.sort()) !== JSON.stringify(expectedEntries.sort())) {
  throw new Error(`unexpected fixture entries: ${JSON.stringify(fixtureEntries)}`);
}

const results = [];
for (const testCase of cases) results.push(await runCase(testCase));

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      chronology: "independent-post-source-commit-freeze",
      candidateMetadataOnly: "f1a90436c45208ca248e058a039893233c608daa",
      oracle: { path: expectedOracle, realpath: oracleRealpath, sha256: oracleHash },
      fixtureEntries: expectedEntries,
      cases: results,
    },
    null,
    2,
  )}\n`,
);
