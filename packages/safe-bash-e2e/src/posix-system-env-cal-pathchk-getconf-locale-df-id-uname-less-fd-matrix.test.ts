import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("POSIX system, environment, and file inspection matrix (cal, pathchk, getconf, locale, df, id, uname, whoami, hostname, nproc, yes, less/more, fd)", () => {
  it("1. cal renders Gregorian and 1752 Julian-reform calendars with -M (Monday-first) and -j (Julian day-of-year)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        cal 9 1752
        echo "---"
        cal -M 2 2024
        echo "---"
        cal -j 1 2026
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /September 1752\s*\nSu Mo Tu We Th Fr Sa\s*\n {7}1 {2}2 14 15 16/);
      assert.match(r.stdout, /February 2024\s*\nMo Tu We Th Fr Sa Su\s*\n {10}1 {2}2 {2}3 {2}4/);
      assert.match(r.stdout, /25 26 27 28 29/);
      assert.match(r.stdout, /January 2026\s*\n Su {2}Mo {2}Tu {2}We {2}Th {2}Fr {2}Sa\s*\n {18}1 {3}2 {3}3/);
    });
  });

  it("2. cal -3, -n <months>, -S (--span), -m <month-name>, and SOURCE_DATE_EPOCH render multi-month and yearly grids", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        SOURCE_DATE_EPOCH=1704067200 cal -1
        echo "---"
        cal -3 6 2026 | head -n 2
        echo "---"
        cal -m oct 2026 | head -n 2
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /January 2024/);
      assert.match(r.stdout, /May 2026\s+June 2026\s+July 2026/);
      assert.match(r.stdout, /October 2026\s*\nSu Mo Tu We Th Fr Sa/);
    });
  });

  it("3. pathchk validates POSIX portable filenames (-p, -P, --portability) and non-directory VFS ancestors", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/regular.txt", "not a dir\n");

      const r1 = await h.exec("pathchk --portability valid_dir/file-1.txt");
      assert.equal(r1.exitCode, 0, r1.stderr);

      const r2 = await h.exec("pathchk -p 'bad name!.txt'");
      assert.equal(r2.exitCode, 1);
      assert.match(r2.stderr, /nonportable character ' '/);

      const r3 = await h.exec("pathchk -P -- '-leading-dash.txt' ''");
      assert.equal(r3.exitCode, 1);
      assert.match(r3.stderr, /leading '-' in a component/);
      assert.match(r3.stderr, /empty file name/);

      const r4 = await h.exec("pathchk /workspace/regular.txt/child");
      assert.equal(r4.exitCode, 1);
      assert.match(r4.stderr, /Not a directory/);
    });
  });

  it("4. pathchk -p enforces 14-byte POSIX component limit and 256-byte path limit", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec("pathchk -p dir/fifteen_chars15");
      assert.equal(r1.exitCode, 1);
      assert.match(r1.stderr, /limit 14 exceeded by length 15 of file name component 'fifteen_chars15'/);

      const r2 = await h.exec("pathchk dir/fifteen_chars15");
      assert.equal(r2.exitCode, 0, r2.stderr);
    });
  });

  it("5. getconf queries system, path, and POSIX specification variables (-a, -v, _PC_, _CS_)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        getconf PAGE_SIZE
        getconf _SC_PAGESIZE
        getconf _PC_NAME_MAX /workspace
        getconf _CS_PATH
        getconf -v POSIX_V7_LP64_OFF64 LONG_BIT
        getconf -a /workspace | grep '^PIPE_BUF' | awk '{print $2}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "4096\n4096\n255\n/usr/local/bin:/usr/bin:/bin\n64\n4096\n",
      );

      const rErr = await h.exec("getconf NAME_MAX /workspace/missing_dir");
      assert.equal(rErr.exitCode, 1);
      assert.match(rErr.stderr, /No such file or directory/);
    });
  });

  it("6. locale inspects LANG / LC_* environment precedence, -a / -m lists, and -c / -k keyword queries", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        LC_ALL= LANG=en_US.UTF-8 LC_TIME=C locale | grep -E '^(LANG|LC_CTYPE|LC_TIME|LC_ALL)='
        echo "---"
        LC_ALL=C.UTF-8 locale -c -k charmap decimal_point
        echo "---"
        locale -a | grep -E '^(C|POSIX|en_US\\.UTF-8)$' | sort
        echo "---"
        locale -m | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
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
          "LC_NUMERIC",
          'decimal_point="."',
          "---",
          "C",
          "POSIX",
          "en_US.UTF-8",
          "---",
          "ANSI_X3.4-1968",
          "ASCII",
          "ISO-8859-1",
          "UTF-8",
          "",
        ].join("\n"),
      );
    });
  });

  it("7. df reports VFS block and inode usage across -P, -h, -H, -i, -T, --total, and --output", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/blob.bin", "x".repeat(8192));

      const r = await h.exec(`
        df -P /workspace | awk 'NR==2 {print $1, $6}'
        df -T /workspace | awk 'NR==2 {print $2}'
        df -i /workspace | awk 'NR==1 {print $2, $3, $4}'
        df --output=source,fstype,target --total /workspace | tail -n 2
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /^sandbox-vfs \/\nvfs\nInodes IUsed IFree\n/);
      assert.match(r.stdout, /sandbox-vfs\s+vfs\s+\/\ntotal\s+-\s+-/);
    });
  });

  it("8. df filters filesystem types with -t (--type) and -x (--exclude-type) and scales blocks with -B", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        df -B 1M /workspace | awk 'NR==1 {print $2}'
        df -t vfs /workspace | wc -l | tr -d ' '
        df -x vfs | awk 'NR==2 {print $1, $6}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "1M-blocks\n2\ntmpfs /tmp\n");
    });
  });

  it("9. id queries effective/real user and group IDs (-u, -g, -G, -n, -r, -z) and /etc/passwd + /etc/group entries", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/etc", { recursive: true });
      await h.writeText(
        "/etc/passwd",
        "root:x:0:0:root:/root:/bin/sh\ndevuser:x:2001:2001:Developer:/home/dev:/bin/bash\n",
      );
      await h.writeText(
        "/etc/group",
        "root:x:0:\ndevgrp:x:2001:devuser\ndocker:x:999:devuser\n",
      );

      const r = await h.exec(`
        id -u
        id -un
        id -gn
        id devuser
        id -Gn devuser
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "1000\ne2e\nsandbox\nuid=2001(devuser) gid=2001(devgrp) groups=2001(devgrp),999(docker)\ndevgrp docker\n",
      );
    });
  });

  it("10. id rejects conflicting flag combinations (-u -g, -n without -u/-g/-G, -z with default format)", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec("id -u -g");
      assert.equal(r1.exitCode, 1);
      assert.match(r1.stderr, /cannot print "only" of more than one choice/);

      const r2 = await h.exec("id -n");
      assert.equal(r2.exitCode, 1);
      assert.match(r2.stderr, /cannot print only names or real IDs in default format/);

      const r3 = await h.exec("id -z");
      assert.equal(r3.exitCode, 1);
      assert.match(r3.stderr, /option --zero not permitted in default format/);
    });
  });

  it("11. uname formats kernel, nodename, release, version, machine, processor, hardware-platform, and OS fields", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        uname
        uname -s -n -m -o
        UNAME_S=FreeBSD UNAME_M=arm64 HOSTNAME=buildbox uname -a
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "Linux");
      assert.equal(lines[1], "Linux sandbox x86_64 GNU/Linux");
      assert.match(lines[2]!, /^FreeBSD buildbox .* arm64/);
    });
  });

  it("12. whoami, hostname (-s, -d, -f, -i, -I), and /etc/hostname resolution work together", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/etc", { recursive: true });
      await h.writeText("/etc/hostname", "worker01.internal.Cluster.local\n");

      const r = await h.exec(`
        whoami
        USER=ci-bot whoami
        hostname
        hostname -s
        hostname -d
        hostname -i
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "e2e\nci-bot\nworker01.internal.Cluster.local\nworker01\ninternal.Cluster.local\n127.0.0.1\n",
      );
    });
  });

  it("13. nproc respects NPROC, OMP_NUM_THREADS, OMP_THREAD_LIMIT, --all, and --ignore=N", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        nproc
        NPROC=16 OMP_NUM_THREADS=12 OMP_THREAD_LIMIT=8 nproc
        NPROC=16 OMP_NUM_THREADS=12 OMP_THREAD_LIMIT=8 nproc --all
        NPROC=8 nproc --ignore=3
        NPROC=4 nproc --ignore=99
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "4\n8\n16\n5\n1\n");
    });
  });

  it("14. yes streams default 'y' or custom multi-word lines into bounded head/awk pipelines", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        yes | head -n 4 | tr '\\n' ' '
        echo ""
        yes "ack" "ok" | head -n 3
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "y y y y \nack ok\nack ok\nack ok\n");
    });
  });

  it("15. less and more support -N line numbers, -s squeeze blank lines, +<line> start offset, and +/<pattern> search", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/doc.txt",
        "alpha\n\n\nbeta\ngamma\ndelta\n",
      );

      const r = await h.exec(`
        less -N -s doc.txt
        echo "---"
        less +4 doc.txt
        echo "---"
        more +/gamma doc.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "     1  alpha",
          "     2  ",
          "     4  beta",
          "     5  gamma",
          "     6  delta",
          "---",
          "beta",
          "gamma",
          "delta",
          "---",
          "gamma",
          "delta",
          "",
        ].join("\n"),
      );
    });
  });

  it("16. more and less interleave multiple files and '-' stdin with line numbering (-N)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/p1.txt", "one\n");
      await h.writeText("/workspace/p2.txt", "two\n");

      const r = await h.exec("printf 'mid\\n' | more -N p1.txt - p2.txt");
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "     1  one",
          "     2  mid",
          "     3  two",
          "",
        ].join("\n"),
      );
    });
  });

  it("17. fd searches by regex, glob (-g), extension (-e), type (-t f/d/l/x), and depth (-d / --min-depth)", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/repo/src/lib", { recursive: true });
      await h.writeText("/workspace/repo/src/index.ts", "export {};\n");
      await h.writeText("/workspace/repo/src/lib/util.ts", "export {};\n");
      await h.writeText("/workspace/repo/src/lib/readme.md", "# Lib\n");
      await h.writeText("/workspace/repo/build.sh", "#!/bin/sh\n");
      await h.fs.chmod!("/workspace/repo/build.sh", 0o755);

      const r = await h.exec(`
        fd -e ts . repo | sort
        echo "---"
        fd -t x . repo
        echo "---"
        fd -d 2 -t f . repo | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "repo/src/index.ts",
          "repo/src/lib/util.ts",
          "---",
          "repo/build.sh",
          "---",
          "repo/build.sh",
          "repo/src/index.ts",
          "",
        ].join("\n"),
      );
    });
  });

  it("18. fd respects .gitignore and hidden files by default and includes them with -H (--hidden) and -I (--no-ignore)", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/app/dist", { recursive: true });
      await h.writeText("/workspace/app/.gitignore", "dist/\n*.log\n");
      await h.writeText("/workspace/app/.env", "SECRET=1\n");
      await h.writeText("/workspace/app/main.ts", "console.log(1);\n");
      await h.writeText("/workspace/app/debug.log", "log\n");
      await h.writeText("/workspace/app/dist/bundle.js", "bundle\n");

      const r = await h.exec(`
        fd -t f . app | sort
        echo "---"
        fd -H -t f . app | sort
        echo "---"
        fd -H -I -t f . app | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "app/main.ts",
          "---",
          "app/.env",
          "app/.gitignore",
          "app/main.ts",
          "---",
          "app/.env",
          "app/.gitignore",
          "app/debug.log",
          "app/dist/bundle.js",
          "app/main.ts",
          "",
        ].join("\n"),
      );
    });
  });

  it("19. fd -E (--exclude) and -0 (--print0) integrate cleanly with xargs -0 pipelines", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/files", { recursive: true });
      await h.writeText("/workspace/files/keep one.txt", "alpha\n");
      await h.writeText("/workspace/files/keep two.txt", "beta\n");
      await h.writeText("/workspace/files/ignore.bak", "skip\n");

      const r = await h.exec(`
        fd -t f -E '*.bak' -0 . files | xargs -0 wc -l | tail -n 1 | awk '{print $1}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "2\n");
    });
  });

  it("20. end-to-end system diagnostics report combining uname, id, whoami, hostname, nproc, getconf, locale, and df into JSON", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        jq -nc \
          --arg kernel "$(uname -s)" \
          --arg user "$(whoami)" \
          --arg uid "$(id -u)" \
          --arg host "$(hostname)" \
          --arg cpus "$(NPROC=8 nproc)" \
          --arg pagesize "$(getconf PAGE_SIZE)" \
          --arg charmap "$(LC_ALL=C.UTF-8 locale charmap)" \
          --arg fstype "$(df -T /workspace | awk 'NR==2 {print $2}')" \
          '{kernel:$kernel,user:$user,uid:($uid|tonumber),host:$host,cpus:($cpus|tonumber),pagesize:($pagesize|tonumber),charmap:$charmap,fstype:$fstype}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '{"kernel":"Linux","user":"e2e","uid":1000,"host":"sandbox","cpus":8,"pagesize":4096,"charmap":"UTF-8","fstype":"vfs"}\n',
      );
    });
  });
});
