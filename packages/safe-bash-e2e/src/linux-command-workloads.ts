import assert from "node:assert/strict";
import { hostname, userInfo } from "node:os";
import { resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, utimes, writeFile } from "node:fs/promises";
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
  const proc = spawn(resolve("/usr/bin", cmd), args, { cwd, env: linuxEnv, argv0: cmd });
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
export async function createLinuxCommandDirectory(...views: Pick<FileSystem, "mkdir" | "writeFile" | "symlink">[]) {
  const out = fileURLToPath(new URL("../../../out/", import.meta.url));
  await mkdir(out, { recursive: true });
  const cwd = await mkdtemp(out + "linux-commands-");
  try {
    await mkdir(cwd + "/samples");
    const { uid, gid, username } = userInfo();
    const services = await readFile("/etc/services");
    for (const view of views) {
      await view.mkdir("/workspace/samples", { recursive: true });
      await view.mkdir("/etc", { recursive: true });
      await view.mkdir("/proc", { recursive: true });
      await view.writeFile("/etc/hostname", Buffer.from(hostname() + "\n"));
      await view.writeFile("/etc/services", services);
      await view.writeFile("/etc/passwd", Buffer.from(`${username}:x:${uid}:${gid}::/:/bin/sh\n`));
    }
    for (const [name, line] of [["base", "base"], ["ours", "edited here"], ["theirs", "edited there"]]) {
      const path = "/samples/" + name;
      const bytes = Buffer.from("header\n" + line + "\nfooter\n");
      await writeFile(cwd + path, bytes);
      for (const view of views) await view.writeFile("/workspace" + path, bytes);
    }
    for (const [name, target] of [["pwd-link", "samples"], ["df-link", "samples/base"], ["df-dangling", "not-there"], ["df-loop", "df-loop"], ["df-proc", "/proc"]]) {
      await symlink(target, cwd + "/" + name);
      for (const view of views) await view.symlink!(target, "/workspace/" + name);
    }
    const ghConfig = Buffer.from('version: "1"\neditor: nano\nserial: 001\nbrowser: |-\n  first\n  second\naliases: { co: pr checkout }\n');
    await writeFile(cwd + "/samples/config.yml", ghConfig);
    for (const view of views) await view.writeFile("/workspace/samples/config.yml", ghConfig);
    const wide = Buffer.from("\ufeffeditor: café💡\nother: keep\n", "utf16le");
    for (const [name, bytes] of [
      ["gh-le", wide], ["gh-be", Buffer.from(wide).swap16()],
      ["gh-host-le", Buffer.from("\ufeffone.invalid: {editor: café💡}\n", "utf16le")],
      ["gh-bom", Buffer.from("\ufeffeditor: café💡\nother: keep\n")],
      ["gh-bad-utf8", Buffer.concat([Buffer.from("editor: "), Buffer.from([255,10])])],
      ["gh-bad-utf16", Buffer.from([255,254,0,216])], ["gh-no-bom", wide.subarray(2)],
    ] as const) {
      await writeFile(cwd + "/samples/" + name, bytes);
      for (const view of views) await view.writeFile("/workspace/samples/" + name, bytes);
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
  ...["Port", "Port\f", "Port=", 'Port ""', "Port #comment", "Port=bad", "Port bad extra", "Port 22 23", 'Port 22 "bad', "Port=é"].map(option => ["ssh", "-GT", "-F", "none", "-p25", "-o", option, "example.invalid"] as const),
  ["ssh", "-Gz", "example.invalid"], ["ssh", "--bad"], ["ssh", "-G1", "example.invalid"], ["ssh", "-GTb"], ["ssh", "-Q"],
  ["ssh", "-G?", "-p0", "example.invalid"], ["ssh", "-G", "example.invalid", "-W"],
  ["ssh", "-G", "-p", "65536", "example.invalid"], ["ssh", "-GTp0", "example.invalid"],
  ["ssh", "-G", "-p22x", "example.invalid"], ["ssh", "-G", "-p", "-V", "example.invalid"],
  ["ssh", "-G", "-p", "tftp", "example.invalid"], ["ssh", "-G", "-p", "", "example.invalid"],
  ["ssh", "-G", "-p"], ["ssh", "-G", "example.invalid", "-p", "-1"],
  ["ssh-keygen", "-l", "-f", "samples/ed25519.pub"], ["cat"], ["tac"], ["head", "-n", "2"], ["tail", "-n", "2"], ["wc", "-c"],
  ["sort"], ["uniq", "-c"], ["nl", "-ba"], ["cut", "-c", "1-2"], ["tr", "a-z", "A-Z"],
  ["fold", "-w", "3"], ["rev"], ["fmt", "-w", "20"], ["strings", "-n", "2"],
  ["paste", "-s"], ["grep", "beta"], ["sed", "s/beta/z/g"],
  ["awk", "END {print NR}"], ["base64"], ["base32"], ["xxd", "-p"], ["od", "-An", "-tx1"],
  ["sha512sum"], ["sha384sum"], ["sha256sum"], ["sha224sum"], ["sha1sum"], ["md5sum"], ["cksum"],
  ["basename", "/a/b"], ["basename", "a/b-z", "-z"], ["basename", "a/b--", "--"], ["basename", "-a", "x", "--", "-z"],
  ["basename", "a/b--help", "--help"], ["basename", "-sz", "a/bz", "bz"], ["dirname", "/a/b"], ["dirname", "a/b", "-z"], ["basename", "--mu", "a/b", "c/d"], ["basename", "--s=x", "a/bx", "x"], ["basename", "--s", "--z", "p/b--z"],
  ["basename", "--z", "--s=", "p/b"], ["basename", "p/--z", "--z"], ["dirname", "p/b", "--ze"],
  ["dirname", "--zer", "--", "--z"], ["basename", "--s"], ["basename", "--z=1"], ["dirname", "--h=x"],
  ["basename", "--=x"], ["dirname", "--=x"], ["basename", "--suffixx"], ["dirname", "--verx"],
  ["seq", "1", "4"], ["factor", "140"],
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
  ["df", "--output", "/proc"], ["df", "--output=pcent,iused", "/proc"],
  ["df", "-h", "--output=size,used,pcent", "/proc"], ["df", "--output=used", "/proc"],
  ["df", "--output=file,target", "--total", "/", "/proc"], ["df", "--output=target,source", "--total", "/proc"],
  ["df", "--output=file,target", "df-proc", "df-proc/../", "/"],
  ["df", "--output=file", "df-link", "df-dangling", "samples/base", "df-loop", "/"],
  ["df", "--output=file", "", "missing", "samples/base/", "samples/base/../ours", "df-link/", "/"],
  ["df", "--output=file", "x:y", "what's missing", "two words", "#bad", "df-link"],
  ["df", "--output="], ["df", "--output=size,"], ["df", "--output=,file"], ["df", "--output=file,,size"],
  ["df", "--output=file,bogus", "--help"],
  ["df", "-TPi", "--output=bogus"], ["df", "-TP", "--output"], ["df", "--output", "-TP"],
  ["df", "--output", "--inodes", "--help"], ["df", "--portability", "--output=size,"],
  ["df", "--output=target", "--print-type", "--version"],
  ["df", "--output=file", "--output=target", "/"], ["df", "--output=target", "--output", "/"],
  ["df", "--output", "--output=target", "/"], ["df", "--output=size,size", "/"],
  ["df", "--output=file,target", "--output=file", "/"],
  ["stat", "--printf", "%n\\q\\%n\\xg", ".", "/"], ["stat", "--printf", "trail\\", "."],
  ["stat", "--printf", "\\é\\💾", "."], ["stat", "--printf", "\\377\\400\\x80\\n", "."],
  ["stat", "-c", "%n\\q", "."],
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
  const pipes = ["yes | head -c 32769 | wc -c", "yes q | cat -n | head -n 1101 | tail -n 1",
    String.raw`df --output=$'target,\xff'`, "LC_ALL=C.UTF-8 df --output=’é",
    "LC_ALL= LC_MESSAGES=C LC_CTYPE=C.UTF-8 df --output=é"];
  pipes.push('declare -A routes=([health]=live); route() { printf "%s\\n" "${routes[$1]:-missing}"; }; route health; route absent',
    'declare -A a=(); seed() { : "${a[$1]:=set}"; }; seed "two words"; printf "%s\\n" "${a[two words]}"',
    'set -- 2; a=(zero one two); printf "%s\\n" "${a[$1]}"');
  for (const command of ["pwd", "command pwd -L", "pwd -P", "env pwd", "env pwd --logical", "/usr/bin/pwd", "exec pwd", "timeout 10 pwd", "env pwd --phys",
    "env POSIXLY_CORRECT=1 pwd", "env -u PWD pwd -L", 'env PWD="$PWD/." pwd -L', 'env PWD="$PWD//" pwd -L',
    "env pwd -P ignored -L", "env POSIXLY_CORRECT=1 pwd ignored -P", "env pwd -- -L"]) {
    pipes.push('(root=$PWD; cd pwd-link && result=$(' + command + ') && printf "%s\\n" "${result#"$root"/}")');
  }
  pipes.push(String.raw`basename $'a\xc3\xa9' $'\xa9'`, String.raw`basename --s=$'\xa9' $'a\xc3\xa9'`,
    String.raw`dirname $'--bad\xff'`, String.raw`basename $'-a\xc3\xa9'`, String.raw`dirname $'-\xff'`,
    String.raw`basename a b $'x\047y\n\xff'`, String.raw`LC_ALL=C.UTF-8 basename a b $'é\047’\xff'`);
  pipes.push("env POSIXLY_CORRECT=1 dirname a/b -z", "env POSIXLY_CORRECT= dirname a/b --", "env POSIXLY_CORRECT=1 dirname -z a/b --zero");
  pipes.push("pwd --logical", "command pwd --physical", "pwd -LPQ", "pwd --help", "builtin pwd -P --help -X",
    "command pwd -X --help", "pwd -- --help >/dev/null");
  for (const invocation of ["env pwd -X", "env pwd --unknown", "env pwd --physical=yes", "env pwd --h=x", "/usr/bin/pwd extra"]) {
    pipes.push("(cd pwd-link && " + invocation + " >/dev/null)");
  }
  // The version identifies the virtual implementation; compare option handling and help topics.
  for (const [args, pattern] of [["--help -X", "*--logical*--physical*"], ["-P --h", "*--logical*--physical*"],
    ["ignored --version", "pwd*"], ["-L --v", "pwd*"]]) {
    pipes.push('(cd pwd-link && text=$(env pwd ' + args + ') && case "$text" in ' + pattern + ') echo matched;; *) exit 1;; esac)');
  }
  for (const invocation of ["pwd -L", "pwd -P", "env pwd -L", "/bin/pwd"]) {
    pipes.push("(mkdir pwd-gone && cd pwd-gone && rmdir ../pwd-gone && " + invocation + " >/dev/null)");
  }
  for (const options of ["-p1", "-p65535", "-p '+0008'", "-p ' 22'", "-p23 -p0", "-bpg -p44", "-Jjumps -p45", "-p www", "-p ssh", "-p null",
    "-oPort=24 -p25", "-p25 -oPort=24", "-o ' pOrT = 0024 # use this port'", "-o 'Port 2\"4\"'", "-oPort=www", "-oPort=24 -pbad", "-oPort=27 -oPort=28"]) {
    pipes.push("ssh -GT -F none " + options + " example.invalid | grep '^port '");
  }
  pipes.push("{ ssh -GT -F none -o Port=24 example.invalid >/dev/null; cat; } <samples/base");
  for (const options of ["-m2px", "-m nope", "--margin=-1", "-m ' +4294967297pad'", "-m9223372036854775809",
    "-s0", "-s-2147483649", "-s2147483648", "-s2147483647", "--size=oops",
    "-v2tail", "-v41 -v1", "-v41", "-v41 -M", "-v-1", "-v-9223372036854775809",
    "-M -S", "-M -lH", "--dpi=-1", "--dpi=0"]) {
    pipes.push("qrencode -tASCII " + options + " x");
  }
  pipes.push("qrencode -tASCII -v41 </dev/null", "qrencode -tASCII -v41 -r no-qr-input");
  pipes.push("qrencode -o - x | head -c 65",
    "qrencode -s1 -m0 --foreground=10203040 --background=ffeecc99 -o - Hello | head -c 65",
    "qrencode -tPNG32 --foreground=10203040 --background=ffeecc99 -o - Hello | head -c 33");
  for (const [format, dpi] of [["PNG", "72"], ["PNG32", "0"], ["PNG32", "127"], ["PNG", "2147483647"]]) {
    pipes.push(String.raw`qrencode -t ${format} -d ${dpi} -o - x | xxd -p -c 4096 | sed -n 's/.*70485973\(.\{18\}\).*/\1/p'`);
  }
  pipes.push(String.raw`qrencode -t ASCII -l $'\xff' hello`, String.raw`qrencode $'--type=\xff' hello`);
  pipes.push(String.raw`ssh -GT -o$'Port=\xff' example.invalid`);
  pipes.push(String.raw`ssh -G$'\xff' example.invalid`);
  pipes.push(String.raw`ssh -Gp$'\xff' example.invalid`);
  const pandoc = execFileSync("/usr/bin/which", ["pandoc"], { encoding: "utf8" }).trimEnd();
  const pandocVersion = execFileSync(pandoc, ["--version"], { encoding: "utf8" }).split("\n")[0];
  assert.equal(pandocVersion, "pandoc 3.11", "Put Pandoc 3.11 first on PATH for the Linux command benchmark");
  return [
    ...["- a\n- b\n", "#tag\nNext\n", "| lone |\nnext\n", "start\n####### too many\n| literal |\nlast\n",
      "start\n# Heading\nlast\n", "", "> First\n>\n> > Second\n\nlast\n",
      "A\n\n```js\na  b\n\n  c\n```\n\nZ\n", "> ```\n> a\n>\n> b\n> ```\n",
      "```\n\n\na\n\n\n```\n", "```\na  \n   \n\n```\n", "```\n\n\n```\n\nlast\n",
      "````\na\n```\nb\n````\n", "~~~txt\nplain\n~~~\n", "  ~~~\n  a\n b\n   c\n  ~~~\n",
      "```\na\n```oops\nb\n```\n", "```\na\n    ```\nb\n```\n", "~~~~\n```\n~~~\nz\n",
      "before\n~~~\na\n~~~\nafter\n", "    x\n    y\n", "before\n    x\n", "    x\n  \n    y\n\nend\n",
      "  ~~~\n\tx\n  ~~~\n", "\tfoo\tbar\n"].map(input => ({
      cmd: pandoc, args: ["-f", "commonmark", "-t", "plain", "--wrap=none"],
      script: "pandoc -f commonmark -t plain --wrap=none", input,
    })),
    ...([
      ["sed -e p -e 'a queued' -e 'r samples/base' -e Q7", "first\nsecond\n"],
      ["sed -n -e 'a queued' -e Q7", "first"],
      ["sed -n -e p -e 'a queued' -e q7", "first\n"],
      ["cat >sed-raw; printf 'a\\nb\\n' | sed -n -e 'r sed-raw' -e 'a after'", Buffer.from([255,0,226,130])],
      ["cat >sed-raw; printf 'a\\0b\\0' | sed -z -e 'r sed-raw' -e 'a after' -e N", Buffer.from([0,255,10])],
      ["rm -rf sed-reads; mkdir sed-reads; cd sed-reads; echo first >a; echo second >b; sed -i -e 's/first/changed/' -e 'r a' a b; cat a b", ""],
      ["printf tail | sed -e 'r sed-no-such-file'", ""],
      ["sed -n 'p;p;P;s/aa/bb/p'", "aa"],
      ["sed -n 'p;Q7'", "tail"],
      ["sed q", "tail"],
      ["sed n", "tail"],
      ["sed -z -n 'p;P;p;=;l'", Buffer.from([255,0,195])],
      ["sed -z '1h;2G;3x'", "saved\0mid\0tail"],
      ["printf a >sed-first; printf b >sed-last; sed -sn 'p;p' sed-first sed-last", ""],
      ["printf a >sed-first; printf b >sed-last; sed -n '1p' sed-first sed-last", ""],
      ["printf a >sed-first; printf b >sed-last; sed -zn 'N;p' sed-first sed-last", ""],
      ["sed -n -e 'w sed-record' -e 's/old/new/w sed-record'; cat sed-record", "old"],
      ["printf stale >sed-unused; sed -n 's/absent/new/w sed-unused'; cat sed-unused", "old"],
      ["printf stale >sed-unused; sed -n '2{w sed-unused\n}' sed-unused; cat sed-unused", ""],
      ["sed -n -e 'w sed-buffer' -e 'r sed-buffer'; cat sed-buffer", "a".repeat(4095) + "\nb"],
      ["sed -zn -e 'w sed-buffer' -e 'r sed-buffer'; cat sed-buffer", Buffer.concat([Buffer.alloc(4096, 255), Buffer.from([0,97])])],
      ["sed -n -e 's/b/x/w sed-buffer' -e '$r sed-buffer'; cat sed-buffer", "b\n" + "b".repeat(12286)],
      ["sed -un -e 'w sed-live' -e 'r sed-live'", "one\ntwo"],
      ["sed --unbuffered -zn -e 's/a/b/w sed-live' -e 'r sed-live'", Buffer.from([97,0,255])],
      ["sed -n 'N;l'", "first\nsecond\n"],
      ["sed -n -z 'N;l'", "first\npart\0second\0"],
      ["sed -n 'l 70'", "é0123456789".repeat(1024) + "\n"],
      ["sed -n -l 5 'l'", Buffer.concat([Buffer.from("é💡\ue0ff"), Buffer.from([255,9,13,10])])],
      ["sed -n -l 4 'l0;l 7;l4294967295;l4294967299'", "abcdefghij\n"],
      ["cat >sed-list-edit; sed -s -n l sed-list-edit; sed -i.bak -e 'w sed-list-copy' -e l sed-list-edit; cat sed-list-edit sed-list-edit.bak sed-list-copy", Buffer.from([255,128,13,10])],
      ["rm -rf test-links; mkdir test-links; cd test-links; touch a b; ln a peer; ln -s peer sym; test a -ef peer; echo $?; [ sym -ef a ]; echo $?; [[ a -ef peer ]]; echo $?; test a -ef b; echo $?; test missing/../a -ef a; echo $?", ""],
      ["rm -rf sed-links; mkdir sed-links; cd sed-links; echo old >file; ln file peer; sed -i 's/old/new/' file; cat file peer; test ! file -ef peer", ""],
      ["rm -rf sed-backups; mkdir sed-backups; cd sed-backups; echo old >file; ln file peer; chmod 640 file; echo previous >file.bak; ln file.bak peer-backup; sed -i.bak 's/old/new/' file; cat file peer file.bak peer-backup; stat -c %a file file.bak; test peer -ef file.bak", ""],
      ["rm -rf sed-quit; mkdir sed-quit; cd sed-quit; printf 'a\\nz\\n' >a; printf 'b\\ny\\n' >b; sed -i.bak -e 'w seen' -e 'Q7' a b; rc=$?; cat a b a.bak seen; test ! -e b.bak && exit $rc", ""],
      ["sed -s -n 'p;q' samples/base samples/base", ""],
      ["rm -rf sed-directory; mkdir -p sed-directory/file.bak; cd sed-directory; echo old >file; sed -i.bak 's/old/new/' file; rc=$?; cat file; exit $rc", ""],
      ["cat >sed-list-input; sed -n l sed-list-input", Buffer.from([195,169,255,13,10])],
    ] as const).map(([script, input]) => ({ cmd: "bash", args: ["--noprofile", "--norc", "-c", script], script, input })),
    { cmd: "df", args: ["--output=file,a'b\n💡"], script: String.raw`df --output=$'file,a\'b\n💡'`, input: "" },
    ...[
      "mkdir -p cache-dir/gh/nested; touch cache-dir/gh/nested/data cache-dir/keep; XDG_CACHE_HOME=cache-dir gh config clear-cache; test ! -e cache-dir/gh && test -f cache-dir/keep",
      "mkdir -p cache-link; ln -s ../samples cache-link/gh; XDG_CACHE_HOME=cache-link gh config clear-cache; test ! -L cache-link/gh && cat samples/base",
      "mkdir -p cache-home/.cache/gh; HOME=cache-home XDG_CACHE_HOME= gh config clear-cache; test ! -d cache-home/.cache/gh",
      "XDG_CACHE_HOME=samples/base gh config clear-cache",
      "XDG_CACHE_HOME=cache-dir gh config clear-cache extra",
      ...["config clear-cache --host example.invalid", "-R o/r config clear-cache", "config clear-cache --json=x",
        "config clear-cache -h", "--help config clear-cache", "config clear-cache -- --help", "config clear-cache --help=invalid"].map(args =>
        "mkdir -p cache-flags/gh; XDG_CACHE_HOME=cache-flags gh " + args + "; rc=$?; test -d cache-flags/gh && printf '%s' \"$rc\""),

    ].map(script => ({
      cmd: "env", args: ["GH_CONFIG_DIR=.gh-config", "XDG_STATE_HOME=.gh-state", "bash", "--noprofile", "--norc", "-c", script],
      script: "(export GH_CONFIG_DIR=.gh-config XDG_STATE_HOME=.gh-state; " + script + ")", input: "",
    })),
    ...["editor", "serial", "browser", "aliases", "missing"].map(key => {
      const script = "GH_CONFIG_DIR=samples gh config get " + key;
      return { cmd: "bash", args: ["--noprofile", "--norc", "-c", script], script, input: "" };
    }),
    ...[
      "GH_CONFIG_DIR=samples gh config list",
      "mkdir -p xdg/gh; cp samples/config.yml xdg/gh/config.yml; GH_CONFIG_DIR= XDG_CONFIG_HOME=xdg gh config get serial",
      "mkdir -p gh-home/.config/gh; cp samples/config.yml gh-home/.config/gh/config.yml; HOME=gh-home GH_CONFIG_DIR= XDG_CONFIG_HOME= gh config get browser",
      "mkdir -p reread; echo 'editor: first' >reread/config.yml; GH_CONFIG_DIR=reread gh config get editor; echo 'editor: changed' >reread/config.yml; GH_CONFIG_DIR=reread gh config get editor",
      "mkdir -p broken; echo 'editor: [' >broken/config.yml; GH_CONFIG_DIR=broken gh config get editor",
      "mkdir -p malformed-args; echo 'editor: [' >malformed-args/config.yml; GH_CONFIG_DIR=malformed-args gh config get",
      "mkdir -p wrong-root; echo '[one]' >wrong-root/config.yml; GH_CONFIG_DIR=wrong-root gh config list",
      "(export GH_CONFIG_DIR=gh-write; mkdir -p gh-write; printf 'version: 1\\neditor: old # comment\\n# aliases\\naliases: {co: pr checkout}\\n' >gh-write/config.yml; gh config set editor after; cat gh-write/config.yml; echo 'editor: third' >gh-write/config.yml; gh config get editor)",
      "(export GH_CONFIG_DIR=gh-new; rm -rf gh-new; gh config set editor nano; cat gh-new/config.yml; stat -c %a gh-new/config.yml; rm gh-new/config.yml; gh config get editor)",
      "(export GH_CONFIG_DIR=gh-flow; mkdir -p gh-flow; echo '{editor: before, other: 001}' >gh-flow/config.yml; gh config set editor 123; gh config set pager cat; cat gh-flow/config.yml)",
      "(export GH_CONFIG_DIR=gh-quotes; mkdir -p gh-quotes; echo '{editor: before, other: true}' >gh-quotes/config.yml; gh config set editor ''; cat gh-quotes/config.yml; gh config set editor '2026-01-01'; cat gh-quotes/config.yml; gh config set editor $'first\\nsecond'; cat gh-quotes/config.yml)",
      "(export GH_CONFIG_DIR=gh-comments; mkdir -p gh-comments; printf 'editor: # default\\n# next\\nother: 001\\n' >gh-comments/config.yml; gh config set editor $'first\\nsecond'; cat gh-comments/config.yml)",
      "(export GH_CONFIG_DIR=gh-indent; mkdir -p gh-indent; printf '    editor: old\\n    other: 001\\n' >gh-indent/config.yml; gh config set editor $'first\\nsecond'; gh config set pager cat; gh config get editor; gh config get pager; gh config get other)",
      "(export GH_CONFIG_DIR=gh-readonly; mkdir -p gh-readonly; echo 'editor: original' >gh-readonly/config.yml; chmod 444 gh-readonly/config.yml; gh config set custom-key denied; rc=$?; chmod 644 gh-readonly/config.yml; cat gh-readonly/config.yml; exit $rc)",
      ...["gh-le", "gh-be", "gh-bom", "gh-bad-utf8", "gh-bad-utf16", "gh-no-bom"].map(name =>
        "(export GH_CONFIG_DIR=gh-encoding; mkdir -p gh-encoding; cp samples/" + name +
        " gh-encoding/config.yml; gh config get editor; gh config set editor after; rc=$?; cat gh-encoding/config.yml; exit $rc)"),
      "(export GH_CONFIG_DIR=gh-host-encoding; mkdir -p gh-host-encoding; cp samples/gh-host-le gh-host-encoding/hosts.yml; gh config get editor -h one.invalid; cp samples/gh-bad-utf8 gh-host-encoding/hosts.yml; gh config set editor after; rc=$?; test ! -e gh-host-encoding/config.yml || exit 99; exit $rc)",
      "(export GH_CONFIG_DIR=gh-host-file; mkdir -p gh-host-file; echo 'editor: global' >gh-host-file/config.yml; echo 'example.invalid: {editor: local, serial: 001, ref: &a nano, alias: *a, clipboard: disabled, telemetry: disabled}' >gh-host-file/hosts.yml; gh config get editor; gh config get editor -h example.invalid; gh config get serial -h example.invalid; gh config get alias -h example.invalid; gh config get editor -h EXAMPLE.INVALID; gh config list)",
      "(export GH_CONFIG_DIR=gh-host-switch; mkdir -p gh-host-switch; printf 'one.invalid: {editor: one}\\ntwo.invalid: {editor: two}\\n' >gh-host-switch/hosts.yml; GH_HOST=two.invalid gh config list; gh config get hosts; gh config get version; gh config get aliases)",
      "(export GH_CONFIG_DIR=gh-host-change; mkdir -p gh-host-change; echo 'one.invalid: {pager: old}' >gh-host-change/hosts.yml; gh config get pager -h one.invalid; echo 'one.invalid: {pager: new}' >gh-host-change/hosts.yml; gh config get pager -h one.invalid; rm gh-host-change/hosts.yml; gh config get pager -h one.invalid)",
      "(export GH_CONFIG_DIR=gh-host-legacy; mkdir -p gh-host-legacy; printf 'editor: global\\nhosts: {one.invalid: {editor: legacy}}\\n' >gh-host-legacy/config.yml; echo 'two.invalid: {editor: separate}' >gh-host-legacy/hosts.yml; gh config get editor -h one.invalid; gh config get editor -h two.invalid; gh config list)",
      "(export GH_CONFIG_DIR=gh-host-duplicate; mkdir -p gh-host-duplicate; printf 'one.invalid: {editor: first}\\none.invalid: {editor: second}\\n' >gh-host-duplicate/hosts.yml; gh config get editor -h one.invalid; gh config list)",
      "(export GH_CONFIG_DIR=gh-host-new; rm -rf gh-host-new; gh config set editor new -h one.invalid; cat gh-host-new/hosts.yml; cat gh-host-new/config.yml; stat -c %a gh-host-new/hosts.yml; echo 'one.invalid: {editor: changed}' >gh-host-new/hosts.yml; gh config get editor -h one.invalid)",
      "(export GH_CONFIG_DIR=gh-host-user; mkdir -p gh-host-user; printf 'one.invalid:\\n    user: A\\n    users:\\n        A: {keep: x}\\n        B: {keep: y}\\n    editor: old\\ntwo.invalid: {other: keep}\\n' >gh-host-user/hosts.yml; gh config set editor new -h one.invalid; cat gh-host-user/hosts.yml; gh config get editor -h one.invalid; test ! -e gh-host-user/config.yml)",
      "(export GH_CONFIG_DIR=gh-host-flow; mkdir -p gh-host-flow; echo '{one.invalid: {user: A}, other: {keep: 001}}' >gh-host-flow/hosts.yml; gh config set pager cat -h one.invalid; gh config set editor 123 -h two.invalid; cat gh-host-flow/hosts.yml)",
      "(export GH_CONFIG_DIR=gh-host-denied; rm -rf gh-host-denied; mkdir gh-host-denied; touch gh-host-denied/config.yml; chmod 444 gh-host-denied/config.yml; gh config set editor vi -h one.invalid; rc=$?; chmod 644 gh-host-denied/config.yml; cat gh-host-denied/hosts.yml; exit $rc)",
      "(export GH_CONFIG_DIR=gh-host-first-denied; rm -rf gh-host-first-denied; mkdir gh-host-first-denied; touch gh-host-first-denied/hosts.yml; chmod 444 gh-host-first-denied/hosts.yml; gh config set editor vi -h one; rc=$?; chmod 644 gh-host-first-denied/hosts.yml; test ! -e gh-host-first-denied/config.yml || exit 99; exit $rc)",
      "(export GH_CONFIG_DIR=gh-host-nested; mkdir -p gh-host-nested; printf 'one:\\n    user: A\\n    users:\\n        B: {keep: 001}\\nother: {keep: x}\\n' >gh-host-nested/hosts.yml; gh config set editor 123 -h one; gh config set user B -h one; cat gh-host-nested/hosts.yml)",
      "(export GH_CONFIG_DIR=gh-host-null; mkdir -p gh-host-null; printf 'one: null\\ntwo: []\\n' >gh-host-null/hosts.yml; gh config set pager cat -h one; gh config set pager cat -h two; cat gh-host-null/hosts.yml)",
      "(export GH_CONFIG_DIR=gh-host-inline-write; mkdir -p gh-host-inline-write; printf 'hosts:\\n    one: {user: A, keep: 001}\\neditor: vim\\n' >gh-host-inline-write/config.yml; gh config set editor nano -h one; cat gh-host-inline-write/hosts.yml; gh config get editor -h one; cat gh-host-inline-write/config.yml)",
      "(export GH_CONFIG_DIR=gh-host-inline-flow; mkdir -p gh-host-inline-flow; rm -f gh-host-inline-flow/hosts.yml; echo 'hosts: {one: {keep: 001}}' >gh-host-inline-flow/config.yml; gh config set pager cat -h one; cat gh-host-inline-flow/hosts.yml)",
      "(export GH_CONFIG_DIR=gh-config-file/deep; touch gh-config-file; gh config get editor; gh config set editor vim -h one)",
      "(export GH_CONFIG_DIR=gh-mkdir/locked/new/deep; mkdir -p gh-mkdir/locked; chmod 555 gh-mkdir/locked; gh config set editor vim; gh config set custom x -h one; rc=$?; chmod 755 gh-mkdir/locked; test ! -e gh-mkdir/locked/new || exit 99; exit $rc)",
      "(export GH_CONFIG_DIR=./gh-link//alias/new/deep/; mkdir -p gh-link/ro; rm -f gh-link/alias; ln -s ro gh-link/alias; chmod 555 gh-link/ro; gh config set editor vim -h one; rc=$?; chmod 755 gh-link/ro; exit $rc)",
      "(export GH_CONFIG_DIR=gh-dangling/alias/deep; mkdir -p gh-dangling; rm -f gh-dangling/alias; ln -s missing gh-dangling/alias; gh config set editor vim -h one; rc=$?; test ! -e gh-dangling/missing || exit 99; exit $rc)",
      "(export GH_CONFIG_DIR=gh-mask/new; rm -rf gh-mask; umask 077; gh config set editor vim -h one; stat -c %a gh-mask gh-mask/new gh-mask/new/hosts.yml; chmod 644 gh-mask/new/config.yml; umask 477; gh config set editor vi; stat -c %a gh-mask/new/config.yml; rm -f gh-mask/new/hosts.yml; gh config set pager cat -h one; stat -c %a gh-mask/new/hosts.yml && chmod 600 gh-mask/new/hosts.yml)",
      "(export GH_CONFIG_DIR=gh-partial/leaf; rm -rf gh-partial; umask 222; gh config set editor vim; rc=$?; stat -c %a gh-partial; chmod 755 gh-partial; test ! -e gh-partial/leaf || exit 99; exit $rc)",
      "(export GH_CONFIG_DIR=gh-host-unreadable; mkdir -p gh-host-unreadable; echo 'keep: original' >gh-host-unreadable/hosts.yml; chmod 000 gh-host-unreadable/hosts.yml; gh config set editor vim -h one; rc=$?; chmod 600 gh-host-unreadable/hosts.yml; cat gh-host-unreadable/hosts.yml; test ! -e gh-host-unreadable/config.yml || exit 99; exit $rc)",
      "(export GH_CONFIG_DIR=gh-host-directory; mkdir -p gh-host-directory/config.yml; gh config list)",
      "(export GH_CONFIG_DIR=gh-host-loop; mkdir -p gh-host-loop; rm -f gh-host-loop/hosts.yml; ln -s hosts.yml gh-host-loop/hosts.yml; gh config get editor)",
      "(export GH_CONFIG_DIR=gh-host-seed; mkdir -p gh-host-seed; echo 'one.invalid: {editor: host}' >gh-host-seed/hosts.yml; rm -f gh-host-seed/config.yml; gh config set editor global; cat gh-host-seed/config.yml; gh config get version; echo '{} # note' >gh-host-seed/config.yml; gh config set pager cat; cat gh-host-seed/config.yml; gh config get editor -h one.invalid)",
      "(export GH_CONFIG_DIR=gh-host-invalid; mkdir -p gh-host-invalid; echo 'one.invalid: [' >gh-host-invalid/hosts.yml; gh config get editor; echo '[one]' >gh-host-invalid/hosts.yml; gh config list)",
      "GH_CONFIG_DIR=scoped gh config set editor vim; GH_CONFIG_DIR=samples gh config get editor; GH_CONFIG_DIR=scoped gh config get editor",
    ].map(script => ({ cmd: "bash", args: ["--noprofile", "--norc", "-c", script], script, input: "" })),
    ...[["list"], ["ls"], ...["editor", "prompt", "color_labels", "spinner", "telemetry", "missing", "__proto__"].map(key => ["get", key]),
      ["get"], ["get", "editor", "extra"], ["set", "prompt", "sometimes"], ["set", "git_protocol", "SSH"], ["set", "telemetry", "yes"],
      ["set", "editor"], ["list", "extra"], ["set", "clipboard", "enabled", "-h", "host"], ["set", "api_host", "host"]].map(args => ({
      cmd: "env", args: ["GH_CONFIG_DIR=.gh-config", "XDG_STATE_HOME=.gh-state", "gh", "config", ...args],
      script: ["GH_CONFIG_DIR=.gh-config", "XDG_STATE_HOME=.gh-state", "gh", "config", ...args].join(" "), input: "",
    })),
    ...["gh config set --host example.invalid editor nano; gh config get editor; gh config get -h example.invalid editor; gh config list",
      "gh config set test-custom sample; gh config get test-custom; gh config list -h empty.invalid",
      "gh config set -h example.invalid telemetry log; gh config get --host=example.invalid telemetry; gh config ls -h example.invalid",
    ].map(script => ({
      cmd: "env", args: ["GH_CONFIG_DIR=.gh-roundtrip", "XDG_STATE_HOME=.gh-state", "bash", "--noprofile", "--norc", "-c", script],
      script: "(export GH_CONFIG_DIR=.gh-roundtrip XDG_STATE_HOME=.gh-state; " + script + ")", input: "",
    })),
    { cmd: "whoami", args: [], script: "EUID=" + userInfo().uid + " USER=unused whoami", input: "" },
    ...["--level=high", "-lm", "-lquality", "-llow", "--level=bad", "--level=", "--type=bad"].map(option => ({
      cmd: "qrencode", args: ["-t", "ASCII", option, "hello"], script: "qrencode -t ASCII " + option + " hello", input: "",
    })),
    { cmd: "qrencode", args: ["-t", "ansiutf8i", "-m", "1", "Hello"], script: "qrencode -t ansiutf8i -m 1 Hello", input: "" },
    { cmd: "qrencode", args: ["-M", "-t", "ANSI256UTF8", "-m", "3", "1234"], script: "qrencode -M -t ANSI256UTF8 -m 3 1234", input: "" },
    ...[Buffer.from([65, 0, 255, 66]), codecInput().subarray(0, 2048)].map(input => ({ cmd: "qrencode", args: ["-8tASCII"], script: "qrencode -8tASCII", input })),
    { cmd: "qrencode", args: ["-M", "-t", "UTF8", "12345"], script: "qrencode -M -t UTF8 12345", input: "" },
    ...["sort", "unique", "group_by(.)", "min,max"].map(filter => ({
      cmd: "jq", args: ["-c", filter], script: "jq -c '" + filter + "'",
      input: '[{"b":0},{"a":9},{"a":0,"b":[1]},{"b":[0],"a":0},{"a":0,"b":[0]},{"a":2},{"a":9},{},{"y":0,"z":1},{"z":1,"y":0}]\n',
    })),
    ...["sort_by", "group_by", "unique_by", "min_by", "max_by"].map(name => {
      const filter = name + "(.k[])";
      return { cmd: "jq", args: ["-c", filter], script: "jq -c '" + filter + "'",
        input: '[{"k":[1,2],"id":0},{"k":[null],"id":1},{"k":[],"id":2},{"k":[1,0],"id":3},{"k":[1,2],"id":4},{"k":[1,0],"id":5}]\n' };
    }),
    { cmd: "jq", args: ["-c", "has(.[])"], script: "jq -c 'has(.[])'", input: "[0,1,-1,3,40,0.9]\n" },
    { cmd: "jq", args: ["-c", "in([0],null,[])"], script: "jq -c 'in([0],null,[])'", input: "0\n" },
    { cmd: "jq", args: ["-c", "contains([], [0], [[1]])"], script: "jq -c 'contains([], [0], [[1]])'", input: "[[1],2]\n" },
    ...["startswith", "endswith", "ltrimstr", "rtrimstr"].map(name => {
      const filter = name + '("💡","x","",.)';
      return { cmd: "jq", args: ["-c", filter], script: "jq -c '" + filter + "'", input: '"💡💡x"\n' };
    }),
    { cmd: "jq", args: ["-c", "bsearch(.[])"], script: "jq -c 'bsearch(.[])'", input: JSON.stringify(Array.from({ length: 128 }, (_, i) => 2 * i)) },
    ...["[nan<1,nan<nan,1<nan,nan==nan]", "[1,nan,0]|sort", "[[nan,3],[nan,1],[nan,2]]|sort",
      "[nan,1]|bsearch(nan,1,0)", "[nan,nan]|bsearch(nan)", "[0,1,2]|[min_by(nan),max_by(nan)]", "nan|bsearch(0)"].map(filter => ({
      cmd: "jq", args: ["-c", filter], script: "jq -c '" + filter + "'", input: "null\n",
    })),
    // Match the virtual shell name ($0), including in diagnostics.
    ...pipes.map(script => ({ cmd: "bash", args: ["--noprofile", "--norc", "-c", script, "shell"], script, input: "" })),
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
    ...([["expand"], ["expand", "-i", "-t", "3,5,+4"], ["expand", "-t", "+3", "-t", "5"],
      ["expand", "-t", "/3", "-t", "5"], ["unexpand"], ["unexpand", "-4"], ["unexpand", "-4a"],
      ["unexpand", "-3", "-5"], ["unexpand", "-3,5", "-t4"], ["unexpand", "-t4"], ["unexpand", "-t", "+3", "-t", "5"], ["unexpand", "-t", "/3", "-t", "5"],
    ] as const).map(([cmd, ...args]) => ({
      cmd, args, script: [cmd, ...args].join(" "), input: (" ".repeat(38) + "a       b\t \b\tZ\n\t  x\t\t\n").repeat(8),
    })),
    { cmd: "expand", args: ["-t", "4,4294967296"], script: "expand -t 4,4294967296", input: "a\tb\n" },
    { cmd: "unexpand", args: ["-t", "65536"], script: "unexpand -t 65536", input: "\t".repeat(65536) + "a\b\t Z\n" },
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
