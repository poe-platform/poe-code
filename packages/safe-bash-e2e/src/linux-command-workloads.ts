import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { buffer } from "node:stream/consumers";

export const supportsHostPlugins = typeof Reflect.get(globalThis, "WebAssembly")?.Suspending === "function";
export const linuxEnv = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
export async function runLinuxCommand(cmd: string, args: readonly string[], input: string | Uint8Array) {
  const proc = spawn("/usr/bin/" + cmd, args, { env: linuxEnv });
  const finished = once(proc, "close");
  proc.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });
  proc.stdin.end(input);
  const [[code], stdout, stderr] = await Promise.all([finished, buffer(proc.stdout), buffer(proc.stderr)]);
  assert(typeof code === "number", cmd + " exited without a status");
  return [code, stdout, stderr] as const;
}

const textCommands = ([
  ["cat"], ["tac"], ["head", "-n", "2"], ["tail", "-n", "2"], ["wc", "-c"],
  ["sort"], ["uniq", "-c"], ["nl", "-ba"], ["cut", "-c", "1-2"], ["tr", "a-z", "A-Z"],
  ["fold", "-w", "3"], ["rev"], ["fmt", "-w", "20"], ["strings", "-n", "2"],
  ["expand"], ["unexpand"], ["paste", "-s"], ["grep", "beta"], ["sed", "s/beta/z/g"],
  ["awk", "END {print NR}"], ["base64"], ["base32"], ["xxd", "-p"], ["od", "-An", "-tx1"],
  ["sha512sum"], ["sha384sum"], ["sha256sum"], ["sha224sum"], ["sha1sum"], ["md5sum"], ["cksum"],
  ["basename", "/a/b"], ["dirname", "/a/b"], ["seq", "1", "4"], ["factor", "140"],
  ["expr", "7", "+", "4"], ["numfmt", "--to=iec", "1024"], ["tee"], ["true"], ["false"],
  ["printf", "%04d", "7"], ["echo", "alpha", "beta"], ["printenv", "LC_ALL"],
  ["dd", "bs=4", "count=2", "iflag=fullblock", "status=none"], ["shuf", "-i", "7-7"],
  ["date", "-u", "-d", "@0", "+%Y-%m-%d"], ["pr", "-t", "-n"], ["pathchk", "-p", "a/b"],
  ["iconv", "-f", "UTF-8", "-t", "UTF-16LE"], ["test", "3", "-gt", "2"], ["[", "x", "=", "y", "]"],
  ["jq", "-Rr", "ascii_upcase"], ["rg", "-n", "beta", "-"], ["cmp", "-s", "-", "/dev/null"],
  ["comm", "--nocheck-order", "-23", "-", "/dev/null"], ["join", "--nocheck-order", "-a", "1", "-", "/dev/null"],
  ["getopt", "-o", "ab:", "--", "-a", "-b", "two words"], ["getconf", "CHAR_BIT"],
  ["envsubst", "--variables", "$HOME:$PATH"],
  ["openssl", "dgst", "-sha256"], ["realpath", "-m", "/missing/../result"], ["readlink", "-m", "/absent/../result"],
  ["hexdump", "-C"], ["file", "-b", "--mime-type", "-"], ["column", "-t"], ["more"],
  ["env", "-i", "A=one", "B=two", "printenv", "B", "A"], ["timeout", "2", "cat"], ["xargs", "-n", "32", "echo"],
  ["egrep", "^be", "-"], ["fgrep", "beta", "-"], ["rgrep", "beta", "-"],
  ["git", "hash-object", "--stdin"],
] as const).map(([cmd, ...args]) => ({
  cmd, args, script: [cmd, ...args.map(arg => "'" + arg.replaceAll("'", "'\\''") + "'")].join(" ")
}));

export function linuxCommands(text: string) {
  return [
    ...textCommands.map(command => ({ ...command, input: text })),
    // Independent ready nodes sort by raw name bytes even with a mixture of UTF-8 and invalid bytes.
    { cmd: "tsort", args: [], script: "tsort", input: Buffer.from("c3a920c3a9207a207a20ff20ff2080208020412041", "hex") },
  ];
}

export const linuxCodecs = [
  ["gzip", "gunzip", "zcat"], ["bzip2", "bunzip2", "bzcat"], ["xz", "unxz", "xzcat"],
  ["lzma", "unlzma", "lzcat"], ["zstd", "unzstd", "zstdcat"],
] as const;

export function codecInput() {
  const binary = Buffer.alloc(32768);
  for (let i = 0; i < binary.length; i++) binary[i] = (i * 31 + (i >> 8)) % 256;
  return binary;
}
