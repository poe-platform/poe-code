import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

const createEnv = () => SafeBashE2EHarness.create();

describe("obscure archive tar zip unzip gzip bzip2 xz zstd xxd hexdump strings od diagnostics parity matrix", () => {
  test("1. gzip, bzip2, xz, lzma, and zstd --help and dynamic default compression levels", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      gzip -h | grep -E 'Usage: gzip|-r, --recursive'
      bzip2 -h | grep -E 'Usage: bzip2|Default compression level:'
      bzip2 -s -h | grep -E 'Default compression level:'
      xz -h | grep -E 'Usage: xz|Default compression level:'
      lzma --help | grep -E 'Usage: lzma|Default compression level:'
      zstd --help | grep -E 'Usage: zstd|Default compression level:'
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "Usage: gzip [OPTION]... [FILE]...",
        "-r, --recursive (traverse directories without following symlinks)",
        "Usage: bzip2 [OPTION]... [FILE]...",
        "Default compression level: 9.",
        "Default compression level: 2.",
        "Usage: xz [OPTION]... [FILE]...",
        "Default compression level: 1.",
        "Usage: lzma [OPTION]... [FILE]...",
        "Default compression level: 1.",
        "Usage: zstd [OPTION]... [FILE]...",
        "Default compression level: 3.",
        "",
      ].join("\n"),
    );
  });

  test("2. zstd --fast, level 0, level >9, and unsupported feature diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      zstd --fast 2>&1; echo "rc1=$?"
      zstd --fast=3 2>&1; echo "rc2=$?"
      zstd --fast=0 2>&1; echo "rc3=$?"
      zstd -0 2>&1; echo "rc4=$?"
      zstd -19 2>&1; echo "rc5=$?"
      zstd --adapt 2>&1; echo "rc6=$?"
      zstd --rsyncable 2>&1; echo "rc7=$?"
      zstd --format=gzip 2>&1; echo "rc8=$?"
      zstd --long=9 2>&1; echo "rc9=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(
      r.stdout,
      /zstd: unsupported compression level -1; the bounded Zstandard codec supports only levels 1 through 9 \(fast mode is unsupported\)\nrc1=2\n/,
    );
    assert.match(
      r.stdout,
      /zstd: unsupported compression level -3; the bounded Zstandard codec supports only levels 1 through 9 \(fast mode is unsupported\)\nrc2=2\n/,
    );
    assert.match(r.stdout, /zstd: invalid fast acceleration '0'\nrc3=2\n/);
    assert.match(r.stdout, /zstd: invalid option -- '0'\nrc4=2\n/);
    assert.match(
      r.stdout,
      /zstd: unsupported compression level 19; the bounded Zstandard codec supports only levels 1 through 9 \(fast mode is unsupported\)\nrc5=2\n/,
    );
    assert.match(
      r.stdout,
      /zstd: --adapt is unsupported by the bounded streaming Zstandard frontend\nrc6=2\n/,
    );
    assert.match(
      r.stdout,
      /zstd: --rsyncable is unsupported by the bounded streaming Zstandard frontend\nrc7=2\n/,
    );
    assert.match(r.stdout, /zstd: only --format=zstd is supported\nrc8=2\n/);
    assert.match(
      r.stdout,
      /zstd: long-distance matching requires a window log from 10 through 30\nrc9=2\n/,
    );
  });

  test("3. xz and lzma format, check, robot, list, and threads validation diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      xz --format=alone 2>&1; echo "rc1=$?"
      xz --check=crc16 2>&1; echo "rc2=$?"
      lzma --check=crc32 2>&1; echo "rc3=$?"
      xz --robot 2>&1; echo "rc4=$?"
      lzma --list 2>&1; echo "rc5=$?"
      xz --threads=2 2>&1; echo "rc6=$?"
      xz -T 2 2>&1; echo "rc7=$?"
      zstd --threads=2 2>&1; echo "rc8=$?"
      zstd -T4 2>&1; echo "rc9=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /xz: unsupported XZ format\nrc1=2\n/);
    assert.match(r.stdout, /xz: unsupported XZ integrity check 'crc16'\nrc2=2\n/);
    assert.match(r.stdout, /lzma: the LZMA format supports only --check=none\nrc3=2\n/);
    assert.match(r.stdout, /xz: robot mode is only supported for --list\nrc4=2\n/);
    assert.match(
      r.stdout,
      /lzma: --list works only on \.xz files \(--format=xz or --format=auto\)\nrc5=2\n/,
    );
    assert.match(
      r.stdout,
      /xz: only --threads=0 or --threads=1 is supported by the single-threaded XZ codec\nrc6=2\n/,
    );
    assert.match(
      r.stdout,
      /xz: only --threads=0 or --threads=1 is supported by the single-threaded xz codec\nrc7=2\n/,
    );
    assert.match(
      r.stdout,
      /zstd: only --threads=0 or --threads=1 is supported by the single-threaded Zstandard codec\nrc8=2\n/,
    );
    assert.match(
      r.stdout,
      /zstd: only --threads=0 or --threads=1 is supported by the single-threaded zstd codec\nrc9=2\n/,
    );
  });

  test("4. gzip, bzip2, xz, and zstd suffix validation and format-restricted flags", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      gzip -S "" 2>&1; echo "rc1=$?"
      gzip -S "a/b" 2>&1; echo "rc2=$?"
      xz --suffix 2>&1; echo "rc3=$?"
      bzip2 -S .bz 2>&1; echo "rc4=$?"
      bzip2 -r 2>&1; echo "rc5=$?"
      xz -n 2>&1; echo "rc6=$?"
      gzip -s 2>&1; echo "rc7=$?"
      bzip2 -l 2>&1; echo "rc8=$?"
      gzip -e 2>&1; echo "rc9=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /gzip: incorrect suffix ''\nrc1=2\n/);
    assert.match(r.stdout, /gzip: incorrect suffix 'a\/b'\nrc2=2\n/);
    assert.match(r.stdout, /xz: option '--suffix' requires an argument\nrc3=2\n/);
    assert.match(r.stdout, /bzip2: invalid option -- 'S'\nrc4=2\n/);
    assert.match(r.stdout, /bzip2: invalid option -- 'r'\nrc5=2\n/);
    assert.match(r.stdout, /xz: invalid option -- 'n'\nrc6=2\n/);
    assert.match(r.stdout, /gzip: invalid option -- 's'\nrc7=2\n/);
    assert.match(r.stdout, /bzip2: invalid option -- 'l'\nrc8=2\n/);
    assert.match(r.stdout, /gzip: invalid option -- 'e'\nrc9=2\n/);
  });

  test("5. tar --help, missing operation, conflicting operations, and conflicting compression options", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      tar --help | head -n 2
      tar -f /tmp/a.tar 2>&1; echo "rc1=$?"
      tar -ct -f /tmp/a.tar 2>&1; echo "rc2=$?"
      tar --create --delete -f /tmp/a.tar 2>&1; echo "rc3=$?"
      tar -czj -f /tmp/a.tar 2>&1; echo "rc4=$?"
      tar -c --gzip --xz -f /tmp/a.tar 2>&1; echo "rc5=$?"
      tar -c -f /tmp/a.tar 2>&1; echo "rc6=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(
      r.stdout,
      /^Usage: tar \[OPTION\]\.\.\. \[FILE\]\.\.\.\nCreate, read or modify USTAR\/PAX archives in the virtual filesystem\.\n/,
    );
    assert.match(
      r.stdout,
      /tar: exactly one tar operation is required \(-c, -t, -x, -r, -u, -d, --delete, -A\)\nrc1=2\n/,
    );
    assert.match(
      r.stdout,
      /tar: exactly one tar operation is required \(-c, -t, -x, -r, -u, -d, --delete, -A\)\nrc2=2\n/,
    );
    assert.match(
      r.stdout,
      /tar: exactly one tar operation is required \(-c, -t, -x, -r, -u, -d, --delete, -A\)\nrc3=2\n/,
    );
    assert.match(r.stdout, /tar: conflicting compression options\nrc4=2\n/);
    assert.match(r.stdout, /tar: conflicting compression options\nrc5=2\n/);
    assert.match(r.stdout, /tar: refusing to create an empty archive without -T\nrc6=2\n/);
  });

  test("6. tar sort, quoting-style, format, mode, mtime, owner, group, and strip-components validation", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      tar -cf /tmp/a.tar --sort=inode /tmp 2>&1; echo "rc1=$?"
      tar -cf /tmp/a.tar --quoting-style=clocale /tmp 2>&1; echo "rc2=$?"
      tar -cf /tmp/a.tar --format=v7 /tmp 2>&1; echo "rc3=$?"
      tar -cf /tmp/a.tar --mode=invalid /tmp 2>&1; echo "rc4=$?"
      tar -cf /tmp/a.tar --mtime=not-a-date /tmp 2>&1; echo "rc5=$?"
      tar -cf /tmp/a.tar --owner=user:abc /tmp 2>&1; echo "rc6=$?"
      tar -cf /tmp/a.tar --group=:xyz /tmp 2>&1; echo "rc7=$?"
      tar -xf /tmp/a.tar --strip-components=-1 2>&1; echo "rc8=$?"
      tar -xf /tmp/a.tar --occurrence=0 2>&1; echo "rc9=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /tar: unsupported sort order: inode\nrc1=2\n/);
    assert.match(
      r.stdout,
      /tar: unsupported quoting style: clocale; use literal, escape or c\nrc2=2\n/,
    );
    assert.match(r.stdout, /tar: unsupported archive format: v7\nrc3=2\n/);
    assert.match(r.stdout, /tar: invalid numeric mode: invalid\nrc4=2\n/);
    assert.match(r.stdout, /tar: invalid mtime: not-a-date\nrc5=2\n/);
    assert.match(r.stdout, /tar: invalid numeric owner: user:abc\nrc6=2\n/);
    assert.match(r.stdout, /tar: invalid numeric group: :xyz\nrc7=2\n/);
    assert.match(r.stdout, /tar: invalid strip-components count\nrc8=2\n/);
    assert.match(r.stdout, /tar: invalid occurrence count\nrc9=2\n/);
  });

  test("7. tar blocking-factor, record-size, atime-preserve, missing argument, and unknown option diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      tar -cf /tmp/a.tar -b 0 /tmp 2>&1; echo "rc1=$?"
      tar -cf /tmp/a.tar --record-size=500 /tmp 2>&1; echo "rc2=$?"
      tar -cf /tmp/a.tar --atime-preserve=invalid /tmp 2>&1; echo "rc3=$?"
      tar -c -f 2>&1; echo "rc4=$?"
      tar -cf /tmp/a.tar --transform 2>&1; echo "rc5=$?"
      tar -cf /tmp/a.tar --unknown-flag /tmp 2>&1; echo "rc6=$?"
      tar -cf /tmp/a.tar -Q /tmp 2>&1; echo "rc7=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /tar: record size must be a positive multiple of 512\nrc1=2\n/);
    assert.match(r.stdout, /tar: record size must be a positive multiple of 512\nrc2=2\n/);
    assert.match(
      r.stdout,
      /tar: only --atime-preserve=replace is supported; filesystem has no no-atime read capability\nrc3=2\n/,
    );
    assert.match(r.stdout, /tar: missing argument for -f\nrc4=2\n/);
    assert.match(r.stdout, /tar: missing argument for --transform\nrc5=2\n/);
    assert.match(r.stdout, /tar: unsupported option: unknown-flag\nrc6=2\n/);
    assert.match(r.stdout, /tar: unsupported option: Q\nrc7=2\n/);
  });

  test("8. zip --help, --more-help, --version, lone -v, and --license banners", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      zip -h | head -n 2
      zip -h2 | grep -E '^Selection|^Streaming'
      zip -v
      zip -L
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /^safe-bash zip\nUsage: zip \[options\] archive \[file \.\.\.\]\n/);
    assert.match(r.stdout, /Selection\nStreaming\n/);
    assert.match(
      r.stdout,
      /safe-bash zip \(virtual-bash\)\nBounded virtual ZIP implementation; not an Info-ZIP native build\.\n/,
    );
    assert.match(
      r.stdout,
      /This is the virtual implementation license, not the native Info-ZIP license\.\n/,
    );
  });

  test("9. zip invalid command argument diagnostics (exit 16 on stdout)", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      zip -- /tmp/a.zip /tmp/f.txt; echo "rc1=$?"
      zip -d -u /tmp/a.zip /tmp/f.txt; echo "rc2=$?"
      zip -r -R /tmp/a.zip '*.txt'; echo "rc3=$?"
      zip -Z lz4 /tmp/a.zip /tmp/f.txt; echo "rc4=$?"
      zip -P "" /tmp/a.zip /tmp/f.txt; echo "rc5=$?"
      zip -U /tmp/a.zip '*.txt'; echo "rc6=$?"
      zip -d -FS /tmp/a.zip /tmp/f.txt; echo "rc7=$?"
      zip -b; echo "rc8=$?"
      zip --unknown-opt /tmp/a.zip /tmp/f.txt; echo "rc9=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(
      r.stdout,
      /\nzip error: Invalid command arguments \(can't use -- before archive name\)\nrc1=16\n/,
    );
    assert.match(
      r.stdout,
      /\nzip error: Invalid command arguments \(specify just one action\)\nrc2=16\n/,
    );
    assert.match(
      r.stdout,
      /\nzip error: Invalid command arguments \(do not specify both -r and -R\)\nrc3=16\n/,
    );
    assert.match(
      r.stdout,
      /\nzip error: Invalid command arguments \(Option -Z \(--compression-method\): {2}unknown method\)\nrc4=16\n/,
    );
    assert.match(
      r.stdout,
      /\nzip error: Invalid command arguments \(\[redacted\]\)\nrc5=16\n/,
    );
    assert.match(
      r.stdout,
      /\nzip error: Invalid command arguments \(-U \(--copy\) requires -O \(--out\)\)\nrc6=16\n/,
    );
    assert.match(
      r.stdout,
      /\nzip error: Invalid command arguments \(can't use -d, -f, -u, -U, or -g with filesync -FS\n\)\nrc7=16\n/,
    );
    assert.match(
      r.stdout,
      /\nzip error: Invalid command arguments \(option b requires a value\)\nrc8=16\n/,
    );
    assert.match(
      r.stdout,
      /\nzip error: Invalid command arguments \(unsupported option: --unknown-opt\)\nrc9=16\n/,
    );
  });

  test("10. unzip missing archive usage and conflicting mode diagnostics (exit 2 on stderr)", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      unzip 2>&1; echo "rc1=$?"
      unzip -d /tmp/a -d /tmp/b /tmp/arch.zip 2>&1; echo "rc2=$?"
      unzip -d "" /tmp/arch.zip 2>&1; echo "rc3=$?"
      unzip -P 2>&1; echo "rc4=$?"
      unzip -Z /tmp/arch.zip 2>&1; echo "rc5=$?"
      unzip -Z -1 -t /tmp/arch.zip 2>&1; echo "rc6=$?"
      unzip -z -l /tmp/arch.zip 2>&1; echo "rc7=$?"
      unzip -t -l /tmp/arch.zip 2>&1; echo "rc8=$?"
      unzip -Q /tmp/arch.zip 2>&1; echo "rc9=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(
      r.stdout,
      /unzip: usage: unzip \[-l\|-v\] \[-C\] \[-u\|-f\] \[-p\|-c\] \[-t\] \[-z\] \[-Z -1\] \[-q\[q\]\] \[-o\] \[-n\] \[-j\] \[-d DIR\] ARCHIVE \[FILES\.\.\.\] \[-x PATTERNS\.\.\.\]\nrc1=2\n/,
    );
    assert.match(r.stdout, /unzip: -d may only be specified once\nrc2=2\n/);
    assert.match(r.stdout, /unzip: must specify directory to which to extract with -d option\nrc3=2\n/);
    assert.match(r.stdout, /unzip: password option requires a value\nrc4=2\n/);
    assert.match(
      r.stdout,
      /unzip: supported zipinfo mode is unzip -Z -1 ARCHIVE \[FILES\.\.\.\]\nrc5=2\n/,
    );
    assert.match(
      r.stdout,
      /unzip: supported zipinfo mode is unzip -Z -1 ARCHIVE \[FILES\.\.\.\]\nrc6=2\n/,
    );
    assert.match(
      r.stdout,
      /unzip: archive comment mode cannot be combined with extraction, listing or test options\nrc7=2\n/,
    );
    assert.match(
      r.stdout,
      /unzip: unzip test mode cannot be combined with listing, pipe or destination\nrc8=2\n/,
    );
    assert.match(r.stdout, /unzip: unsupported option: -Q\nrc9=2\n/);
  });

  test("11. xxd unrecognized long option, invalid option, -e power-of-2 group, and missing/directory file diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/xxd_dir
      xxd -h 2>&1; echo "h_rc=$?"
      xxd --help 2>&1; echo "rc1=$?"
      xxd -e -g 3 <<< "abcd" 2>&1; echo "rc2=$?"
      xxd -e -g 5 <<< "abcd" 2>&1; echo "rc3=$?"
      xxd -c -1 <<< "abcd" 2>&1; echo "rc4=$?"
      xxd /tmp/xxd_dir 2>&1; echo "rc5=$?"
      xxd /tmp/nonexistent_xxd.bin 2>&1; echo "rc6=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /xxd: invalid option -- 'h'\nh_rc=2\n/);
    assert.match(r.stdout, /xxd: unrecognized option '--help'\nrc1=2\n/);
    assert.match(
      r.stdout,
      /xxd: number of octets per group must be a power of 2 with -e\nrc2=2\n/,
    );
    assert.match(
      r.stdout,
      /xxd: number of octets per group must be a power of 2 with -e\nrc3=2\n/,
    );
    assert.match(r.stdout, /xxd: invalid number '-1'\nrc4=2\n/);
    assert.match(
      r.stdout,
      /xxd: EISDIR: illegal operation on a directory, readStream '\/tmp\/xxd_dir'\nrc5=1\n/,
    );
    assert.match(
      r.stdout,
      /xxd: ENOENT: no such file or directory, readStream '\/tmp\/nonexistent_xxd\.bin'\nrc6=2\n/,
    );
  });

  test("12. hexdump and hd -f, -e, -n, -s, invalid option, and missing file diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      hexdump -f /tmp/fmt.txt 2>&1; echo "rc1=$?"
      hexdump -ffmt.txt 2>&1; echo "rc2=$?"
      hexdump -e 2>&1; echo "rc3=$?"
      hexdump -n 2>&1; echo "rc4=$?"
      hexdump -s -5 2>&1; echo "rc5=$?"
      hexdump -Z 2>&1; echo "rc6=$?"
      hd /tmp/missing_hd.bin 2>&1; echo "rc7=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /hexdump: -f: format files are not supported\nrc1=1\n/);
    assert.match(r.stdout, /hexdump: -f: format files are not supported\nrc2=1\n/);
    assert.match(r.stdout, /hexdump: -e requires a format\nrc3=1\n/);
    assert.match(
      r.stdout,
      /hexdump: option requires an argument -- 'n'\nusage: hexdump \[-bcCdovx\] \[-e fmt\] \[-f fmt_file\] \[-n length\]\n\s+\[-s skip\] \[file \.\.\.\]\n\s+hd\s+\[-bcdovx\]\s+\[-e fmt\] \[-f fmt_file\] \[-n length\]\n\s+\[-s skip\] \[file \.\.\.\]\nrc4=1\n/,
    );
    assert.match(r.stdout, /hexdump: -5: bad skip value\nrc5=1\n/);
    assert.match(r.stdout, /hexdump: unsupported option -- 'Z'\nrc6=1\n/);
    assert.match(r.stdout, /hd: \/tmp\/missing_hd\.bin: No such file or directory\nrc7=1\n/);
  });

  test("13. od --help, --version, -e, --endian, -A, -w, -S, and type specifier diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      od --help | head -n 1
      od --version
      od -ebig 2>&1; echo "rc1=$?"
      od --endian=middle 2>&1; echo "rc2=$?"
      od -A z 2>&1; echo "rc3=$?"
      od -w0 2>&1; echo "rc4=$?"
      od -S0 2>&1; echo "rc5=$?"
      od -t z1 2>&1; echo "rc6=$?"
      od -t x3 2>&1; echo "rc7=$?"
      od --output-duplicates=no 2>&1; echo "rc8=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(
      r.stdout,
      /^Usage: od \[OPTION\]\.\.\. \[FILE\]\.\.\.\nod \(safe-bash virtual implementation\)\n/,
    );
    assert.match(r.stdout, /od: use --endian=little or --endian=big; -e is unsupported\nrc1=2\n/);
    assert.match(r.stdout, /od: endian must be little or big\nrc2=2\n/);
    assert.match(r.stdout, /od: address radix must be d, o, x, or n\nrc3=2\n/);
    assert.match(r.stdout, /od: width must be positive\nrc4=2\n/);
    assert.match(r.stdout, /od: minimum string length must be positive\nrc5=2\n/);
    assert.match(
      r.stdout,
      /od: unsupported type 'z1': use a, c, f4\/f8 or d\/o\/u\/x with size 1, 2, 4, or 8\nrc6=2\n/,
    );
    assert.match(
      r.stdout,
      /od: unsupported type 'x3': use a, c, f4\/f8 or d\/o\/u\/x with size 1, 2, 4, or 8\nrc7=2\n/,
    );
    assert.match(r.stdout, /od: option '--output-duplicates' does not take an argument\nrc8=2\n/);
  });

  test("14. strings radix, encoding, minimum length, unknown option, and missing/directory file diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/str_dir
      strings -n 0 2>&1; echo "rc1=$?"
      strings -t z 2>&1; echo "rc2=$?"
      strings -e q 2>&1; echo "rc3=$?"
      strings -U bogus 2>&1; echo "rc4=$?"
      strings --unknown-opt 2>&1; echo "rc5=$?"
      strings /tmp/no_such_strings.bin 2>&1; echo "rc6=$?"
      strings /tmp/str_dir 2>&1; echo "rc7=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /strings: invalid number '0'\nrc1=1\n/);
    assert.match(r.stdout, /strings: invalid radix 'z'\nrc2=1\n/);
    assert.match(r.stdout, /strings: invalid encoding 'q'\nrc3=1\n/);
    assert.match(r.stdout, /strings: invalid Unicode option 'bogus'\nrc4=1\n/);
    assert.match(r.stdout, /strings: unrecognized option '--unknown-opt'\nrc5=1\n/);
    assert.match(
      r.stdout,
      /strings: ENOENT: no such file or directory, stat '\/tmp\/no_such_strings\.bin'\nrc6=1\n/,
    );
    assert.match(
      r.stdout,
      /strings: EISDIR: illegal operation on a directory '\/tmp\/str_dir'\nrc7=1\n/,
    );
  });

  test("15. xz -l / --list and xz -l --robot inspection round-trips", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      printf 'hello compression world\\n' > /tmp/sample.txt
      xz -k -f --check=crc32 /tmp/sample.txt
      xz -l /tmp/sample.txt.xz
      xz -l --robot /tmp/sample.txt.xz
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /Strms\s+Blocks\s+Compressed\s+Uncompressed\s+Ratio\s+Check\s+Filename/);
    assert.match(r.stdout, /24 B\s+\d+\.\d+\s+CRC32\s+\/tmp\/sample\.txt\.xz/);
    assert.match(r.stdout, /name\t\/tmp\/sample\.txt\.xz\nfile\t1\t1\t\d+\t24\t\d+\.\d+\tCRC32\t0\n/);
  });

  test("16. tar create, append (-r), update (-u), diff (-d), --delete, and concatenate (-A) workflows", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/tar_wk
      printf 'alpha\\n' > /tmp/tar_wk/a.txt
      printf 'beta\\n' > /tmp/tar_wk/b.txt
      printf 'gamma\\n' > /tmp/tar_wk/c.txt
      tar -cf /tmp/tar_wk/one.tar -C /tmp/tar_wk a.txt
      tar -rf /tmp/tar_wk/one.tar -C /tmp/tar_wk b.txt
      tar -cf /tmp/tar_wk/two.tar -C /tmp/tar_wk c.txt
      tar -Af /tmp/tar_wk/one.tar /tmp/tar_wk/two.tar
      tar -tf /tmp/tar_wk/one.tar
      tar --delete -f /tmp/tar_wk/one.tar b.txt
      echo "--- after delete ---"
      tar -tf /tmp/tar_wk/one.tar
      tar -df /tmp/tar_wk/one.tar -C /tmp/tar_wk a.txt; echo "diff_rc1=$?"
      printf 'alpha modified\\n' > /tmp/tar_wk/a.txt
      tar -df /tmp/tar_wk/one.tar -C /tmp/tar_wk a.txt 2>&1; echo "diff_rc2=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "a.txt",
        "b.txt",
        "c.txt",
        "--- after delete ---",
        "a.txt",
        "c.txt",
        "diff_rc1=0",
        "a.txt: Size differs",
        "diff_rc2=1",
        "",
      ].join("\n"),
    );
  });

  test("17. zip -P / -e capability diagnostics, archive comment (-z), test (-t), and zipinfo (-Z -1)", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/zip_wk
      printf 'secret payload 42\\n' > /tmp/zip_wk/secret.txt
      printf 'public note\\n' > /tmp/zip_wk/note.txt
      zip -q -P s3cr3t /tmp/zip_wk/pw.zip /tmp/zip_wk/secret.txt 2>&1; echo "pw_rc=$?"
      zip -q -e /tmp/zip_wk/pw2.zip /tmp/zip_wk/secret.txt 2>&1; echo "enc_rc=$?"
      printf 'Archive Header Comment\\n.\\n' | zip -q -z /tmp/zip_wk/vault.zip /tmp/zip_wk/secret.txt /tmp/zip_wk/note.txt
      unzip -Z -1 /tmp/zip_wk/vault.zip
      unzip -z /tmp/zip_wk/vault.zip
      unzip -t /tmp/zip_wk/vault.zip | grep -E 'testing:|No errors'
      unzip -p /tmp/zip_wk/vault.zip tmp/zip_wk/secret.txt
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /zip: ZIP entropy capability is unavailable\npw_rc=2\n/);
    assert.match(r.stdout, /zip: ZIP no-echo password capability is unavailable\nenc_rc=2\n/);
    assert.match(r.stdout, /tmp\/zip_wk\/secret\.txt\ntmp\/zip_wk\/note\.txt\n/);
    assert.match(r.stdout, /Archive: {2}\/tmp\/zip_wk\/vault\.zip\nArchive Header Comment\n/);
    assert.match(
      r.stdout,
      /testing: tmp\/zip_wk\/secret\.txt\s+OK\n\s+testing: tmp\/zip_wk\/note\.txt\s+OK\nNo errors detected in compressed data of \/tmp\/zip_wk\/vault\.zip\.\n/,
    );
    assert.match(r.stdout, /secret payload 42\n/);
  });

  test("18. xxd plain (-p), C include (-i), binary (-b), little-endian (-e), and reverse (-r) round-trip", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      printf 'ABCD' | xxd -e -g 2
      printf 'ABCD' | xxd -b -c 4
      printf 'Hi!' > /tmp/hi.bin
      xxd -i -C -n greeting_buf /tmp/hi.bin
      printf '48656c6c6f0a' | xxd -r -p
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "00000000: 4241 4443                                ABCD",
        "00000000: 01000001 01000010 01000011 01000100  ABCD",
        "unsigned char GREETING_BUF[] = {",
        "  0x48, 0x69, 0x21",
        "};",
        "unsigned int GREETING_BUF_LEN = 3;",
        "Hello",
        "",
      ].join("\n"),
    );
  });

  test("19. hexdump custom format (-e), canonical (-C), and duplicate suppression (-v)", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      printf 'ABCD' | hexdump -e '4/1 "%02x-" "\\n"'
      printf 'AAAAAAAAAAAAAAAABBBBBBBBBBBBBBBBAAAAAAAAAAAAAAAA' | hexdump -C
      printf 'AAAAAAAAAAAAAAAA' | hexdump -C -v
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "41-42-43-44-",
        "00000000  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 41  |AAAAAAAAAAAAAAAA|",
        "00000010  42 42 42 42 42 42 42 42  42 42 42 42 42 42 42 42  |BBBBBBBBBBBBBBBB|",
        "00000020  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 41  |AAAAAAAAAAAAAAAA|",
        "00000030",
        "00000000  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 41  |AAAAAAAAAAAAAAAA|",
        "00000010",
        "",
      ].join("\n"),
    );
  });

  test("20. od endianness (--endian=big/little), strings (-S), and strings UTF-16LE (-e l) extraction", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      printf '\\x01\\x02\\x03\\x04' | od -An -tx2 --endian=little
      printf '\\x01\\x02\\x03\\x04' | od -An -tx2 --endian=big
      printf '\\x00\\x00hello\\x00\\x01world!\\x00' | od -S5
      printf 'T\\x00e\\x00s\\x00t\\x001\\x002\\x00\\x00\\x00' | strings -e l -n 5 -t x
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        " 0201 0403",
        " 0102 0304",
        "0000002 hello",
        "0000011 world!",
        "      0 Test12",
        "",
      ].join("\n"),
    );
  });
});
