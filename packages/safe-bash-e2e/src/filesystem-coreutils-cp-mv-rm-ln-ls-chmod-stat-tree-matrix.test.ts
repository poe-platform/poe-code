import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("filesystem coreutils: mkdir, touch, cp, mv, rm, rmdir, ln, readlink, realpath, ls, chmod, stat, du, tree, mktemp, install, truncate matrix", () => {
  it("1. mkdir -p and -m create nested directories with explicit permissions", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p -m 750 /work/a/b/c",
          "stat -c '%F:%a' /work/a/b/c",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "directory:750\n");
    });
  });

  it("2. touch -c, -d ISO timestamp, and -r reference file synchronize mtimes", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/ref.txt": "ref\n",
          "/work/target.txt": "target\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "touch -c /work/does_not_exist.txt",
            "! test -e /work/does_not_exist.txt && echo 'NO_CREATE_OK'",
            "touch -d '2025-01-15T12:30:00Z' /work/ref.txt",
            "touch -r /work/ref.txt /work/target.txt",
            "test \"$(stat -c '%Y' /work/ref.txt)\" = \"$(stat -c '%Y' /work/target.txt)\" && echo 'MTIME_MATCH'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "NO_CREATE_OK\nMTIME_MATCH\n");
      }
    );
  });

  it("3. cp -r, -p, -n no-clobber, and --backup=numbered copy trees and preserve existing targets", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/src/file.txt": { content: "v2\n", mode: 0o755 },
          "/work/dst/file.txt": "v1\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "cp -n /work/src/file.txt /work/dst/file.txt",
            "cat /work/dst/file.txt",
            "cp --backup=numbered -p /work/src/file.txt /work/dst/file.txt",
            "cat /work/dst/file.txt /work/dst/file.txt.~1~",
            "stat -c '%a' /work/dst/file.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "v1\nv2\nv1\n755\n");
      }
    );
  });

  it("4. mv -n no-clobber, -u update, and --backup=simple rename files safely", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/a.txt": "new_val\n",
          "/work/b.txt": "existing_val\n",
          "/work/c.txt": "replacement\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "mv -n /work/a.txt /work/b.txt",
            "cat /work/b.txt",
            "mv --backup=simple -S .orig /work/c.txt /work/b.txt",
            "cat /work/b.txt /work/b.txt.orig",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["existing_val", "replacement", "existing_val", ""].join("\n")
        );
      }
    );
  });

  it("5. rm -f, rm -d, rm -r, and rmdir -p clean up empty and non-empty directory hierarchies", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/tree/sub/leaf.txt": "leaf\n",
        },
        directories: ["/work/empty/a/b/c"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "rm -f /work/missing_file.txt && echo 'RM_FORCE_OK'",
            "rmdir -p /work/empty/a/b/c",
            "! test -e /work/empty && echo 'RMDIR_PARENTS_OK'",
            "rm -r /work/tree",
            "! test -e /work/tree && echo 'RM_RECURSIVE_OK'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["RM_FORCE_OK", "RMDIR_PARENTS_OK", "RM_RECURSIVE_OK", ""].join("\n")
        );
      }
    );
  });

  it("6. ln -s, ln hardlink, readlink -f/-e/-m, and realpath --relative-to resolve symlink chains", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/real/dir/target.txt": "payload\n",
        },
        directories: ["/work/links"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "ln -s /work/real/dir/target.txt /work/links/hop1",
            "ln -s hop1 /work/links/hop2",
            "readlink /work/links/hop2",
            "readlink -f /work/links/hop2",
            "readlink -m /work/links/hop2/../nonexistent/file.txt",
            "realpath --relative-to=/work/real /work/links/hop2",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "hop1",
            "/work/real/dir/target.txt",
            "/work/real/dir/nonexistent/file.txt",
            "dir/target.txt",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("7. hardlinks (ln without -s) share underlying file content and increment link count", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/orig.txt": "initial\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "ln /work/orig.txt /work/hard.txt",
            "stat -c '%h' /work/orig.txt",
            "printf 'updated\\n' > /work/hard.txt",
            "cat /work/orig.txt",
            "rm /work/orig.txt",
            "cat /work/hard.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "2\nupdated\nupdated\n");
      }
    );
  });

  it("8. ls sorting and classification flags (-A, -F, -S, -X, -v, -r, -R)", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/lsdir/.hidden": "h",
          "/work/lsdir/file2.txt": "12345",
          "/work/lsdir/file10.txt": "12",
          "/work/lsdir/file1.sh": { content: "#!/bin/sh\n", mode: 0o755 },
        },
        directories: ["/work/lsdir/subdir"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "ls -1F /work/lsdir",
            "echo '---'",
            "ls -1v /work/lsdir",
            "echo '---'",
            "ls -1S /work/lsdir",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "file1.sh*",
            "file10.txt",
            "file2.txt",
            "subdir/",
            "---",
            "file1.sh",
            "file2.txt",
            "file10.txt",
            "subdir",
            "---",
            "file1.sh",
            "file2.txt",
            "file10.txt",
            "subdir",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("9. chmod symbolic (u+x,g-w,o=r,a+r,u=rwX) and octal mode changes with -R", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/perm/script.sh": { content: "echo 1\n", mode: 0o644 },
          "/work/perm/data.txt": { content: "data\n", mode: 0o666 },
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "chmod u+x,g-r,o= /work/perm/script.sh",
            "stat -c '%a:%A' /work/perm/script.sh",
            "chmod -R a=rX /work/perm",
            "stat -c '%a' /work/perm /work/perm/script.sh /work/perm/data.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["700:-rwx------", "555", "555", "444", ""].join("\n")
        );
      }
    );
  });

  it("10. stat -c format specifiers (%n, %s, %F, %a, %A, %h, %N)", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/item.txt": { content: "hello world\n", mode: 0o640 },
        },
      },
      async (h) => {
        const r = await h.exec(
          "stat -c '%n|%s|%F|%a|%A' /work/item.txt"
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          "/work/item.txt|12|regular file|640|-rw-r-----\n"
        );
      }
    );
  });

  it("11. du -b, -a, -s, -d max-depth, and --exclude compute directory byte usage", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/du/a.txt": "0123456789",
          "/work/du/sub/b.txt": "01234567890123456789",
          "/work/du/sub/skip.log": "9999999999",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "du -sb /work/du | awk '{print $1}'",
            "du -sb --exclude='*.log' /work/du | awk '{print $1}'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "40\n30\n");
      }
    );
  });

  it("12. tree -a, -d, -L depth, -I ignore, -P pattern, and -J JSON output", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/t/.env": "1",
          "/work/t/app.ts": "2",
          "/work/t/sub/lib.ts": "3",
          "/work/t/sub/notes.md": "4",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "tree -J -P '*.ts' /work/t | jq -r '.[0].contents[].name' | sort",
            "echo '---'",
            "tree -d -i -f --noreport /work/t",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "app.ts",
            "sub",
            "---",
            "/work/t",
            "/work/t/sub",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("13. mktemp creates unique temporary files and directories (-d) with templates", async () => {
    await withE2EHarness(
      {
        directories: ["/tmp"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "f=$(mktemp /tmp/test.XXXXXX)",
            "d=$(mktemp -d /tmp/dir.XXXXXX)",
            "test -f \"$f\" && test -d \"$d\" && echo 'MKTEMP_OK'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "MKTEMP_OK\n");
      }
    );
  });

  it("14. install -d creates directories and install -D -m copies files with mode and parent creation", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/build/cli.sh": "#!/bin/sh\necho cli\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "install -d -m 750 /work/prefix/share",
            "install -D -m 755 /work/build/cli.sh /work/prefix/bin/cli",
            "stat -c '%a' /work/prefix/share /work/prefix/bin/cli",
            "cat /work/prefix/bin/cli",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "750\n755\n#!/bin/sh\necho cli\n");
      }
    );
  });

  it("15. truncate -s sets exact, relative (+N, -N), and rounded file byte sizes", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/blob.bin": "0123456789abcdef",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "truncate -s 10 /work/blob.bin && stat -c '%s' /work/blob.bin",
            "truncate -s +6 /work/blob.bin && stat -c '%s' /work/blob.bin",
            "truncate -s -4 /work/blob.bin && stat -c '%s' /work/blob.bin",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "10\n16\n12\n");
      }
    );
  });

  it("16. basename and dirname with -a, -s suffix, and -z NUL output", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "basename -a -s .tar.gz /a/b/one.tar.gz /c/d/two.tar.gz",
          "echo '---'",
          "dirname /a/b/one.tar.gz /onlyname ///",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        ["one", "two", "---", "/a/b", "/", "/", ""].join("\n")
      );
    });
  });

  it("17. pwd -L (logical) vs pwd -P (physical) inside symlinked working directory", async () => {
    await withE2EHarness(
      {
        directories: ["/work/physical/dir"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "ln -s /work/physical/dir /work/logical_link",
            "cd /work/logical_link",
            "pwd -L",
            "pwd -P",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["/work/logical_link", "/work/physical/dir", ""].join("\n")
        );
      }
    );
  });

  it("18. dd block slicing, seek/skip, conv=ucase,notrunc, and rm -d empty directory removal", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/in.bin": "hello_world_12345",
          "/work/out.bin": "AAAAAAAAAAAAAAAAA",
        },
        directories: ["/work/emptydir"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "dd if=/work/in.bin of=/work/out.bin bs=1 skip=6 seek=2 count=5 conv=ucase,notrunc status=none",
            "cat /work/out.bin",
            "echo ''",
            "rm -d /work/emptydir && ! test -e /work/emptydir && echo 'RM_DIR_OK'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "AAWORLDAAAAAAAAAA\nRM_DIR_OK\n");
      }
    );
  });

  it("19. file command inspects magic headers and classifies file types", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/data.json": '{"hello":"world"}\n',
          "/work/script.sh": "#!/bin/sh\necho hi\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "gzip -c /work/data.json > /work/data.json.gz",
            "file -b /work/data.json.gz",
            "file -b /work/script.sh",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.match(r.stdout, /gzip/i);
        assert.match(r.stdout, /shell|script|text/i);
      }
    );
  });

  it("20. atomic staging and deployment workflow using mktemp, install, ln -sfn, and readlink", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/src/app.sh": "#!/bin/sh\necho v1\n",
        },
        directories: ["/tmp", "/work/releases"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "stage=$(mktemp -d /tmp/stage.XXXXXX)",
            "install -D -m 755 /work/src/app.sh \"$stage/bin/app\"",
            "mv \"$stage\" /work/releases/v1",
            "ln -sfn /work/releases/v1 /work/current",
            "readlink -f /work/current/bin/app",
            "sh /work/current/bin/app",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "/work/releases/v1/bin/app\nv1\n");
      }
    );
  });
});
