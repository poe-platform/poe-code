import assert from "node:assert/strict";
import { hostname, userInfo } from "node:os";
import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, utimes, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { WasmFileSystem } from "@poe-code/safe-bash-rust";
import type { FileSystem } from "@poe-platform/safe-bash";
import { once } from "node:events";
import { buffer } from "node:stream/consumers";

export const supportsHostPlugins = typeof Reflect.get(globalThis, "WebAssembly")?.Suspending === "function";
// Minimal Ed25519 public certificate from GnuPG's distributed distsigkey.gpg.
export const gpgDistributionKey = Buffer.from("mDMEX0PliRYJKwYBBAHaRw8BAQdAz75Hlekc16JhhfI0MKdEVxLdkxhcMCO0ZG6WMBAmNpe0H1dlcm5lciBLb2NoIChkaXN0IHNpZ25pbmcgMjAyMCmImgQTFgoAQhYhBG2qbmSnbShAVxtJAlKIl7gmQDraBQJfQ+w1AhsDBQkShccRBQsJCAcCAyICAQYVCgkICwIEFgIDAQIeBwIXgAAKCRBSiJe4JkA62nmuAP9uL/HOdB0gvwWrH+FpURJLs4bnaZaPIk9ARrU0EXRgJgD/YCGfHQXpIPT0ZaXuwJexK04Z+qMFR/bM1q1Leo5CjgY=", "base64");
export const linuxEnv = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
export async function runLinuxCommand(cmd: string, args: readonly string[], input: string | Uint8Array, cwd?: string): Promise<readonly [number, Buffer, Buffer]> {
  const proc = spawn("/usr/bin/" + cmd, args, { cwd, env: linuxEnv, argv0: cmd });
  const finished = once(proc, "close");
  proc.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });
  proc.stdin.end(input);
  const [[code], stdout, stderr] = await Promise.all([finished, buffer(proc.stdout), buffer(proc.stderr)]);
  assert(typeof code === "number", cmd + " exited without a status");
  return [code, stdout, stderr];
}

// Hand the native files and archives to both virtual filesystems before timing commands.
export async function createLinuxCommandDirectory(...views: Pick<FileSystem, "mkdir" | "writeFile">[]) {
  const out = fileURLToPath(new URL("../../../out/", import.meta.url));
  await mkdir(out, { recursive: true });
  const cwd = await mkdtemp(out + "linux-commands-");
  try {
    await mkdir(cwd + "/samples");
    const { uid, gid, username } = userInfo();
    for (const view of views) {
      await view.mkdir("/workspace/samples", { recursive: true });
      await view.mkdir("/etc", { recursive: true });
      await view.writeFile("/etc/hostname", Buffer.from(hostname() + "\n"));
      await view.writeFile("/etc/passwd", Buffer.from(`${username}:x:${uid}:${gid}::/:/bin/sh\n`));
    }
    for (const [name, line] of [["base", "base"], ["ours", "edited here"], ["theirs", "edited there"]]) {
      const path = "/samples/" + name;
      const bytes = Buffer.from("header\n" + line + "\nfooter\n");
      await writeFile(cwd + path, bytes);
      for (const view of views) await view.writeFile("/workspace" + path, bytes);
    }
    const fdIgnore = Buffer.from("theirs\n");
    await writeFile(cwd + "/samples/.fdignore", fdIgnore);
    for (const view of views) await view.writeFile("/workspace/samples/.fdignore", fdIgnore);
    for (const dir of ["fd-repo/.git", "fd-repo/nested/.git"]) {
      await mkdir(cwd + "/" + dir, { recursive: true });
      for (const view of views) await view.mkdir("/workspace/" + dir, { recursive: true });
    }
    for (const [file, contents] of [["fd-repo/.gitignore", "needle\n"], ["fd-repo/needle", ""], ["fd-repo/nested/needle", ""]] as const) {
      await writeFile(cwd + "/" + file, contents);
      for (const view of views) await view.writeFile("/workspace/" + file, Buffer.from(contents));
    }
    const publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICFS+NGbeR0kRTJC4V8uq2y3z/p7al7TAJeWDgaYgdsS parity\n";
    // OpenSSH |1| hash of "host" with the 20 salt bytes 0..19.
    const knownHosts = Buffer.concat([Buffer.from("# fixture\n\n  HOST,alias " + publicKey +
      "@revoked host " + publicKey + "@cert-authority *.domain,!skip.domain " + publicKey +
      "|1|AAECAwQFBgcICQoLDA0ODxAREhM=|6tbkAfZDulNpJ/cQ7aCK0Bbfp+g= " + publicKey +
      "host unsupported ignored\nhost ssh-ed25519 raw-comment "), Buffer.from([0xff, 13, 10]),
      Buffer.from("?? " + publicKey.trimEnd() + "  "), Buffer.from([0xff, 9, 13, 0, 120, 10]),
      Buffer.from("É ssh-ed25519 another\n")]);
    await writeFile(cwd + "/known_hosts", knownHosts);
    for (const view of views) await view.writeFile("/workspace/known_hosts", knownHosts);
    await writeFile(cwd + "/samples/ed25519.pub", publicKey);
    for (const view of views) await view.writeFile("/workspace/samples/ed25519.pub", Buffer.from(publicKey));
    for (const [cmd, args, extension] of [
      ["tar", ["-cf", "-", "samples/base", "samples/ours"], "tar"],
      ["zip", ["-q", "-", "samples/base", "samples/ours"], "zip"],
    ] as const) {
      const [code, bytes, stderr] = await runLinuxCommand(cmd, args, "", cwd);
      assert.equal(code, 0, stderr.toString());
      const path = "/sample." + extension;
      await writeFile(cwd + path, bytes);
      for (const view of views) await view.writeFile("/workspace" + path, bytes);
    }
    return cwd;
  } catch (error) {
    await rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

const textCommands = ([
  ["ssh-keygen", "-l", "-f", "samples/ed25519.pub"], ["cat"], ["tac"], ["head", "-n", "2"], ["tail", "-n", "2"], ["wc", "-c"],
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
  ["envsubst", "--variables", "$HOME:$PATH"], ["which", "-a", "sh", "bash"],
  ["openssl", "dgst", "-sha256"], ["realpath", "-m", "/missing/../result"], ["readlink", "-m", "/absent/../result"],
  ["hexdump", "-C"], ["file", "-b", "--mime-type", "-"], ["column", "-t"], ["more"],
  ["env", "-i", "A=one", "B=two", "printenv", "B", "A"], ["timeout", "2", "cat"], ["xargs", "-n", "32", "echo"],
  ["egrep", "^be", "-"], ["fgrep", "beta", "-"], ["rgrep", "beta", "-"],
  ["git", "hash-object", "--stdin"],
  ["diff", "-u", "--label", "base", "--label", "ours", "samples/base", "samples/ours"],
  ["diff3", "-m", "samples/ours", "samples/base", "samples/theirs"],
  ["find", "samples", "-type", "f", "-name", "theirs", "-print0"], ["ls", "-1", "samples"],
  ["du", "-b", "samples/base"], ["stat", "-c", "%n %s", "samples/theirs"], ["hd", "samples/ours"],
  ["zip", "-q", "-", "samples/base", "samples/ours", "sample.tar"], ["tar", "-xOf", "sample.tar", "samples/base"], ["unzip", "-p", "sample.zip", "samples/ours"],
  ["less", "samples/theirs"], ["tree", "-i", "--noreport", "samples"],
  ["whoami", "-"], ["hostname"], ["hostname", "-s"], ["hostname", "-F", "absent"], ["hostname", "--file="],
  ["hostname", "--file=samples/base/../absent"],
  ["uname", "-so"], ["id", "-un", "0"], ["locale", "-ck", "decimal_point"],
  // Test the lower bound independently of the host processor count; sleep parses both units.
  ["nproc", "--ignore=1000000"], ["sleep", "0.0001s", "0m"],
] as const).map(([cmd, ...args]) => ({
  cmd, args, script: [cmd, ...args.map(arg => "'" + arg.replaceAll("'", "'\\''") + "'")].join(" ")
}));

export function linuxCommands(text: string) {
  const pipes = ["yes | head -c 32769 | wc -c", "yes q | cat -n | head -n 1101 | tail -n 1"];
  return [
    { cmd: "whoami", args: [], script: "EUID=" + userInfo().uid + " USER=unused whoami", input: "" },
    { cmd: "qrencode", args: ["-t", "ansiutf8i", "-m", "1", "Hello"], script: "qrencode -t ansiutf8i -m 1 Hello", input: "" },
    { cmd: "qrencode", args: ["-M", "-t", "ANSI256UTF8", "-m", "3", "1234"], script: "qrencode -M -t ANSI256UTF8 -m 3 1234", input: "" },
    ...[Buffer.from([65, 0, 255, 66]), codecInput().subarray(0, 2048)].map(input => ({ cmd: "qrencode", args: ["-8tASCII"], script: "qrencode -8tASCII", input })),
    { cmd: "qrencode", args: ["-M", "-t", "UTF8", "12345"], script: "qrencode -M -t UTF8 12345", input: "" },
    ...["sort", "unique", "group_by(.)", "min,max"].map(filter => ({
      cmd: "jq", args: ["-c", filter], script: "jq -c '" + filter + "'",
      input: '[{"b":0},{"a":9},{"a":0,"b":[1]},{"b":[0],"a":0},{"a":0,"b":[0]},{"a":2},{"a":9},{},{"y":0,"z":1},{"z":1,"y":0}]\n',
    })),
    { cmd: "jq", args: ["-c", "bsearch(.[])"], script: "jq -c 'bsearch(.[])'", input: JSON.stringify(Array.from({ length: 128 }, (_, i) => 2 * i)) },
    ...pipes.map(script => ({ cmd: "bash", args: ["--noprofile", "--norc", "-c", script], script, input: "" })),
    // Keep the host keybox in the private benchmark directory.
    { cmd: "gpg", args: ["--no-options", "--no-autostart", "--homedir", ".", "--batch", "-q", "--export", "missing"],
      script: "gpg --batch -q --export missing", input: "" },
    { cmd: "gpg", args: ["--no-options", "--no-autostart", "--homedir", ".", "--batch", "-u", "missing-signer", "--detach-sign"],
      script: "gpg --batch -u missing-signer --detach-sign", input: text },
    ...([["-Ip", "^/.*/samples/base$"], ["-IpF", "/samples/base"], ["-Ipg", "*/base"], ["-Ipg", "**/samples/base"]] as const).map(([flags, pattern]) => ({
      cmd: "fdfind", args: [flags, pattern, "samples"], script: "fd " + flags + " '" + pattern + "' samples", input: "",
    })),
    ...[["-u", "fdignore"], ["-u", "--ignore", "fdignore"], ["-H", "-u", "--ignore", "fdignore"],
      ["-u", "--no-hidden", "theirs"], ["-I", "-u", "--no-hidden", "theirs"], ["--no-hidden", "-u", "fdignore"]].map(options => ({
      cmd: "fdfind", args: [...options, "samples"], script: "fd " + options.join(" ") + " samples", input: "",
    })),
    ...[["needle", "fd-repo"], ["needle", "fd-repo/nested"], ["--no-require-git", "needle", "fd-repo"],
      ["--no-require-git", "--require-git", "needle", "fd-repo"]].map(args => ({
      cmd: "fdfind", args, script: "fd " + args.join(" "), input: "",
    })),
    ...[["-F", "host"], ["-q", "-F", "HOST"], ["-l", "-F", "host"], ["-F", "a.domain"], ["-F", "skip.domain"], ["-F", "é"], ["-l", "-F", "é"]].map(options => ({
      cmd: "ssh-keygen", args: [...options, "-f", "known_hosts"], script: "ssh-keygen " + options.join(" ") + " -f known_hosts", input: "",
    })),
    ...["LC_ALL=C.UTF-8 ssh-keygen -l -F é -f known_hosts", "ssh-keygen -l -F $'\\xffx' -f known_hosts"].map(script => ({
      cmd: "bash", args: ["--noprofile", "--norc", "-c", script], script, input: "",
    })),
    { cmd: "ssh-keygen", args: ["-F", "host", "-f", "absent"], script: "ssh-keygen -F host -f absent", input: "" },
    ...textCommands.map(command => ({ ...command, input: text })),
    ...["16384/16384", "l/16384/16384", "l/2/5", "r/2/5"].map(spec => ({
      cmd: "split", args: ["-n", spec, "-t", "|"], script: "split -n " + spec + " -t '|'",
      input: Buffer.from([0xff, 0, 1, 2, 3, 4, 124, 124, 5, 124, 6, 7, 8]),
    })),
    { cmd: "patch", args: ["-s", "-o", "-", "samples/base"], script: "patch -s -o - samples/base",
      input: "--- old\n+++ new\n@@ -1,3 +1,3 @@\n header\n-base\n+changed\n footer\n" },
    { cmd: "bc", args: [], script: "bc", input: String.raw`"literal:\n\q; define f(){return 1}"
"continued\
literal"
print "byte:\é"
print " | escaped:\a\b\f\n\q\r\t\z\\", "\n"
scale=4
print "# /* */: ", 1 /* a multiline
comment */ / 8, "\n" # trailing comment
` },
    { cmd: "bc", args: ["-q"], script: "bc -q", input: '"é"\nx=0\n' + "x=x+1\n".repeat(2048) + "if(x==2048) { x } else { 0 }\n" },
    // Independent ready nodes sort by raw name bytes even with a mixture of UTF-8 and invalid bytes.
    { cmd: "tsort", args: [], script: "tsort", input: "x a\nx b\na c\nb c\n" },
    { cmd: "tsort", args: ["-"], script: "tsort -", input: "a b\nb a\n" },
    { cmd: "tsort", args: ["--", "-"], script: "tsort -- -", input: "d b\nb a\ne d\nb f\na d\nf e\n" },
    { cmd: "bash", args: ["--noprofile", "--norc", "-c", "tsort 2>&1"], script: "tsort 2>&1", input: "z z\na b\nb a\n" },
    { cmd: "tsort", args: ["--"], script: "tsort --", input: "x a\nx b\n".repeat(15000) },
    { cmd: "tsort", args: [], script: "tsort", input: Buffer.from("c3a920c3a9207a207a20ff20ff2080208020412041", "hex") },
  ];
}

export const linuxMutations = ([
  ["split", "-b", "5", "effects/source", "effects/x"],
  ["split", "-d", "-e", "-n", "20000", "effects/source", "effects/x"],
  ["split", "-d", "-e", "-n", "l/20000", "effects/source", "effects/x"],
  ["split", "-d", "-e", "-n", "r/20000", "effects/source", "effects/x"],
  ["mktemp", "--suffix=.data", "effects/slot.XXXXXX"],
  ["mktemp", "-d", "--suffix=.data", "effects/slot.XXXXXX"],
  ["csplit", "-f", "effects/x", "effects/source", "/middle/"],
  ["ssh-keygen", "-R", "host", "-f", "effects/source"],
  ["ssh-keygen", "-R", "absent", "-f", "effects/source"],
  ["install", "-m", "0751", "effects/source", "effects/installed"],
  ["cp", "-p", "effects/source", "effects/copy"], ["mv", "effects/source", "effects/moved"],
  ["chmod", "0710", "effects/source"], ["truncate", "-s", "+4", "effects/source"],
  ["touch", "-m", "-d", "@1234", "effects/source"], ["rm", "effects/source"],
  ["rmdir", "effects/empty"], ["mkdir", "-m", "0711", "effects/new"],
  ["ln", "-s", "source", "effects/link"],
] as const).map(([cmd, ...args]) => ({ cmd, args, script: [cmd, ...args].join(" "), input: "", mutation: true as const }));



export async function resetEffects(cwd: string, view?: FileSystem | WasmFileSystem, command?: string) {
  const dir = (view ? "/workspace" : cwd) + "/effects";
  const bytes = command === "ssh-keygen" ? Buffer.from("# keep\nHost,alias ssh-ed25519 a\n@revoked host ssh-rsa b\n@cert-authority host ssh-rsa c\n|1|AAECAwQFBgcICQoLDA0ODxAREhM=|6tbkAfZDulNpJ/cQ7aCK0Bbfp+g= ssh-rsa d\nend ssh-rsa e") : Buffer.from("ff00610a6d6964646c650a80", "hex");
  if (view) {
    await view.rm(dir, { recursive: true, force: true });
    await view.mkdir(dir + "/empty", { recursive: true });
    await view.writeFile(dir + "/source", bytes);
    await view.chmod!(dir + "/source", 0o640);
    await view.utimes!(dir + "/source", 100000, 200000);
  } else {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir + "/empty", { recursive: true });
    await writeFile(dir + "/source", bytes);
    await chmod(dir + "/source", 0o640);
    await utimes(dir + "/source", 100, 200);
  }
}

export async function readEffects(cwd: string, cmd: string, view?: FileSystem | WasmFileSystem) {
  const dir = (view ? "/workspace" : cwd) + "/effects";
  const names = view ? (await view.readdir(dir)).map(e => e.name) : await readdir(dir);
  return Promise.all(names.sort().map(async name => {
    const path = dir + "/" + name;
    const stat = view ? await view.lstat(path) : await lstat(path);
    const type = "type" in stat ? stat.type : stat.isFile() ? "file" : stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "symlink" : "other";
    const contents = type === "file" ? Buffer.from(view ? await view.readFile(path) : await readFile(path))
      : type === "symlink" ? (view ? await view.readlink!(path) : await readlink(path))
      : type === "directory" ? (view ? (await view.readdir(path)).map(e => e.name) : await readdir(path)).sort() : undefined;
    // Only compare permissions or times the command explicitly sets or preserves, independent of host umask.
    const mode = ((cmd === "ssh-keygen" && name.startsWith("source")) || cmd === "cp" || cmd === "mv" || cmd === "chmod" || cmd === "install" || cmd === "mkdir" || cmd === "mktemp") && name !== "empty" ? stat.mode & 0o7777 : undefined;
    const mtime = ["cp", "mv", "touch"].includes(cmd) && type === "file" ? stat.mtimeMs : undefined;
    return { name, type, contents, mode, mtime };
  }));
}

export async function observeMutation(cwd: string, cmd: string, [code, stdout, stderr]: readonly [number, Buffer, Buffer], view?: FileSystem | WasmFileSystem) {
  const entries = await readEffects(cwd, cmd, view);
  if (cmd === "mktemp") {
    const output = stdout.toString("latin1");
    assert.match(output, /^effects\/slot\.[A-Za-z0-9]{6}\.data\n$/u);
    const created = entries.find(entry => "effects/" + entry.name + "\n" === output);
    assert.ok(created, "mktemp must create the exact path printed on stdout");
    created.name = "slot.XXXXXX.data";
    stdout = Buffer.from("effects/" + created.name + "\n");
  }
  return { code, stdout, stderr, entries };
}

// ZIP writers can use different headers and compression streams for the same members.
export async function readZipMembers(cwd: string, archive: Buffer, names: readonly string[]) {
  await writeFile(cwd + "/verify.zip", archive);
  const [code, listing, stderr] = await runLinuxCommand("unzip", ["-Z1", "verify.zip"], "", cwd);
  assert.equal(code, 0, stderr.toString());
  assert.deepEqual(listing, Buffer.from(names.join("\n") + "\n"));
  return Promise.all(names.map(async name => {
    const [code, contents, stderr] = await runLinuxCommand("unzip", ["-p", "verify.zip", name], "", cwd);
    assert.equal(code, 0, stderr.toString());
    assert.equal(stderr.length, 0);
    return contents;
  }));
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
