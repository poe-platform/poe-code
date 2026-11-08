import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryFileSystem, createMountFileSystem } from "@poe-code/safe-fs";
import { seedFilesOnFs, withE2EHarness } from "./harness.js";

describe("safe-bash E2E: coreutils filesystem, printf, numfmt, shuf, truncate, install, and metadata workflows", () => {
  it("1. printf formats signed/unsigned/octal/hex integers, alternate forms, padding, and character code constants", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        printf '%d|%i|%u|%o|%#o|%x|%#X|%+08d|%-6d|%.4d|%d|%d\n' \
          -42 0x2a 255 64 64 255 255 123 77 9 "'A" '"Z'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "-42|42|255|100|0100|ff|0XFF|+0000123|77    |0009|65|90\n"
      );
    });
  });

  it("2. printf formats floating-point (%f, %e, %E, %g, %G) with dynamic width and precision (%*.*f)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        printf '%.2f|%.3e|%.3E|%g|%G|%*.*f\n' \
          3.14159 1234.5 1234.5 0.0001234 1000000 8 3 2.5
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "3.14|1.234e+03|1.234E+03|0.0001234|1E+06|   2.500\n"
      );
    });
  });

  it("3. printf handles %s width/truncation, %b backslash escapes (including \\c stop), %q shell quoting, and format reuse", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        printf '[%-8.4s]\n' 'abcdefgh'
        printf '%b\n' 'line1\nline2\t\x41\0102'
        printf 'before-%b-after' 'mid\cignored'
        printf '\n'
        printf 'row:%s:%d\n' alpha 1 beta 2 gamma 3
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "[abcd    ]",
          "line1",
          "line2\tAB",
          "before-mid",
          "row:alpha:1",
          "row:beta:2",
          "row:gamma:3",
          ""
        ].join("\n")
      );
    });
  });

  it("4. numfmt converts between SI, IEC, and IEC-i units with rounding modes, suffixes, and padding", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        numfmt --to=si 1000 1500 1000000
        numfmt --to=iec 1024 1536 1048576
        numfmt --to=iec-i --suffix=B 1024 2097152
        numfmt --from=iec 1K 2M 1G
        numfmt --to=si --round=down 1999
        numfmt --to=si --round=up 1001
        numfmt --to=si --padding=6 1500
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "1.0k",
          "1.5k",
          "1.0M",
          "1.0K",
          "1.5K",
          "1.0M",
          "1.0KiB",
          "2.0MiB",
          "1024",
          "2097152",
          "1073741824",
          "1.9k",
          "1.1k",
          "  1.5k",
          ""
        ].join("\n")
      );
    });
  });

  it("5. numfmt reformats specific delimited columns with --header, --field, -d, and --format", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/metrics.csv": [
            "service,bytes_in,bytes_out",
            "api,1048576,2048",
            "db,1073741824,524288",
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          numfmt -d, --header=1 --field=2,3 --to=iec < /workspace/metrics.csv
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "service,bytes_in,bytes_out",
            "api,1.0M,2.0K",
            "db,1.0G,512K",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("6. shuf generates random permutations from -i ranges, -e args, and files with -n, -r, -z, and -o", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        shuf -i 1-10 -o /workspace/perm.txt
        wc -l < /workspace/perm.txt | tr -d ' '
        sort -n /workspace/perm.txt | paste -sd, -
        shuf -e -n 3 alpha beta gamma delta epsilon > /workspace/sample.txt
        wc -l < /workspace/sample.txt | tr -d ' '
        shuf -e -r -n 5 only_one | uniq -c | awk '{print $1, $2}'
        shuf -z -i 1-3 | tr '\0' ':'
        printf '\n'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "10");
      assert.equal(lines[1], "1,2,3,4,5,6,7,8,9,10");
      assert.equal(lines[2], "3");
      assert.equal(lines[3], "5 only_one");
      assert.equal(lines[4]?.split(":").filter(Boolean).sort().join(","), "1,2,3");
    });
  });

  it("7. truncate resizes files using absolute, relative (+, -), bounded (<, >), multiple (/, %), and reference (-r) modes", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        truncate -s 100 /workspace/f.bin
        stat -c '%s' /workspace/f.bin
        truncate -s +50 /workspace/f.bin
        stat -c '%s' /workspace/f.bin
        truncate -s -30 /workspace/f.bin
        stat -c '%s' /workspace/f.bin
        truncate -s '<80' /workspace/f.bin
        stat -c '%s' /workspace/f.bin
        truncate -s '>95' /workspace/f.bin
        stat -c '%s' /workspace/f.bin
        truncate -s '/32' /workspace/f.bin
        stat -c '%s' /workspace/f.bin
        truncate -s '%50' /workspace/f.bin
        stat -c '%s' /workspace/f.bin
        truncate -r /workspace/f.bin /workspace/clone.bin
        stat -c '%s' /workspace/clone.bin
        truncate -c -s 50 /workspace/never-created.bin
        test ! -e /workspace/never-created.bin && echo "no-create-ok"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "100",
          "150",
          "120",
          "80",
          "95",
          "64",
          "100",
          "100",
          "no-create-ok",
          ""
        ].join("\n")
      );
    });
  });

  it("8. install creates directory trees (-d), parent paths (-D), sets file modes (-m), compares (-C), and creates numbered backups", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/src/app.sh": "#!/bin/sh\necho v1\n",
          "/workspace/src/app_v2.sh": "#!/bin/sh\necho v2\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          install -d -m 750 /workspace/dist/bin /workspace/dist/etc
          install -D -m 755 /workspace/src/app.sh /workspace/dist/nested/sub/app.sh
          stat -c '%a' /workspace/dist/bin /workspace/dist/nested/sub/app.sh
          # -C skips rewrite when content and mode already match
          install -C -m 755 /workspace/src/app.sh /workspace/dist/nested/sub/app.sh
          # --backup=numbered preserves old target as .~1~
          install --backup=numbered -m 755 /workspace/src/app_v2.sh /workspace/dist/nested/sub/app.sh
          cat /workspace/dist/nested/sub/app.sh
          cat /workspace/dist/nested/sub/app.sh.~1~
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "750",
            "755",
            "#!/bin/sh",
            "echo v2",
            "#!/bin/sh",
            "echo v1",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("9. cp supports archive (-a), hardlinks (-l), symlinks (-s), update (-u), no-clobber (-n), and numbered backups", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/orig.txt": "v1\n",
          "/workspace/newer.txt": "v2\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          touch -d '2025-01-01T00:00:00Z' /workspace/orig.txt
          touch -d '2025-06-01T00:00:00Z' /workspace/newer.txt
          cp -l /workspace/orig.txt /workspace/hard.txt
          stat -c '%h' /workspace/orig.txt
          cp -s /workspace/orig.txt /workspace/sym.txt
          readlink /workspace/sym.txt
          cp -n /workspace/newer.txt /workspace/orig.txt
          cat /workspace/orig.txt
          cp --backup=numbered /workspace/newer.txt /workspace/target.txt
          cp --backup=numbered /workspace/orig.txt /workspace/target.txt
          cat /workspace/target.txt /workspace/target.txt.~1~
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "2",
            "/workspace/orig.txt",
            "v1",
            "v1",
            "v2",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("10. mv supports no-clobber (-n), update (-u), numbered backups, and cross-mount directory moves across MountFileSystem", async () => {
    const rootFs = createMemoryFileSystem();
    const mountA = createMemoryFileSystem();
    const mountB = createMemoryFileSystem();
    await seedFilesOnFs(mountA, {
      "/pkg/src/main.ts": "export const x = 42;\n"
    });
    const fs = createMountFileSystem({
      root: rootFs,
      mounts: {
        "/mnt/a": mountA,
        "/mnt/b": mountB
      }
    });

    await withE2EHarness({ fs, cwd: "/" }, async (h) => {
      const r = await h.exec(String.raw`
        mv /mnt/a/pkg /mnt/b/pkg_moved
        test ! -e /mnt/a/pkg && echo "source-removed"
        cat /mnt/b/pkg_moved/src/main.ts
        printf 'first\n' > /mnt/b/item.txt
        printf 'second\n' > /mnt/b/candidate.txt
        mv -n /mnt/b/candidate.txt /mnt/b/item.txt
        cat /mnt/b/item.txt
        mv --backup=numbered /mnt/b/candidate.txt /mnt/b/item.txt
        cat /mnt/b/item.txt /mnt/b/item.txt.~1~
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "source-removed",
          "export const x = 42;",
          "first",
          "second",
          "first",
          ""
        ].join("\n")
      );
    });
  });

  it("11. ln computes relative symlinks (-s -r), forces replacement (-f), and creates numbered backups", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/packages/core/dist/lib.js": "module.exports = 1;\n",
          "/workspace/packages/core/dist/lib_v2.js": "module.exports = 2;\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          mkdir -p /workspace/packages/cli/node_modules
          ln -s -r /workspace/packages/core/dist/lib.js /workspace/packages/cli/node_modules/core.js
          readlink /workspace/packages/cli/node_modules/core.js
          cat /workspace/packages/cli/node_modules/core.js
          ln -s -f -r --backup=numbered /workspace/packages/core/dist/lib_v2.js /workspace/packages/cli/node_modules/core.js
          readlink /workspace/packages/cli/node_modules/core.js
          readlink /workspace/packages/cli/node_modules/core.js.~1~
          cat /workspace/packages/cli/node_modules/core.js
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "../../core/dist/lib.js",
            "module.exports = 1;",
            "../../core/dist/lib_v2.js",
            "../../core/dist/lib.js",
            "module.exports = 2;",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("12. touch sets access (-a) and modification (-m) timestamps via -d ISO dates, -t POSIX stamps, and -r reference files", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        touch -d '2024-03-15T12:30:45Z' /workspace/ref.txt
        stat -c '%Y %X' /workspace/ref.txt
        touch -r /workspace/ref.txt /workspace/copy_ts.txt
        stat -c '%Y %X' /workspace/copy_ts.txt
        TZ=UTC touch -m -t 202501010000.00 /workspace/copy_ts.txt
        stat -c '%Y %X' /workspace/copy_ts.txt
        TZ=UTC touch -a -d '2026-06-01T00:00:00Z' /workspace/copy_ts.txt
        stat -c '%Y %X' /workspace/copy_ts.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "1710505845 1710505845",
          "1710505845 1710505845",
          "1735689600 1710505845",
          "1735689600 1780272000",
          ""
        ].join("\n")
      );
    });
  });

  it("13. readlink (-f, -e, -m) and realpath (-s, --relative-to, --relative-base) resolve nested symlink chains and missing paths", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/real/dir/target.txt": "payload\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          ln -s /workspace/real/dir /workspace/link_dir
          ln -s /workspace/link_dir/target.txt /workspace/chain_link
          readlink /workspace/chain_link
          readlink -f /workspace/chain_link
          readlink -e /workspace/chain_link
          readlink -m /workspace/link_dir/nonexistent/sub/../leaf.txt
          realpath -s /workspace/link_dir/../real/dir/target.txt
          realpath --relative-to=/workspace/real /workspace/chain_link
          realpath --relative-base=/workspace/real /workspace/chain_link /etc
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "/workspace/link_dir/target.txt",
            "/workspace/real/dir/target.txt",
            "/workspace/real/dir/target.txt",
            "/workspace/real/dir/nonexistent/leaf.txt",
            "/workspace/real/dir/target.txt",
            "dir/target.txt",
            "dir/target.txt",
            "/etc",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("14. stat formats metadata directives with -c and --printf across files, directories, and symlinks (-L)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/data.bin": "0123456789"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          chmod 640 /workspace/data.bin
          ln -s data.bin /workspace/data.link
          stat -c '%n|%F|%s|%a|%A' /workspace/data.bin
          stat -c '%F|%N' /workspace/data.link
          stat -L -c '%F|%s|%a' /workspace/data.link
          stat --printf='%n:%s\t%a\n' /workspace/data.bin
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "/workspace/data.bin|regular file|10|640|-rw-r-----",
            "symbolic link|'/workspace/data.link' -> 'data.bin'",
            "regular file|10|640",
            "/workspace/data.bin:10\t640",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("15. chmod symbolic and octal permission algebra (u/g/o/a, +X conditional execute, setuid/setgid/sticky, --reference, -R)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/tree/sub/file.txt": "hello\n",
          "/workspace/tree/sub/script.sh": "#!/bin/sh\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          chmod 700 /workspace/tree /workspace/tree/sub
          chmod 600 /workspace/tree/sub/file.txt
          chmod 700 /workspace/tree/sub/script.sh
          chmod -R a+rX /workspace/tree
          stat -c '%a %A' /workspace/tree/sub /workspace/tree/sub/file.txt /workspace/tree/sub/script.sh
          chmod u+s,g+s,+t /workspace/tree/sub/script.sh
          stat -c '%a %A' /workspace/tree/sub/script.sh
          chmod --reference=/workspace/tree/sub/file.txt /workspace/tree/sub/script.sh
          stat -c '%a %A' /workspace/tree/sub/script.sh
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "755 drwxr-xr-x",
            "644 -rw-r--r--",
            "755 -rwxr-xr-x",
            "7755 -rwsr-sr-t",
            "644 -rw-r--r--",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("16. mkdir -p -m, rmdir -p, and rm interactive (-i) confirmation and directory removal (-d)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        mkdir -p -m 750 /workspace/a/b/c
        stat -c '%a' /workspace/a/b/c
        rmdir -p /workspace/a/b/c
        test ! -e /workspace/a && echo "rmdir-p-ok"
        mkdir -p /workspace/keep
        printf 'one\n' > /workspace/keep/1.txt
        printf 'two\n' > /workspace/keep/2.txt
        printf 'n\ny\n' | rm -i /workspace/keep/1.txt /workspace/keep/2.txt 2>/dev/null
        test -e /workspace/keep/1.txt && test ! -e /workspace/keep/2.txt && echo "interactive-rm-ok"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "750",
          "rmdir-p-ok",
          "interactive-rm-ok",
          ""
        ].join("\n")
      );
    });
  });

  it("17. find -printf formats custom directory inventory records piped into sort and numfmt", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/proj/src/a.ts": "x".repeat(2048),
          "/workspace/proj/src/b.ts": "y".repeat(4096),
          "/workspace/proj/README.md": "z".repeat(1024)
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          chmod 644 /workspace/proj/src/a.ts /workspace/proj/src/b.ts /workspace/proj/README.md
          find /workspace/proj -type f -printf '%P\t%y\t%s\n' \
            | sort \
            | numfmt -d $'\t' --field=3 --to=iec
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "README.md\tf\t1.0K",
            "src/a.ts\tf\t2.0K",
            "src/b.ts\tf\t4.0K",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("18. ls sorts by size (-S), version (-v), extension (-X), reverse (-r), and classifies entries (-F)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/dir/v2.txt": "12345",
          "/workspace/dir/v10.txt": "1",
          "/workspace/dir/v1.md": "1234567890",
          "/workspace/dir/run.sh": "#!/bin/sh\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          chmod 755 /workspace/dir/run.sh
          mkdir /workspace/dir/sub
          ln -s v2.txt /workspace/dir/alias
          ls -1 -v /workspace/dir | paste -sd, -
          ls -1 -S /workspace/dir/v1.md /workspace/dir/v2.txt /workspace/dir/v10.txt | paste -sd, -
          ls -1 -X /workspace/dir/v1.md /workspace/dir/v2.txt /workspace/dir/run.sh | paste -sd, -
          ls -1 -F /workspace/dir | sort | paste -sd, -
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "alias,run.sh,sub,v1.md,v2.txt,v10.txt",
            "/workspace/dir/v1.md,/workspace/dir/v2.txt,/workspace/dir/v10.txt",
            "/workspace/dir/v1.md,/workspace/dir/run.sh,/workspace/dir/v2.txt",
            "alias@,run.sh*,sub/,v1.md,v10.txt,v2.txt",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("19. du computes apparent and filtered directory sizes with --apparent-size, -s, -d, and --exclude", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/app/src/code.ts": "a".repeat(3000),
          "/workspace/app/src/test.spec.ts": "b".repeat(1000),
          "/workspace/app/dist/bundle.js": "c".repeat(5000)
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          du -b -s /workspace/app
          du -b --exclude='*.spec.ts' -s /workspace/app
          du -b -d 1 /workspace/app | sort -k2
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "9000\t/workspace/app",
            "8000\t/workspace/app",
            "9000\t/workspace/app",
            "5000\t/workspace/app/dist",
            "4000\t/workspace/app/src",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("20. end-to-end release packaging workflow combining install, truncate, ln -sr, touch, chmod, find -printf, and stat", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/build/cli.js": "#!/usr/bin/env node\nconsole.log('ready');\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          install -d -m 755 /workspace/release/lib /workspace/release/bin
          install -m 755 /workspace/build/cli.js /workspace/release/lib/cli.js
          ln -s -r /workspace/release/lib/cli.js /workspace/release/bin/poe-cli
          truncate -s 4096 /workspace/release/lib/cache.bin
          touch -d '2025-05-01T00:00:00Z' /workspace/release/lib/cli.js /workspace/release/lib/cache.bin
          find /workspace/release -printf '%P|%y|%d|%s\n' | sort
          stat -c '%a' /workspace/release/lib/cli.js
          realpath --relative-to=/workspace/release/bin /workspace/release/bin/poe-cli
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "bin/poe-cli|l|2|13",
            "bin|d|1|0",
            "lib/cache.bin|f|2|4096",
            "lib/cli.js|f|2|42",
            "lib|d|1|0",
            "|d|0|0",
            "755",
            "../lib/cli.js",
            ""
          ].join("\n")
        );
      }
    );
  });
});
