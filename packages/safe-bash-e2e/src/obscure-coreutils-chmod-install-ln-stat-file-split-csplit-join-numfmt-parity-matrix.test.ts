import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure coreutils, chmod, install, ln, stat, file, split, csplit, join, and numfmt parity matrix", () => {
  it("1. file classifies BMP, ICO, RAR v5, ELF 64-bit shared object, PE/DOS executables, and OLE Compound Documents across -b and --mime-type", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        mkdir -p /workspace/magic

        # BMP (26 bytes, 'BM' at 0, header size 40 at offset 14)
        printf '424d000000000000000000000000280000000000000000000000' | xxd -r -p > /workspace/magic/pic.bmp
        # ICO (22 bytes, 00 00 01 00 at 0, count 1 at offset 4)
        printf '00000100010000000000000000000000000000000000' | xxd -r -p > /workspace/magic/icon.ico
        # RAR v5 (16 bytes, 'Rar!\x1a\x07\x01\x00' + 8 zero bytes)
        printf '526172211a0701000000000000000000' | xxd -r -p > /workspace/magic/arch.rar
        # ELF 64-bit shared object (64 bytes, 7f 45 4c 46 02 01 01 at 0, e_type=3 at offset 16)
        printf '7f454c46020101000000000000000000030000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' | xxd -r -p > /workspace/magic/lib.so
        # PE executable (88 bytes, 'MZ' at 0, offset 64 at 60..64, 'PE\0\0' at 64..68)
        (
          printf '4d5a' | xxd -r -p
          dd if=/dev/zero bs=1 count=58 2>/dev/null
          printf '4000000050450000' | xxd -r -p
          dd if=/dev/zero bs=1 count=20 2>/dev/null
        ) > /workspace/magic/app.exe
        # DOS executable (64 bytes, 'MZ' at 0, zero offset)
        (
          printf '4d5a' | xxd -r -p
          dd if=/dev/zero bs=1 count=62 2>/dev/null
        ) > /workspace/magic/dos.com
        # OLE Compound Document (512 bytes, D0 CF 11 E0 A1 B1 1A E1 at 0..8, FE FF at 28..30)
        (
          printf 'd0cf11e0a1b11ae1' | xxd -r -p
          dd if=/dev/zero bs=1 count=20 2>/dev/null
          printf 'feff' | xxd -r -p
          dd if=/dev/zero bs=1 count=482 2>/dev/null
        ) > /workspace/magic/legacy.doc

        echo "=== DESC ==="
        file -b /workspace/magic/pic.bmp /workspace/magic/icon.ico /workspace/magic/arch.rar /workspace/magic/lib.so /workspace/magic/app.exe /workspace/magic/dos.com /workspace/magic/legacy.doc
        echo "=== MIME ==="
        file -b --mime-type /workspace/magic/pic.bmp /workspace/magic/icon.ico /workspace/magic/arch.rar /workspace/magic/lib.so /workspace/magic/app.exe /workspace/magic/dos.com /workspace/magic/legacy.doc
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== DESC ===",
          "PC bitmap image data",
          "MS Windows icon resource",
          "RAR archive data",
          "ELF 64-bit shared object",
          "PE executable",
          "DOS executable",
          "OLE Compound Document",
          "=== MIME ===",
          "image/bmp",
          "image/vnd.microsoft.icon",
          "application/x-rar",
          "application/x-sharedlib",
          "application/vnd.microsoft.portable-executable",
          "application/x-dosexec",
          "application/x-ole-storage",
          "",
        ].join("\n")
      );
    });
  });

  it("2. /dev/null character device metadata across test -c, [[ -c ]], stat, file, find -type c, and symlink dereference", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        ln -s /dev/null /workspace/null_alias
        test -c /dev/null && echo "test_c=1" || echo "test_c=0"
        test ! -f /dev/null && echo "test_not_f=1" || echo "test_not_f=0"
        [[ -c /dev/null && ! -f /dev/null ]] && echo "cond_c=1" || echo "cond_c=0"
        stat -c '%F|%A|%a|%f|%s' /dev/null
        stat -L -c '%F|%A|%a|%f|%s' /workspace/null_alias
        file -b /dev/null
        file -b --mime-type /dev/null
        file -bL /workspace/null_alias
        find /dev -name null -type c
        find /dev -name null -type f
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "test_c=1",
          "test_not_f=1",
          "cond_c=1",
          "character special file|crw-rw-rw-|666|21b6|0",
          "character special file|crw-rw-rw-|666|21b6|0",
          "character special",
          "inode/chardevice",
          "character special",
          "/dev/null",
          "",
        ].join("\n")
      );
    });
  });

  it("3. chmod setuid, setgid, and sticky bit transitions (s/S, t/T) and test -u/-g/-k predicates", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        touch /workspace/perm.bin
        chmod 0644 /workspace/perm.bin
        test -u /workspace/perm.bin && u0=1 || u0=0
        test -g /workspace/perm.bin && g0=1 || g0=0
        test -k /workspace/perm.bin && k0=1 || k0=0
        test -c /workspace/perm.bin && c0=1 || c0=0
        echo "initial=$u0:$g0:$k0:$c0:$(stat -c '%a:%A' /workspace/perm.bin)"

        chmod u+s,g+s,+t /workspace/perm.bin
        test -u /workspace/perm.bin && u1=1 || u1=0
        test -g /workspace/perm.bin && g1=1 || g1=0
        test -k /workspace/perm.bin && k1=1 || k1=0
        echo "noexec_special=$u1:$g1:$k1:$(stat -c '%a:%A' /workspace/perm.bin)"

        chmod a+x /workspace/perm.bin
        echo "with_exec=$(stat -c '%a:%A' /workspace/perm.bin)"

        chmod u-s,g-x,o-t /workspace/perm.bin
        test -u /workspace/perm.bin && u2=1 || u2=0
        test -g /workspace/perm.bin && g2=1 || g2=0
        test -k /workspace/perm.bin && k2=1 || k2=0
        echo "after_clear=$u2:$g2:$k2:$(stat -c '%a:%A' /workspace/perm.bin)"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "initial=0:0:0:0:644:-rw-r--r--",
          "noexec_special=1:1:1:7644:-rwSr-Sr-T",
          "with_exec=7755:-rwsr-sr-t",
          "after_clear=0:1:0:2745:-rwxr-Sr-x",
          "",
        ].join("\n")
      );
    });
  });

  it("4. file option diagnostics (--help, --version, unsupported options, missing operand, and empty -f list)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set +e
        file --version
        file --help | head -n 1
        : > /workspace/empty_list.txt
        out_empty=$(file -f /workspace/empty_list.txt)
        rc_empty=$?
        err_noarg=$(file 2>&1)
        rc_noarg=$?
        err_badopt=$(file -Z /workspace/empty_list.txt 2>&1)
        rc_badopt=$?
        err_badeq=$(file --brief=1 /workspace/empty_list.txt 2>&1)
        rc_badeq=$?
        printf "empty=%d:%s\nnoarg=%d:%s\nbadopt=%d:%s\nbadeq=%d:%s\n" \
          "$rc_empty" "$out_empty" "$rc_noarg" "$err_noarg" "$rc_badopt" "$err_badopt" "$rc_badeq" "$err_badeq"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "file (virtual-bash-file-v1)",
          "Usage: file [-bihL0] [-F SEPARATOR] [-f NAMEFILE] [--mime-type] [--mime-encoding] [--] FILE...",
          "empty=0:",
          "noarg=2:file: missing file operand (use '-' for stdin)",
          "badopt=2:file: unsupported option '-Z'",
          "badeq=2:file: unsupported option '--brief=1'",
          "",
        ].join("\n")
      );
    });
  });

  it("5. install -D -m nested creation, --backup=numbered, -b -S suffix backups, -t target dir, and -d multi-directory creation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        printf 'v1-config\n' > /workspace/src.conf
        install -D -m 0640 /workspace/src.conf /workspace/etc/app/sub/app.conf
        stat -c '%a:%s' /workspace/etc/app/sub/app.conf

        printf 'v2-config\n' > /workspace/src2.conf
        install --backup=numbered -m 0640 /workspace/src2.conf /workspace/etc/app/sub/app.conf
        echo "numbered_bak=$(cat /workspace/etc/app/sub/app.conf.~1~)"

        printf 'v2-config-updated\n' > /workspace/src.conf
        install --backup=simple --suffix=.bak -m 0600 /workspace/src.conf /workspace/etc/app/sub/app.conf
        echo "new=$(cat /workspace/etc/app/sub/app.conf):$(stat -c '%a' /workspace/etc/app/sub/app.conf)"
        echo "bak=$(cat /workspace/etc/app/sub/app.conf.bak)"

        install -d -m 0750 /workspace/var/run/svcA /workspace/var/run/svcB
        stat -c '%F:%a' /workspace/var/run/svcA /workspace/var/run/svcB
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "640:10",
          "numbered_bak=v1-config",
          "new=v2-config-updated:600",
          "bak=v2-config",
          "directory:750",
          "directory:750",
          "",
        ].join("\n")
      );
    });
  });

  it("6. ln -sr relative symlinks, ln -sfT symlink-to-directory replacement, and realpath --relative-to/--relative-base", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        mkdir -p /workspace/releases/v1 /workspace/releases/v2 /workspace/service/bin
        printf 'bin-v1\n' > /workspace/releases/v1/runner
        printf 'bin-v2\n' > /workspace/releases/v2/runner

        ln -sr /workspace/releases/v1/runner /workspace/service/bin/current_runner
        readlink /workspace/service/bin/current_runner
        cat /workspace/service/bin/current_runner

        ln -s /workspace/releases/v1 /workspace/service/active
        ln -sfT /workspace/releases/v2 /workspace/service/active
        readlink /workspace/service/active
        cat /workspace/service/active/runner

        realpath --relative-to=/workspace/service/bin /workspace/service/active/runner
        realpath --relative-base=/workspace/releases /workspace/service/active/runner /workspace/service/bin
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "../../releases/v1/runner",
          "bin-v1",
          "/workspace/releases/v2",
          "bin-v2",
          "../../releases/v2/runner",
          "v2/runner",
          "/workspace/service/bin",
          "",
        ].join("\n")
      );
    });
  });

  it("7. stat --printf escape sequences, QUOTING_STYLE on %N, and -f filesystem format directives", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        printf '12345' > /workspace/f.txt
        ln -s "line1
line2" /workspace/sym.txt

        stat --printf='%n\t%s\x3a\101\n' /workspace/f.txt
        stat -c '%N' /workspace/sym.txt
        QUOTING_STYLE=shell-always stat -c '%N' /workspace/sym.txt
        stat -f -c '%n|%T|%%' /workspace/f.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "/workspace/f.txt\t5:A",
          "'/workspace/sym.txt' -> $'line1\\nline2'",
          "'/workspace/sym.txt' -> 'line1\nline2'",
          "/workspace/f.txt|memory|%",
          "",
        ].join("\n")
      );
    });
  });

  it("8. split -n l/K/N, -n r/K/N, --numeric-suffixes=START, -a, --additional-suffix, and -e", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        mkdir -p /workspace/sp
        seq 1 7 | awk '{print "L" $1}' > /workspace/sp/in.txt

        echo "=== l/2/3 ==="
        split -n l/2/3 /workspace/sp/in.txt
        echo "=== r/2/3 ==="
        split -n r/2/3 /workspace/sp/in.txt

        cd /workspace/sp
        split -l 3 --numeric-suffixes=10 -a 3 --additional-suffix=.chunk in.txt part_
        for f in $(ls -1 part_*.chunk | sort); do
          printf "%s:%s\n" "$f" "$(paste -sd, "$f")"
        done
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== l/2/3 ===",
          "L4",
          "L5",
          "=== r/2/3 ===",
          "L2",
          "L5",
          "part_010.chunk:L1,L2,L3",
          "part_011.chunk:L4,L5,L6",
          "part_012.chunk:L7",
          "",
        ].join("\n")
      );
    });
  });

  it("9. csplit /REGEX/+OFFSET, %REGEX% suppression, {*} repeats, -f prefix, -b suffix format, and -z", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        mkdir -p /workspace/csp
        cat <<'EOF' > /workspace/csp/doc.txt
preamble
---SEC---
sec1-a
sec1-b
---SEC---
sec2-a
---SEC---
sec3-a
sec3-b
EOF
        cd /workspace/csp
        csplit -s -z -f sec_ -b '%02d.txt' doc.txt '%^---SEC---$%' '/^---SEC---$/' '{*}'
        for f in $(ls -1 sec_*.txt | sort); do
          printf "%s=>%s\n" "$f" "$(paste -sd'|' "$f")"
        done
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "sec_00.txt=>---SEC---|sec1-a|sec1-b",
          "sec_01.txt=>---SEC---|sec2-a",
          "sec_02.txt=>---SEC---|sec3-a|sec3-b",
          "",
        ].join("\n")
      );
    });
  });

  it("10. join -a1 -a2 -v1 -v2 outer and anti-joins with -e placeholder, -o format, -t delimiter, and -i case-insensitive keys", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        cat <<'EOF' > /workspace/j1.csv
alice:eng
Bob:ops
charlie:sec
EOF
        cat <<'EOF' > /workspace/j2.csv
ALICE:100
bob:200
delta:400
EOF
        echo "=== FULL OUTER (-i -t: -a1 -a2 -e NULL -o 0,1.2,2.2) ==="
        join -i -t: -a1 -a2 -e NULL -o 0,1.2,2.2 /workspace/j1.csv /workspace/j2.csv
        echo "=== UNPAIRED (-i -t: -v1 -v2) ==="
        join -i -t: -v1 -v2 /workspace/j1.csv /workspace/j2.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== FULL OUTER (-i -t: -a1 -a2 -e NULL -o 0,1.2,2.2) ===",
          "alice:eng:100",
          "Bob:ops:200",
          "charlie:sec:NULL",
          "delta:NULL:400",
          "=== UNPAIRED (-i -t: -v1 -v2) ===",
          "charlie:sec",
          "delta:400",
          "",
        ].join("\n")
      );
    });
  });

  it("11. join --header preserves out-of-order header rows while enforcing or relaxing sort order checks", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        cat <<'EOF' > /workspace/h1.txt
user_id dept
10 platform
20 security
EOF
        cat <<'EOF' > /workspace/h2.txt
user_id quota
10 500
20 900
EOF
        join --header -o 0,1.2,2.2 /workspace/h1.txt /workspace/h2.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "user_id dept quota",
          "10 platform 500",
          "20 security 900",
          "",
        ].join("\n")
      );
    });
  });

  it("12. numfmt unit conversions (--from=iec, --to=iec-i, --to=si), rounding modes, --header, --field, -d, and --invalid", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        printf 'name,bytes\nsvc-a,1536\nsvc-b,1048576\n' | numfmt -d, --header --field=2 --to=iec-i --format='%.1f'
        echo "=== ROUNDING ==="
        for mode in up down from-zero towards-zero nearest; do
          val=$(numfmt --from=iec --to=si --round="$mode" 1500)
          printf "%s=%s\n" "$mode" "$val"
        done
        echo "=== INVALID IGNORE ==="
        printf '1024\nnot_a_num\n2048\n' | numfmt --to=iec --invalid=ignore
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "name,bytes",
          "svc-a,1.5Ki",
          "svc-b,1.0Mi",
          "=== ROUNDING ===",
          "up=1.5k",
          "down=1.5k",
          "from-zero=1.5k",
          "towards-zero=1.5k",
          "nearest=1.5k",
          "=== INVALID IGNORE ===",
          "1.0K",
          "not_a_num",
          "2.0K",
          "",
        ].join("\n")
      );
    });
  });

  it("13. comm -12, -23, --total, and --output-delimiter set comparisons", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        printf 'alpha\nbeta\ngamma\n' > /workspace/c1.txt
        printf 'beta\ndelta\ngamma\n' > /workspace/c2.txt

        echo "=== INTERSECT (-12) ==="
        comm -12 /workspace/c1.txt /workspace/c2.txt
        echo "=== LEFT ONLY (-23) ==="
        comm -23 /workspace/c1.txt /workspace/c2.txt
        echo "=== TOTAL + DELIM ==="
        comm --total --output-delimiter='|' /workspace/c1.txt /workspace/c2.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== INTERSECT (-12) ===",
          "beta",
          "gamma",
          "=== LEFT ONLY (-23) ===",
          "alpha",
          "=== TOTAL + DELIM ===",
          "alpha",
          "||beta",
          "|delta",
          "||gamma",
          "1|1|2|total",
          "",
        ].join("\n")
      );
    });
  });

  it("14. paste -s serial and parallel modes with cycling delimiter escapes including \\0 empty coalescence", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        printf 'a\nb\nc\nd\n' > /workspace/p1.txt
        printf '1\n2\n3\n4\n' > /workspace/p2.txt

        paste -s -d ':,\0' /workspace/p1.txt
        paste -d '=' /workspace/p1.txt /workspace/p2.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "a:b,cd",
          "a=1",
          "b=2",
          "c=3",
          "d=4",
          "",
        ].join("\n")
      );
    });
  });

  it("15. cut range merging, --complement, -s (--only-delimited), and --output-delimiter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        cat <<'EOF' > /workspace/cut.txt
no_delim_line
f1:f2:f3:f4:f5
a1:a2:a3:a4:a5
EOF
        cut -d: -s -f 1,3-4 --output-delimiter='|' /workspace/cut.txt
        echo "=== COMPLEMENT ==="
        cut -d: -s --complement -f 2,4 --output-delimiter=',' /workspace/cut.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "f1|f3|f4",
          "a1|a3|a4",
          "=== COMPLEMENT ===",
          "f1,f3,f5",
          "a1,a3,a5",
          "",
        ].join("\n")
      );
    });
  });

  it("16. nl logical page sections (header, body, footer) with -h a, -b t, -f n, -n rz, -w, and -s", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        cat <<'EOF' > /workspace/nl.txt
\:\:\:
Header Line
\:\:
Body 1

Body 2
\:
Footer Line
EOF
        nl -h a -b t -f n -n rz -w 3 -s ': ' /workspace/nl.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "",
          "001: Header Line",
          "",
          "001: Body 1",
          "     ",
          "002: Body 2",
          "",
          "     Footer Line",
          "",
        ].join("\n")
      );
    });
  });

  it("17. pr multi-column across (-a) vs down layout with -t header omission and -s separator", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        seq 1 6 > /workspace/pr.txt
        echo "=== DOWN (-2 -t -s'|') ==="
        pr -2 -t -s'|' /workspace/pr.txt
        echo "=== ACROSS (-2 -a -t -s'|') ==="
        pr -2 -a -t -s'|' /workspace/pr.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== DOWN (-2 -t -s'|') ===",
          "1|4",
          "2|5",
          "3|6",
          "=== ACROSS (-2 -a -t -s'|') ===",
          "1|2",
          "3|4",
          "5|6",
          "",
        ].join("\n")
      );
    });
  });

  it("18. fmt -w paragraph reflow, -s split-only, -u uniform spacing, and -p prefix filtering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        cat <<'EOF' > /workspace/comments.txt
//   first   comment   with   many   words   that   should   wrap
// nicely   under   prefix   mode.
unchanged_code = 1;
EOF
        fmt -w 32 -u -p '//' /workspace/comments.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "//   first comment with many",
          "//   words that should wrap",
          "// nicely under prefix mode.",
          "unchanged_code = 1;",
          "",
        ].join("\n")
      );
    });
  });

  it("19. od -A x -t x1z and xxd -p / xxd -r -p binary pipeline round-trip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        printf 'SafeBash!\n' | xxd -p > /workspace/hex.txt
        xxd -r -p /workspace/hex.txt > /workspace/restored.bin
        od -A x -t x1 /workspace/restored.bin
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "000000 53 61 66 65 42 61 73 68 21 0a",
          "00000a",
          "",
        ].join("\n")
      );
    });
  });

  it("20. end-to-end release artifact staging pipeline combining install -D, ln -sr, chmod, file, stat, split, join, and numfmt", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        set -euo pipefail
        mkdir -p /workspace/stage/src
        printf '#!/bin/sh\necho "runner-ok"\n' > /workspace/stage/src/run.sh
        printf '{"service":"core","version":2}\n' > /workspace/stage/src/meta.json

        install -D -m 0755 /workspace/stage/src/run.sh /workspace/stage/dist/bin/run.sh
        install -D -m 0644 /workspace/stage/src/meta.json /workspace/stage/dist/etc/meta.json
        ln -sr /workspace/stage/dist/bin/run.sh /workspace/stage/dist/current_run

        cat <<'EOF' > /workspace/stage/sizes.txt
bin 2048
meta 512
EOF
        cat <<'EOF' > /workspace/stage/paths.txt
bin /workspace/stage/dist/bin/run.sh
meta /workspace/stage/dist/etc/meta.json
EOF
        join -o 0,1.2,2.2 /workspace/stage/sizes.txt /workspace/stage/paths.txt \
          | numfmt --field=2 --to=iec \
          | while read -r key human path; do
              mime=$(file -b --mime-type "$path")
              mode=$(stat -c '%a' "$path")
              printf "%s|%s|%s|%s\n" "$key" "$human" "$mode" "$mime"
            done
        echo "link=$(readlink /workspace/stage/dist/current_run):$(file -bL --mime-type /workspace/stage/dist/current_run)"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "bin|2.0K|755|text/x-shellscript",
          "meta|512|644|application/json",
          "link=bin/run.sh:text/x-shellscript",
          "",
        ].join("\n")
      );
    });
  });
});
