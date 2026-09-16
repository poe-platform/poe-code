import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";

interface OracleStat {
  readonly size: number;
  readonly mode: number;
  isFile(): boolean;
}

interface OracleResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly error?: Error;
}

interface OracleSpawnOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly timeout: number;
  readonly maxBuffer: number;
  readonly killSignal: "SIGKILL";
  readonly input?: string;
}

export interface OracleHost {
  now(): number;
  lstat(path: string): OracleStat;
  open(path: string): {
    stat(): OracleStat;
    read(buffer: Uint8Array, position: number): number;
    close(): void;
  };
  spawn(executable: string, args: readonly string[], options: OracleSpawnOptions): OracleResult;
}

const host: OracleHost = {
  now: () => performance.now(),
  lstat: path => lstatSync(path),
  open(path) {
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    return {
      stat: () => fstatSync(descriptor),
      read: (buffer, position) => readSync(descriptor, buffer, 0, buffer.length, position),
      close: () => closeSync(descriptor),
    };
  },
  spawn: (executable, args, options) => spawnSync(executable, args, options),
};

export function nativeOptions(env: NodeJS.ProcessEnv = process.env): { skip: string | false } {
  return { skip: env.SAFE_BASH_TEST_BASH === undefined && env.SAFE_BASH_TEST_BASH_SHA256 === undefined
    ? "Native Bash 5.2.37 comparison requires SAFE_BASH_TEST_BASH and SAFE_BASH_TEST_BASH_SHA256 (5.2.37)" : false };
}

function checkedRun(executable: string, args: readonly string[], input: string | undefined, source: OracleHost): OracleResult {
  const started = source.now();
  const result = source.spawn(executable, args, {
    env: { PATH: "/__safe_bash_oracle_no_path__", LC_ALL: "C" },
    timeout: 2000, maxBuffer: 65536, killSignal: "SIGKILL",
    ...(input === undefined ? {} : { input }),
  });
  if (result.error) throw result.error;
  if (source.now() - started > 2000) throw new Error("Bash oracle exceeded execution deadline");
  if (result.signal || result.status === null) throw new Error("Bash oracle terminated without an exit status");
  if (!Buffer.isBuffer(result.stdout) || !Buffer.isBuffer(result.stderr) || result.stdout.length + result.stderr.length > 65536) throw new Error("Bash oracle exceeded output limit");
  return result;
}

export function authenticateOracle(env: NodeJS.ProcessEnv = process.env, source: OracleHost = host): string {
  const executable = env.SAFE_BASH_TEST_BASH;
  const expected = env.SAFE_BASH_TEST_BASH_SHA256;
  if (!executable || !isAbsolute(executable) || executable.includes("\0")) throw new Error("Requires explicit absolute SAFE_BASH_TEST_BASH");
  if (!expected || expected.length !== 64 || [...expected].some(character => !"0123456789abcdef".includes(character))) throw new Error("Requires SAFE_BASH_TEST_BASH_SHA256: 64 lowercase hexadecimal characters");
  const maximum = 32 * 1024 * 1024;
  const started = source.now();
  const checkDeadline = (): void => {
    if (source.now() - started > 2000) throw new Error("Bash oracle exceeded hashing deadline");
  };
  const validate = (stat: OracleStat): void => {
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size <= 0 || stat.size > maximum || (stat.mode & 0o111) === 0) throw new Error("Bash oracle must be a bounded regular executable");
  };
  validate(source.lstat(executable));
  checkDeadline();
  const file = source.open(executable);
  try {
    const stat = file.stat();
    validate(stat);
    const hash = createHash("sha256");
    const buffer = new Uint8Array(65536);
    let size = 0;
    while (true) {
      checkDeadline();
      const count = file.read(buffer, size);
      checkDeadline();
      if (!Number.isSafeInteger(count) || count < 0 || count > buffer.length || count > maximum - size) throw new Error("Bash oracle exceeds byte limit");
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      size += count;
    }
    const after = file.stat();
    validate(after);
    if (size !== stat.size || size !== after.size) throw new Error("Bash oracle changed size during hashing");
    if (hash.digest("hex") !== expected) throw new Error("Bash oracle SHA256 mismatch");
  } finally { file.close(); }
  checkDeadline();
  const version = checkedRun(executable, ["--version"], undefined, source);
  if (version.status !== 0 || version.stderr.length !== 0 || !version.stdout.toString().startsWith("GNU bash, version 5.2.37(")) throw new Error("Bash oracle requires GNU Bash 5.2.37");
  return executable;
}

export function runNative(script: string, input?: string, env: NodeJS.ProcessEnv = process.env, source: OracleHost = host): OracleResult & { readonly executable: string } {
  const executable = authenticateOracle(env, source);
  // Node's piped stdio is a socket on Linux. Reopening /dev/stdin and Bash's
  // timed reads require a real pipe, while cat preserves the supplied bytes.
  const args = ["--noprofile", "--norc", "-c", '"$BASH" --noprofile --norc -c "$1" shell < <(/bin/cat 2>/dev/null); status=$?; producer=$!; kill "$producer" 2>/dev/null || :; wait "$producer" 2>/dev/null || :; exit "$status"', "oracle", script];
  return { ...checkedRun(executable, args, input, source), executable };
}
