import {
  commandRuntimeIdentity,
  collectBytes,
  writeText,
  type ByteSource,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface Sha512sumLimits {
  readonly maxInputBytes: number;
  readonly maxArgumentBytes: number;
}

export interface Sha512sumCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly maxInputBytes?: number | undefined;
  readonly limits?: Partial<Sha512sumLimits> | undefined;
}

export type Sha512sumOptions = Sha512sumCommandsOptions;

export function settings(options: Sha512sumCommandsOptions = {}): Sha512sumLimits {
  const limits: Sha512sumLimits = {
    maxInputBytes: options.limits?.maxInputBytes ?? options.maxInputBytes ?? Infinity,
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? 64 * 1024,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  return limits;
}

const MASK_64 = 0xffffffffffffffffn;

const K: readonly bigint[] = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];

function rotr(x: bigint, n: bigint): bigint {
  return ((x >> n) | ((x << (64n - n)) & MASK_64)) & MASK_64;
}

export function sha512Hex(data: Uint8Array): string {
  let h0 = 0x6a09e667f3bcc908n;
  let h1 = 0xbb67ae8584caa73bn;
  let h2 = 0x3c6ef372fe94f82bn;
  let h3 = 0xa54ff53a5f1d36f1n;
  let h4 = 0x510e527fade682d1n;
  let h5 = 0x9b05688c2b3e6c1fn;
  let h6 = 0x1f83d9abfb41bd6bn;
  let h7 = 0x5be0cd19137e2179n;

  const bitLen = BigInt(data.byteLength) * 8n;
  const padZeroBytes = (111 - (data.byteLength % 128) + 128) % 128;
  const totalLen = data.byteLength + 1 + padZeroBytes + 16;
  const padded = new Uint8Array(totalLen);
  padded.set(data, 0);
  padded[data.byteLength] = 0x80;
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  view.setBigUint64(totalLen - 16, bitLen >> 64n, false);
  view.setBigUint64(totalLen - 8, bitLen & MASK_64, false);

  const W = new Array<bigint>(80).fill(0n);
  for (let offset = 0; offset < totalLen; offset += 128) {
    for (let i = 0; i < 16; i++) {
      W[i] = view.getBigUint64(offset + i * 8, false);
    }
    for (let i = 16; i < 80; i++) {
      const w15 = W[i - 15]!;
      const w2 = W[i - 2]!;
      const s0 = rotr(w15, 1n) ^ rotr(w15, 8n) ^ (w15 >> 7n);
      const s1 = rotr(w2, 19n) ^ rotr(w2, 61n) ^ (w2 >> 6n);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) & MASK_64;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 80; i++) {
      const S1 = rotr(e, 14n) ^ rotr(e, 18n) ^ rotr(e, 41n);
      const ch = (e & f) ^ ((~e & MASK_64) & g);
      const temp1 = (h + S1 + ch + K[i]! + W[i]!) & MASK_64;
      const S0 = rotr(a, 28n) ^ rotr(a, 34n) ^ rotr(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) & MASK_64;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) & MASK_64;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & MASK_64;
    }

    h0 = (h0 + a) & MASK_64;
    h1 = (h1 + b) & MASK_64;
    h2 = (h2 + c) & MASK_64;
    h3 = (h3 + d) & MASK_64;
    h4 = (h4 + e) & MASK_64;
    h5 = (h5 + f) & MASK_64;
    h6 = (h6 + g) & MASK_64;
    h7 = (h7 + h) & MASK_64;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map(v => v.toString(16).padStart(16, "0"))
    .join("");
}

const HELP_TEXT = `Usage: sha512sum [OPTION]... [FILE]...
Print or check SHA512 (512-bit) checksums.

With no FILE, or when FILE is -, read standard input.

  -b, --binary          read in binary mode
  -c, --check           read SHA512 sums from the FILEs and check them
      --tag             create a BSD-style checksum
  -t, --text            read in text mode (default)
  -z, --zero            end each output line with NUL, not newline,
                          and disable file name escaping

The following five options are useful only when verifying checksums:
      --ignore-missing  don't fail or report status for missing files
      --quiet           don't print OK for each successfully verified file
      --status          don't output anything, status code shows success
      --strict          exit non-zero for improperly formatted checksum lines
  -w, --warn            warn about improperly formatted checksum lines

      --help            display this help and exit
      --version         output version information and exit
`;

const VERSION_TEXT = `sha512sum (Sandbox VFS-ish/GNU coreutils) 9.7
`;

function resolveVfsPath(cwd: string, target: string): string {
  const raw = target.startsWith("/") ? target : (cwd.endsWith("/") ? cwd + target : `${cwd}/${target}`);
  const parts = raw.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return "/" + stack.join("/");
}

function escapeFilename(name: string, zero: boolean): { prefix: string; rendered: string } {
  if (zero) return { prefix: "", rendered: name };
  if (!name.includes("\\") && !name.includes("\n") && !name.includes("\r")) {
    return { prefix: "", rendered: name };
  }
  return {
    prefix: "\\",
    rendered: name
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r"),
  };
}

function unescapeFilename(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name[i]!;
    if (ch === "\\" && i + 1 < name.length) {
      const next = name[++i]!;
      if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "\\") out += "\\";
      else out += "\\" + next;
    } else {
      out += ch;
    }
  }
  return out;
}

export function createSha512sumCommand(options: Sha512sumCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name: "sha512sum",
    description: "Compute and check SHA512 message digests",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      let binary = false;
      let check = false;
      let tag = false;
      let zero = false;
      let ignoreMissing = false;
      let quiet = false;
      let statusOnly = false;
      let strict = false;
      let warn = false;
      const operands: string[] = [];
      let endOfOptions = false;

      for (let i = 0; i < context.args.length; i++) {
        const arg = context.args[i]!;
        if (!endOfOptions && arg === "--") {
          endOfOptions = true;
          continue;
        }
        if (!endOfOptions && arg === "--help") {
          await writeText(context.stdout, HELP_TEXT);
          return { exitCode: 0 };
        }
        if (!endOfOptions && arg === "--version") {
          await writeText(context.stdout, VERSION_TEXT);
          return { exitCode: 0 };
        }
        if (!endOfOptions && arg.startsWith("--") && arg.length > 2) {
          switch (arg) {
            case "--binary":
              binary = true;
              break;
            case "--text":
              binary = false;
              break;
            case "--check":
              check = true;
              break;
            case "--tag":
              tag = true;
              binary = true;
              break;
            case "--zero":
              zero = true;
              break;
            case "--ignore-missing":
              ignoreMissing = true;
              break;
            case "--quiet":
              quiet = true;
              break;
            case "--status":
              statusOnly = true;
              break;
            case "--strict":
              strict = true;
              break;
            case "--warn":
              warn = true;
              break;
            default:
              await writeText(context.stderr, `sha512sum: unrecognized option '${arg}'\n`);
              return { exitCode: 1 };
          }
          continue;
        }
        if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            const ch = arg[j]!;
            switch (ch) {
              case "b":
                binary = true;
                break;
              case "t":
                binary = false;
                break;
              case "c":
                check = true;
                break;
              case "z":
                zero = true;
                break;
              case "w":
                warn = true;
                break;
              default:
                await writeText(context.stderr, `sha512sum: invalid option -- '${ch}'\n`);
                return { exitCode: 1 };
            }
          }
          continue;
        }
        operands.push(arg);
      }

      if (tag && check) {
        await writeText(context.stderr, "sha512sum: the --tag option is meaningless when verifying checksums\n");
        return { exitCode: 1 };
      }

      const targets = operands.length > 0 ? operands : ["-"];
      let totalInputBytes = 0;
      let stdinConsumed = false;
      let stdinCache: Uint8Array = new Uint8Array(0);

      const readTargetBytes = async (target: string): Promise<Uint8Array> => {
        let bytes: Uint8Array;
        if (target === "-") {
          if (!stdinConsumed) {
            stdinConsumed = true;
            stdinCache = await collectBytes(context.stdin as ByteSource, { signal: context.signal });
          }
          bytes = stdinCache;
        } else {
          const resolved = resolveVfsPath(context.cwd, target);
          bytes = await context.fs.readFile(resolved, { signal: context.signal });
        }
        totalInputBytes += bytes.byteLength;
        if (totalInputBytes > limits.maxInputBytes) {
          throw new Error("input byte budget exceeded");
        }
        return bytes;
      };

      let exitCode = 0;
      const eol = zero ? "\0" : "\n";

      if (!check) {
        let out = "";
        for (const target of targets) {
          try {
            const bytes = await readTargetBytes(target);
            const hex = sha512Hex(bytes);
            const { prefix, rendered } = escapeFilename(target, zero);
            if (tag) {
              out += `${prefix}SHA512 (${rendered}) = ${hex}${eol}`;
            } else {
              out += `${prefix}${hex} ${binary ? "*" : " "}${rendered}${eol}`;
            }
          } catch {
            await writeText(context.stderr, `sha512sum: ${target}: No such file or directory\n`);
            exitCode = 1;
          }
        }
        if (out) await writeText(context.stdout, out);
        return { exitCode };
      }

      for (const manifestFile of targets) {
        let manifestBytes: Uint8Array;
        try {
          manifestBytes = await readTargetBytes(manifestFile);
        } catch {
          await writeText(context.stderr, `sha512sum: ${manifestFile}: No such file or directory\n`);
          exitCode = 1;
          continue;
        }

        const text = new TextDecoder().decode(manifestBytes);
        const lines = text.split(/\r?\n/);
        let validLines = 0;
        let malformedLines = 0;
        let failedReads = 0;
        let mismatches = 0;
        let matchedFiles = 0;

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const rawLine = lines[lineIdx]!;
          if (!rawLine || rawLine.startsWith("#")) continue;
          let line = rawLine;
          let escaped = false;
          if (line.startsWith("\\")) {
            escaped = true;
            line = line.slice(1);
          }

          let expectedHex = "";
          let filename = "";
          const tagMatch = /^SHA512 \((.+)\) = ([0-9a-fA-F]{128})$/.exec(line);
          const stdMatch = /^([0-9a-fA-F]{128}) [ *](.+)$/.exec(line);

          if (tagMatch) {
            filename = escaped ? unescapeFilename(tagMatch[1]!) : tagMatch[1]!;
            expectedHex = tagMatch[2]!.toLowerCase();
          } else if (stdMatch) {
            expectedHex = stdMatch[1]!.toLowerCase();
            filename = escaped ? unescapeFilename(stdMatch[2]!) : stdMatch[2]!;
          } else {
            malformedLines++;
            if (warn) {
              await writeText(
                context.stderr,
                `sha512sum: ${manifestFile}: ${lineIdx + 1}: improperly formatted SHA512 checksum line\n`
              );
            }
            continue;
          }

          validLines++;
          let targetBytes: Uint8Array;
          try {
            targetBytes = await readTargetBytes(filename);
          } catch {
            if (ignoreMissing) continue;
            failedReads++;
            if (!statusOnly) {
              await writeText(context.stderr, `sha512sum: ${filename}: No such file or directory\n`);
              await writeText(context.stdout, `${filename}: FAILED open or read\n`);
            }
            continue;
          }

          const actualHex = sha512Hex(targetBytes);
          if (actualHex === expectedHex) {
            matchedFiles++;
            if (!statusOnly && !quiet) {
              await writeText(context.stdout, `${filename}: OK\n`);
            }
          } else {
            mismatches++;
            if (!statusOnly) {
              await writeText(context.stdout, `${filename}: FAILED\n`);
            }
          }
        }

        if (validLines === 0) {
          await writeText(context.stderr, `sha512sum: ${manifestFile}: no properly formatted SHA512 checksum lines found\n`);
          exitCode = 1;
        } else {
          if (!statusOnly) {
            if (malformedLines > 0) {
              await writeText(context.stderr, `sha512sum: WARNING: ${malformedLines} line is improperly formatted\n`);
            }
            if (failedReads > 0) {
              await writeText(context.stderr, `sha512sum: WARNING: ${failedReads} listed file could not be read\n`);
            }
            if (mismatches > 0) {
              await writeText(context.stderr, `sha512sum: WARNING: ${mismatches} computed checksum did NOT match\n`);
            }
          }
          if (failedReads > 0 || mismatches > 0 || (strict && malformedLines > 0) || (ignoreMissing && matchedFiles === 0)) {
            exitCode = 1;
          }
        }
      }

      return { exitCode };
    },
  };
}

export function createSha512sumCommands(options: Sha512sumCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createSha512sumCommand(options)]);
}

export function sha512sumCommands(options: Sha512sumCommandsOptions = {}): VirtualShellPlugin {
  const commands = createSha512sumCommands(options);
  return {
    name: "sha512sum-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) {
            throw new Error(`Command already registered: ${command.name}`);
          }
        }
      }
      for (const command of commands) {
        host.commands.register(command, { replace: options.replace ?? false });
      }
    },
  };
}
