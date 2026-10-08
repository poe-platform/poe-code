import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure df, cal, ncal, whoami, egrep, fgrep, rgrep, less, more, and system inspection parity matrix", () => {
  it("1. df reports VFS mount usage for / and /tmp without double-counting nested mounts and formats right-aligned columns", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '%1024s' '' > /root.bin
        printf '%2048s' '' > /tmp/scratch.bin
        df -k --output=source,fstype,used,iused,target / /tmp --total
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stderr, "");
      const rows = r.stdout
        .trim()
        .split("\n")
        .map((line) => line.trim().split(/\s+/));
      assert.equal(rows[0]![0], "Filesystem");
      assert.equal(rows[0]![1], "Type");
      assert.equal(rows[0]![2], "Used");
      assert.equal(rows[0]![3], "IUsed");
      assert.equal(rows[1]![0], "sandbox-vfs");
      assert.equal(rows[1]![1], "vfs");
      assert.equal(rows[2]![0], "tmpfs");
      assert.equal(rows[2]![1], "tmpfs");
      assert.equal(rows[2]![2], "6");
      assert.equal(rows[2]![3], "2");
      assert.equal(rows[3]![0], "total");
      assert.equal(rows[3]![1], "-");
      assert.equal(
        Number(rows[3]![2]),
        Number(rows[1]![2]) + Number(rows[2]![2])
      );
      assert.equal(
        Number(rows[3]![3]),
        Number(rows[1]![3]) + Number(rows[2]![3])
      );
    });
  });

  it("2. df -a/--all includes pseudo-filesystem proc with '-' percentage, and -t/-x filter or reject conflicting types", async () => {
    await withE2EHarness(async (h) => {
      const rAll = await h.exec(`df -a --output=source,fstype,size,used,avail,pcent,target`);
      assert.equal(rAll.exitCode, 0);
      const rowsAll = rAll.stdout
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => line.trim().split(/\s+/));
      assert.deepEqual(rowsAll.map((r) => [r[0], r[1], r[5], r[6]]), [
        ["sandbox-vfs", "vfs", "1%", "/"],
        ["tmpfs", "tmpfs", "1%", "/tmp"],
        ["proc", "proc", "-", "/proc"],
      ]);

      const rFilt = await h.exec(`df -a -x proc -x vfs --output=source,fstype,target`);
      assert.equal(rFilt.exitCode, 0);
      const rowsFilt = rFilt.stdout
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => line.trim().split(/\s+/));
      assert.deepEqual(rowsFilt, [["tmpfs", "tmpfs", "/tmp"]]);

      const rConflict = await h.exec(`df -t tmpfs -x tmpfs`);
      assert.equal(rConflict.exitCode, 1);
      assert.equal(rConflict.stdout, "");
      assert.equal(
        rConflict.stderr,
        "df: file system type 'tmpfs' both selected and excluded\n"
      );

      const rEmpty = await h.exec(`df -t ext4`);
      assert.equal(rEmpty.exitCode, 1);
      assert.equal(rEmpty.stdout, "");
      assert.equal(rEmpty.stderr, "df: no file systems processed\n");
    });
  });

  it("3. df supports -h (1024), -H/--si (1000), -k, -m, -B/--block-size, and POSIXLY_CORRECT / DF_BLOCK_SIZE / BLOCK_SIZE", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        df -h /tmp | head -n 2
        echo "---"
        df -H /tmp | head -n 2
        echo "---"
        df -m /tmp | head -n 2
        echo "---"
        df -B 4K /tmp | head -n 2
        echo "---"
        POSIXLY_CORRECT=1 df /tmp | head -n 2
        echo "---"
        DF_BLOCK_SIZE=1M df /tmp | head -n 2
      `);
      assert.equal(r.exitCode, 0);
      const sections = r.stdout.trim().split("\n---\n");
      assert.match(sections[0]!, /Filesystem\s+Size\s+Used\s+Avail\s+Use%\s+Mounted on\ntmpfs\s+256M\s+/);
      assert.match(sections[1]!, /Filesystem\s+Size\s+Used\s+Avail\s+Use%\s+Mounted on\ntmpfs\s+269M\s+/);
      assert.match(sections[2]!, /Filesystem\s+1M-blocks\s+Used\s+Avail\s+Use%\s+Mounted on\ntmpfs\s+256\s+/);
      assert.match(sections[3]!, /Filesystem\s+4K-blocks\s+Used\s+Avail\s+Use%\s+Mounted on\ntmpfs\s+65536\s+/);
      assert.match(sections[4]!, /Filesystem\s+512-blocks\s+Used\s+Avail\s+Use%\s+Mounted on\ntmpfs\s+524288\s+/);
      assert.match(sections[5]!, /Filesystem\s+1M-blocks\s+Used\s+Avail\s+Use%\s+Mounted on\ntmpfs\s+256\s+/);
    });
  });

  it("4. df supports -P portability headers, -T print-type, and -i/-iT inode listings", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        df -P /tmp
        echo "---"
        df -PT /tmp
        echo "---"
        df -iT /tmp
      `);
      assert.equal(r.exitCode, 0);
      const sections = r.stdout.trim().split("\n---\n");
      assert.match(
        sections[0]!,
        /^Filesystem\s+1024-blocks\s+Used\s+Available\s+Capacity\s+Mounted on\ntmpfs\s+262144\s+/
      );
      assert.match(
        sections[1]!,
        /^Filesystem\s+Type\s+1024-blocks\s+Used\s+Available\s+Capacity\s+Mounted on\ntmpfs\s+tmpfs\s+262144\s+/
      );
      assert.match(
        sections[2]!,
        /^Filesystem\s+Type\s+Inodes\s+IUsed\s+IFree\s+IUse%\s+Mounted on\ntmpfs\s+tmpfs\s+262144\s+/
      );
    });
  });

  it("5. df --output supports default 12-column list and custom field lists and rejects mutually exclusive -i/-T/-P flags", async () => {
    await withE2EHarness(async (h) => {
      const rDefault = await h.exec(`df --output /tmp`);
      assert.equal(rDefault.exitCode, 0);
      const headerCols = rDefault.stdout.trim().split("\n")[0]!.trim().split(/\s+/);
      assert.deepEqual(headerCols, [
        "Filesystem",
        "Type",
        "Inodes",
        "IUsed",
        "IFree",
        "IUse%",
        "1K-blocks",
        "Used",
        "Avail",
        "Use%",
        "File",
        "Mounted",
        "on",
      ]);

      const rMut = await h.exec(`df --output=source -i`);
      assert.equal(rMut.exitCode, 1);
      assert.equal(
        rMut.stderr,
        "df: options -i, -T, and -P are mutually exclusive with --output\n"
      );

      const rBad = await h.exec(`df --output=source,bogus`);
      assert.equal(rBad.exitCode, 1);
      assert.equal(
        rBad.stderr,
        "df: 'bogus': Crit: invalid field name for --output\n"
      );
    });
  });

  it("6. df resolves path operands to their deepest mount, preserves file operand column, and reports missing operands", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /tmp/sub /var/log
        touch /tmp/sub/a.txt /var/log/b.txt
        df --output=file,source,fstype,target /tmp/sub/a.txt /missing/file /var/log/b.txt /proc
      `);
      assert.equal(r.exitCode, 1);
      assert.equal(r.stderr, "df: '/missing/file': No such file or directory\n");
      const rows = r.stdout
        .trim()
        .split("\n")
        .slice(1)
        .map((l) => l.trim().split(/\s+/));
      assert.deepEqual(rows, [
        ["/tmp/sub/a.txt", "tmpfs", "tmpfs", "/tmp"],
        ["/var/log/b.txt", "sandbox-vfs", "vfs", "/"],
        ["/proc", "proc", "proc", "/proc"],
      ]);
    });
  });

  it("7. ncal defaults to vertical Monday-first layout, cal -N switches to vertical layout, and ncal -b/-C switch to horizontal layout", async () => {
    await withE2EHarness(async (h) => {
      const rNcal = await h.exec(`ncal 5 2024`);
      assert.equal(rNcal.exitCode, 0);
      assert.equal(
        rNcal.stdout,
        [
          "      May 2024        ",
          "Mo     6 13 20 27   ",
          "Tu     7 14 21 28   ",
          "We  1  8 15 22 29   ",
          "Th  2  9 16 23 30   ",
          "Fr  3 10 17 24 31   ",
          "Sa  4 11 18 25      ",
          "Su  5 12 19 26      ",
          "",
        ].join("\n")
      );

      const rCalN = await h.exec(`cal -N 5 2024`);
      assert.equal(rCalN.exitCode, 0);
      assert.equal(rCalN.stdout, rNcal.stdout);

      const rCal = await h.exec(`cal 5 2024`);
      const rNcalB = await h.exec(`ncal -b 5 2024`);
      const rNcalC = await h.exec(`ncal -C 5 2024`);
      assert.equal(rNcalB.stdout, rCal.stdout);
      assert.equal(rNcalC.stdout, rCal.stdout);
    });
  });

  it("8. ncal -w and cal -N -w render ISO week numbers and ncal -S switches vertical layout to Sunday-first", async () => {
    await withE2EHarness(async (h) => {
      const rWeeks = await h.exec(`ncal -w 5 2024`);
      assert.equal(rWeeks.exitCode, 0);
      assert.equal(
        rWeeks.stdout,
        [
          "      May 2024        ",
          "Mo     6 13 20 27   ",
          "Tu     7 14 21 28   ",
          "We  1  8 15 22 29   ",
          "Th  2  9 16 23 30   ",
          "Fr  3 10 17 24 31   ",
          "Sa  4 11 18 25      ",
          "Su  5 12 19 26      ",
          "   18 19 20 21 22   ",
          "",
        ].join("\n")
      );

      const rSun = await h.exec(`ncal -S -w 5 2024`);
      assert.equal(rSun.exitCode, 0);
      assert.equal(
        rSun.stdout,
        [
          "      May 2024        ",
          "Su     5 12 19 26   ",
          "Mo     6 13 20 27   ",
          "Tu     7 14 21 28   ",
          "We  1  8 15 22 29   ",
          "Th  2  9 16 23 30   ",
          "Fr  3 10 17 24 31   ",
          "Sa  4 11 18 25      ",
          "   18 19 20 21 22   ",
          "",
        ].join("\n")
      );
    });
  });

  it("9. cal and ncal handle the September 1752 Julian-to-Gregorian reform and reject skipped reform dates", async () => {
    await withE2EHarness(async (h) => {
      const rCal = await h.exec(`cal 9 1752`);
      assert.equal(rCal.exitCode, 0);
      assert.equal(
        rCal.stdout,
        [
          "   September 1752     ",
          "Su Mo Tu We Th Fr Sa  ",
          "       1  2 14 15 16  ",
          "17 18 19 20 21 22 23  ",
          "24 25 26 27 28 29 30  ",
          "                      ",
          "                      ",
          "                      ",
          "",
        ].join("\n")
      );

      const rJul = await h.exec(`cal -j 9 1752`);
      assert.equal(rJul.exitCode, 0);
      assert.match(rJul.stdout, /245 246 247 248 249/);

      const rNcal = await h.exec(`ncal 9 1752`);
      assert.equal(rNcal.exitCode, 0);
      assert.equal(
        rNcal.stdout,
        [
          "   September 1752     ",
          "Mo    18 25         ",
          "Tu  1 19 26         ",
          "We  2 20 27         ",
          "Th 14 21 28         ",
          "Fr 15 22 29         ",
          "Sa 16 23 30         ",
          "Su 17 24            ",
          "",
        ].join("\n")
      );

      const rBad = await h.exec(`cal 5 9 1752`);
      assert.equal(rBad.exitCode, 1);
      assert.equal(rBad.stderr, "cal: invalid date arguments\n");
    });
  });

  it("10. cal and ncal support -3, -A, -B, -n/--months, -S/--span, and -d/--date multi-month spans", async () => {
    await withE2EHarness(async (h) => {
      const rSpan = await h.exec(`cal -A 1 -B 1 -d 2024-05`);
      const rThree = await h.exec(`cal -3 5 2024`);
      assert.equal(rSpan.exitCode, 0);
      assert.equal(rSpan.stdout, rThree.stdout);

      const rNcal3 = await h.exec(`ncal -3 5 2024`);
      assert.equal(rNcal3.exitCode, 0);
      const lines = rNcal3.stdout.trimEnd().split("\n");
      assert.equal(lines.length, 8);
      assert.match(lines[0]!, /April 2024.*May 2024.*June 2024/);
      assert.match(lines[1]!, /^Mo /);
    });
  });

  it("11. whoami resolves EUID/UID from /etc/passwd, built-in numeric IDs, and WHOAMI/USER/LOGNAME env vars and rejects invalid args", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(`
        mkdir -p /etc
        cat <<'EOF' > /etc/passwd
root:x:0:0:root:/root:/bin/bash
alice:x:1042:1042:Alice:/home/alice:/bin/sh
EOF
        EUID=1042 whoami
        UID=0 whoami
        EUID=65534 whoami
        EUID=9999 WHOAMI=custom_who USER=fallback_user whoami
        unset EUID UID WHOAMI
        USER=bob whoami
        unset USER
        LOGNAME=charlie whoami
        unset LOGNAME
        whoami
      `);
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        "alice\nroot\nnobody\ncustom_who\nbob\ncharlie\nsandbox\n"
      );

      const rExtra = await h.exec(`whoami extra`);
      assert.equal(rExtra.exitCode, 1);
      assert.equal(rExtra.stderr, "whoami: extra operand 'extra'\n");

      const rOpt = await h.exec(`whoami --bogus`);
      assert.equal(rOpt.exitCode, 1);
      assert.equal(rOpt.stderr, "whoami: unrecognized option '--bogus'\n");
    });
  });

  it("12. egrep, fgrep, and rgrep default to -E, -F, and -r, reject conflicting matchers with exit 2, and honor --no-ignore-case", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        cat <<'EOF' > /tmp/pat.txt
a+b
aab
AAB
(a|b)
EOF
        echo "=== egrep default ==="
        egrep -E 'a+b' /tmp/pat.txt
        echo "=== fgrep default ==="
        fgrep -F 'a+b' /tmp/pat.txt
        echo "=== ignore-case vs no-ignore-case ==="
        egrep -i 'a+b' /tmp/pat.txt
        egrep -i --no-ignore-case 'a+b' /tmp/pat.txt
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== egrep default ===",
          "aab",
          "=== fgrep default ===",
          "a+b",
          "=== ignore-case vs no-ignore-case ===",
          "aab",
          "AAB",
          "aab",
          "",
        ].join("\n")
      );

      for (const cmd of ["egrep -F a /tmp/pat.txt", "fgrep -E a /tmp/pat.txt", "grep -E -F a /tmp/pat.txt"]) {
        const rc = await h.exec(cmd);
        assert.equal(rc.exitCode, 2);
        assert.match(rc.stderr, /conflicting matchers specified/);
      }
    });
  });

  it("13. rgrep recursively searches directories honoring --include, --exclude, --exclude-dir, -n, and -l", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /tmp/rgp/src /tmp/rgp/vendor
        printf 'match_one\nskip\n' > /tmp/rgp/src/a.ts
        printf 'match_two\n' > /tmp/rgp/src/b.md
        printf 'match_three\n' > /tmp/rgp/vendor/c.ts
        rgrep -n --include='*.ts' --exclude-dir=vendor 'match_' /tmp/rgp
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "/tmp/rgp/src/a.ts:1:match_one\n");
    });
  });

  it("14. less and more support -N, -n, -s, +LINE, +/PATTERN, -p PATTERN, and -i case-insensitive search start", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        cat <<'EOF' > /tmp/pager.txt
first

second
TARGET_LINE


after_target
last
EOF
        less -Ns +/target_line -i /tmp/pager.txt
        echo "---"
        more -N -n +3 -s /tmp/pager.txt
        echo "---"
        less -N -p TARGET /tmp/pager.txt
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "     4  TARGET_LINE",
          "     5  ",
          "     7  after_target",
          "     8  last",
          "---",
          "second",
          "TARGET_LINE",
          "",
          "after_target",
          "last",
          "---",
          "     4  TARGET_LINE",
          "     5  ",
          "     6  ",
          "     7  after_target",
          "     8  last",
          "",
        ].join("\n")
      );
    });
  });

  it("15. less and more preserve UTF-8 BOM, consume '-' stdin once across multiple operands, and report missing files with exit 1", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '\\xef\\xbb\\xbfbom_start\\n\\n\\nbom_end\\n' > /tmp/bom.txt
        printf 'from_stdin\\n' | less -Ns /tmp/missing_pager.txt - /tmp/bom.txt -
      `);
      assert.equal(r.exitCode, 1);
      assert.match(r.stderr, /^less: \/tmp\/missing_pager\.txt:/);
      assert.equal(
        r.stdout,
        [
          "     1  from_stdin",
          "     2  \uFEFFbom_start",
          "     3  ",
          "     5  bom_end",
          "",
        ].join("\n")
      );
    });
  });

  it("16. id resolves accounts and supplementary groups from /etc/passwd and /etc/group and supports -u/-g/-G/-n/-r/-z/-Z", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /etc
        cat <<'EOF' > /etc/passwd
root:x:0:0:root:/root:/bin/bash
dev:x:1001:1001:Developer:/home/dev:/bin/bash
EOF
        cat <<'EOF' > /etc/group
root:x:0:
dev:x:1001:
docker:x:998:dev
wheel:x:10:root,dev
EOF
        id dev
        id -Gn dev
        id -Gnz dev | tr '\\0' ':'
        echo ""
        SELINUX_CONTEXT=user_u:role_r:type_t:s0 id -Z
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "uid=1001(dev) gid=1001(dev) groups=1001(dev),998(docker),10(wheel)",
          "dev docker wheel",
          "dev:docker:wheel:",
          "user_u:role_r:type_t:s0",
          "",
        ].join("\n")
      );
    });
  });

  it("17. uname and hostname support -a/-s/-f/-d/-i/-I/-A/-y, UNAME_*/HOSTNAME env overrides, and root-only hostname mutation", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        EUID=0 hostname "app01.internal.example"
        hostname
        hostname -s
        hostname -d
        hostname -f
        hostname -i
        hostname -y
        HOSTNAME=env-node uname -snm
        UNAME_S=CustomOS UNAME_N=override-host UNAME_R=9.9.0 UNAME_V='#42' UNAME_M=arm64 UNAME_P=arm UNAME_I=virt UNAME_O=POSIX uname -a
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "app01.internal.example",
          "app01",
          "internal.example",
          "app01.internal.example",
          "127.0.0.1",
          "(none)",
          "Linux env-node x86_64",
          "CustomOS override-host 9.9.0 #42 arm64 arm virt POSIX",
          "",
        ].join("\n")
      );

      const rNonRoot = await h.exec(`EUID=1000 UID=1000 USER=user hostname forbidden-host`);
      assert.equal(rNonRoot.exitCode, 1);
      assert.equal(rNonRoot.stderr, "hostname: you must be root to change the host name\n");
    });
  });

  it("18. getconf queries system and path variables, accepts -v specification, and validates path operands", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        getconf PAGE_SIZE
        getconf -v POSIX_V7_LP64_OFF64 LONG_BIT
        getconf NAME_MAX /tmp
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "4096\n64\n255\n");

      const rMissing = await h.exec(`getconf NAME_MAX /no/such/dir`);
      assert.equal(rMissing.exitCode, 1);
      assert.match(rMissing.stderr, /^getconf: \/no\/such\/dir:/);

      const rUnk = await h.exec(`getconf NOT_A_REAL_CONF_VAR`);
      assert.equal(rUnk.exitCode, 1);
      assert.match(rUnk.stderr, /Unrecognized variable/i);
    });
  });

  it("19. locale honors LC_ALL > LC_* > LANG precedence and -k/-c category formatting, and printenv -0 emits NUL-terminated values", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        unset LC_ALL
        LANG=en_US.UTF-8 LC_TIME=C locale | grep -E '^(LANG|LC_CTYPE|LC_TIME|LC_ALL)='
        echo "---"
        LC_ALL=C.UTF-8 locale -c -k charmap
        echo "---"
        FOO=alpha BAR=beta printenv -0 FOO BAR | tr '\\0' '|'
        echo ""
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "LANG=en_US.UTF-8",
          'LC_CTYPE="en_US.UTF-8"',
          "LC_TIME=C",
          "LC_ALL=",
          "---",
          "LC_CTYPE",
          'charmap="UTF-8"',
          "---",
          "alpha|beta|",
          "",
        ].join("\n")
      );
    });
  });

  it("20. basename (-a, -s, -z), dirname (-z), pathchk (-p, -P), and nproc (--all, --ignore, OMP_NUM_THREADS, OMP_THREAD_LIMIT)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        basename -a -s .tar.gz /var/pkg/foo.tar.gz /var/pkg/bar.tar.gz /var/pkg/baz.tgz | tr '\\n' ':'
        echo ""
        dirname -z /a/b/c //foo /// | tr '\\0' ':'
        echo ""
        OMP_NUM_THREADS=12 OMP_THREAD_LIMIT=8 nproc --ignore=3
        OMP_NUM_THREADS=12 NPROC=16 nproc --all --ignore=2
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "foo:bar:baz.tgz:",
          "/a/b:/:/:",
          "5",
          "14",
          "",
        ].join("\n")
      );

      const rPath = await h.exec(`pathchk -P ""`);
      assert.equal(rPath.exitCode, 1);
      assert.match(rPath.stderr, /empty file name/);
    });
  });
});
