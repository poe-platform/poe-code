import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure getconf, locale, id, uname, nproc, pathchk, mktemp, readlink, realpath, and install parity matrix", () => {
  it("1. getconf queries POSIX/GNU system variables, _SC_/_CS_ prefixes, and -v specification selectors", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        getconf ARG_MAX
        getconf _SC_ARG_MAX
        getconf _POSIX_ARG_MAX
        getconf OPEN_MAX
        getconf _SC_OPEN_MAX
        getconf CLK_TCK
        getconf CHAR_BIT
        getconf WORD_BIT
        getconf LONG_BIT
        getconf INT_MAX
        getconf INT_MIN
        getconf _POSIX_VERSION
        getconf GNU_LIBC_VERSION
        getconf LFS_CFLAGS
        getconf -v POSIX_V7_LP64_OFF64 POSIX_V7_LP64_OFF64
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "2097152",
          "2097152",
          "4096",
          "1024",
          "1024",
          "100",
          "8",
          "32",
          "64",
          "2147483647",
          "-2147483648",
          "200809",
          "glibc 2.39",
          "-D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64",
          "1",
          "",
        ].join("\n"),
      );
    });
  });

  it("2. getconf enforces pathname rules on _PC_/path vs system variables, -a [pathname], and unknown variable exit codes", async () => {
    await withE2EHarness(async (h) => {
      const ok = await h.exec(String.raw`
        getconf LINK_MAX /workspace
        getconf _PC_LINK_MAX /workspace
        getconf FILESIZEBITS /workspace
        getconf SYMLINK_MAX /workspace
        getconf _POSIX_NO_TRUNC /workspace
        getconf _POSIX_CHOWN_RESTRICTED /workspace
        getconf NAME_MAX
        getconf PATH_MAX
        getconf PIPE_BUF
        getconf -a /workspace | grep -E '^(ARG_MAX|NAME_MAX|LONG_BIT)\b' | awk '{print $1 ":" $2}'
      `);
      assert.equal(ok.exitCode, 0, ok.stderr);
      assert.equal(
        ok.stdout,
        [
          "65000",
          "65000",
          "64",
          "4095",
          "1",
          "1",
          "255",
          "4096",
          "4096",
          "ARG_MAX:2097152",
          "NAME_MAX:255",
          "LONG_BIT:64",
          "",
        ].join("\n"),
      );

      const errNeedPath = await h.exec("getconf LINK_MAX");
      assert.equal(errNeedPath.exitCode, 1);
      assert.match(errNeedPath.stderr, /requires a pathname/);

      const errRejectPath = await h.exec("getconf ARG_MAX /workspace");
      assert.equal(errRejectPath.exitCode, 1);
      assert.match(errRejectPath.stderr, /does not accept a pathname/);

      const errUnknown = await h.exec("getconf NO_SUCH_LIMIT_VAR");
      assert.equal(errUnknown.exitCode, 1);
      assert.match(errUnknown.stderr, /Unrecognized variable/i);

      const errMissingAll = await h.exec("getconf -a /workspace/no_such_dir");
      assert.equal(errMissingAll.exitCode, 1);
      assert.match(errMissingAll.stderr, /No such file or directory/);
    });
  });

  it("3. locale outputs all 12 LC_* categories with implied-quoting vs explicit assignment and LC_ALL override", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        LC_ALL= LANG=en_US.UTF-8 LC_NUMERIC=C LC_TIME=POSIX locale
        echo "---"
        LC_ALL=C.UTF-8 LANG=en_US.UTF-8 LC_NUMERIC=C locale
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "LANG=en_US.UTF-8",
          'LC_CTYPE="en_US.UTF-8"',
          "LC_NUMERIC=C",
          "LC_TIME=POSIX",
          'LC_COLLATE="en_US.UTF-8"',
          'LC_MONETARY="en_US.UTF-8"',
          'LC_MESSAGES="en_US.UTF-8"',
          'LC_PAPER="en_US.UTF-8"',
          'LC_NAME="en_US.UTF-8"',
          'LC_ADDRESS="en_US.UTF-8"',
          'LC_TELEPHONE="en_US.UTF-8"',
          'LC_MEASUREMENT="en_US.UTF-8"',
          'LC_IDENTIFICATION="en_US.UTF-8"',
          "LC_ALL=",
          "---",
          "LANG=en_US.UTF-8",
          'LC_CTYPE="C.UTF-8"',
          'LC_NUMERIC="C.UTF-8"',
          'LC_TIME="C.UTF-8"',
          'LC_COLLATE="C.UTF-8"',
          'LC_MONETARY="C.UTF-8"',
          'LC_MESSAGES="C.UTF-8"',
          'LC_PAPER="C.UTF-8"',
          'LC_NAME="C.UTF-8"',
          'LC_ADDRESS="C.UTF-8"',
          'LC_TELEPHONE="C.UTF-8"',
          'LC_MEASUREMENT="C.UTF-8"',
          'LC_IDENTIFICATION="C.UTF-8"',
          "LC_ALL=C.UTF-8",
          "",
        ].join("\n"),
      );
    });
  });

  it("4. locale queries -k / -c keywords and whole categories, -a -v verbose archive listings, and rejects unknown keywords", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        LC_ALL=en_US.UTF-8 locale -k charmap codeset mb_cur_max yesexpr noexpr d_fmt t_fmt grouping
        echo "---"
        LC_ALL=C locale -c -k charmap mb_cur_max
        echo "---"
        LC_ALL=C.UTF-8 locale -c -k LC_MESSAGES
        echo "---"
        locale -a -v | grep -E '^(locale: C |  codeset \| UTF-8)' | head -n 2
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          'charmap="UTF-8"',
          'codeset="UTF-8"',
          "mb_cur_max=6",
          'yesexpr="^[yY]"',
          'noexpr="^[nN]"',
          'd_fmt="%m/%d/%y"',
          't_fmt="%H:%M:%S"',
          "grouping=-1",
          "---",
          "LC_CTYPE",
          'charmap="ANSI_X3.4-1968"',
          "LC_CTYPE",
          "mb_cur_max=1",
          "---",
          "LC_MESSAGES",
          'yesexpr="^[yY]"',
          'noexpr="^[nN]"',
          'yesstr="yes"',
          'nostr="no"',
          "---",
          "locale: C               archive: /usr/lib/locale/locale-archive",
          "  codeset | UTF-8",
          "",
        ].join("\n"),
      );

      const bad = await h.exec("locale unknown_keyword_xyz");
      assert.equal(bad.exitCode, 1);
      assert.match(bad.stderr, /Unknown keyword 'unknown_keyword_xyz'/);
    });
  });

  it("5. id distinguishes real vs effective UID/GID (UID/EUID/GID/EGID) across default output, -u/-g/-G with -r/-n, and -Z context", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        UID=1000 EUID=0 GID=1000 EGID=0 USER=alice GROUP=devs id
        UID=1000 EUID=0 USER=alice id -u
        UID=1000 EUID=0 USER=alice id -ur
        UID=1000 EUID=0 USER=alice id -un
        UID=1000 EUID=0 USER=alice id -urn
        GID=1000 EGID=0 GROUP=devs id -g
        GID=1000 EGID=0 GROUP=devs id -gr
        GID=1000 EGID=0 GROUP=devs id -gn
        GID=1000 EGID=0 GROUP=devs id -grn
        SELINUX_CONTEXT=custom_u:custom_r:custom_t:s0 id -Z
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "uid=1000(alice) gid=1000(devs) euid=0(root) egid=0(root) groups=0(root),1000(devs)",
          "0",
          "1000",
          "root",
          "alice",
          "0",
          "1000",
          "root",
          "devs",
          "custom_u:custom_r:custom_t:s0",
          "",
        ].join("\n"),
      );
    });
  });

  it("6. id resolves multiple user and numeric UID operands across /etc/passwd, /etc/group, and builtin accounts with -z NUL delimiters", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/etc", { recursive: true });
      await h.writeText(
        "/etc/passwd",
        "builder:x:2001:2001:Builder:/home/builder:/bin/bash\nops:x:2002:2002:Ops:/home/ops:/bin/sh\n",
      );
      await h.writeText(
        "/etc/group",
        "builder:x:2001:\nops:x:2002:builder\nwheel:x:10:builder,ops\n",
      );

      const r = await h.exec(String.raw`
        id root
        id nobody
        id 2001
        id -un root builder 2002
        id -Gn -z builder | tr '\0' ':'
        printf '\n'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "uid=0(root) gid=0(root) groups=0(root)",
          "uid=65534(nobody) gid=65534(nogroup) groups=65534(nogroup)",
          "uid=2001(builder) gid=2001(builder) groups=2001(builder),2002(ops),10(wheel)",
          "root",
          "builder",
          "ops",
          "builder:ops:wheel:",
          "",
        ].join("\n"),
      );

      const missing = await h.exec("id builder ghost_user");
      assert.equal(missing.exitCode, 1);
      assert.equal(
        missing.stdout,
        "uid=2001(builder) gid=2001(builder) groups=2001(builder),2002(ops),10(wheel)\n",
      );
      assert.match(missing.stderr, /no such user/);
    });
  });

  it("7. uname formats short/long flags (-s, -n, -r, -v, -m, -p, -i, -o) and omits unknown -p/-i in -a unless overridden", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        uname -r
        uname -v
        uname -p
        uname -i
        uname --kernel-name --nodename --machine --operating-system
        uname -a
        UNAME_P=zen4 UNAME_I=x86_64_hw uname -a
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "6.6.0-sandbox-vfs",
          "#1 SMP Sandbox VFS-ish/GNU",
          "unknown",
          "unknown",
          "Linux sandbox x86_64 GNU/Linux",
          "Linux sandbox 6.6.0-sandbox-vfs #1 SMP Sandbox VFS-ish/GNU x86_64 GNU/Linux",
          "Linux sandbox 6.6.0-sandbox-vfs #1 SMP Sandbox VFS-ish/GNU x86_64 zen4 x86_64_hw GNU/Linux",
          "",
        ].join("\n"),
      );

      const badExtra = await h.exec("uname extra_arg");
      assert.equal(badExtra.exitCode, 1);
      assert.match(badExtra.stderr, /extra operand/);
    });
  });

  it("8. nproc evaluates comma-separated OMP_NUM_THREADS, OMP_THREAD_LIMIT caps, --all, --ignore, and rejects invalid arguments", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        NPROC=12 OMP_NUM_THREADS=8,4,2 nproc
        NPROC=12 OMP_NUM_THREADS=16 OMP_THREAD_LIMIT=6 nproc
        NPROC=12 OMP_NUM_THREADS=4 OMP_THREAD_LIMIT=2 nproc --all --ignore 5
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "8\n6\n7\n");

      const badNum = await h.exec("nproc --ignore=notanumber");
      assert.equal(badNum.exitCode, 1);
      assert.match(badNum.stderr, /invalid number/);

      const badOperand = await h.exec("nproc unexpected_operand");
      assert.equal(badOperand.exitCode, 1);
      assert.match(badOperand.stderr, /extra operand/);
    });
  });

  it("9. pathchk enforces 255-byte component limits, empty path diagnostics with/without -P, and -p portable character checks", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/not_a_dir", "file\n");

      const rOk = await h.exec(String.raw`
        comp255=$(printf 'a%.0s' $(seq 1 255))
        pathchk "sub/$comp255"
      `);
      assert.equal(rOk.exitCode, 0, rOk.stderr);

      const rTooLong = await h.exec(String.raw`
        comp256=$(printf 'a%.0s' $(seq 1 256))
        pathchk "sub/$comp256"
      `);
      assert.equal(rTooLong.exitCode, 1);
      assert.match(rTooLong.stderr, /limit 255 exceeded by length 256 of file name component/);

      const rEmptyDefault = await h.exec("pathchk ''");
      assert.equal(rEmptyDefault.exitCode, 1);
      assert.match(rEmptyDefault.stderr, /No such file or directory/);

      const rEmptyP = await h.exec("pathchk -P ''");
      assert.equal(rEmptyP.exitCode, 1);
      assert.match(rEmptyP.stderr, /empty file name/);

      const rBadChar = await h.exec("pathchk -p 'dir/bad@name.txt'");
      assert.equal(rBadChar.exitCode, 1);
      assert.match(rBadChar.stderr, /nonportable character '@' in file name 'dir\/bad@name\.txt'/);
    });
  });

  it("10. mktemp supports -d, -u dry-run, -p/--tmpdir/TMPDIR, --suffix, and rejects templates with fewer than 3 X characters", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        mkdir -p /workspace/custom_tmp
        f1=$(mktemp)
        test -f "$f1" && stat -c '%a' "$f1"
        d1=$(mktemp -d -p /workspace/custom_tmp build.XXXXXX)
        test -d "$d1" && stat -c '%a' "$d1"
        u1=$(mktemp -u /workspace/custom_tmp/dry.XXXXXX)
        test ! -e "$u1" && echo "dry_ok"
        s1=$(mktemp --tmpdir=/workspace/custom_tmp --suffix=.json item.XXXX)
        test -f "$s1" && echo "$s1"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "600");
      assert.equal(lines[1], "700");
      assert.equal(lines[2], "dry_ok");
      assert.match(lines[3]!, /^\/workspace\/custom_tmp\/item\.[A-Za-z0-9]{4}\.json$/);

      const tooFewX = await h.exec("mktemp /workspace/custom_tmp/bad.XX");
      assert.equal(tooFewX.exitCode, 1);
      assert.ok(tooFewX.stderr.length > 0);

      const quietFail = await h.exec("mktemp -q /workspace/no_such_parent_dir/file.XXXXXX");
      assert.equal(quietFail.exitCode, 1);
      assert.equal(quietFail.stderr, "");

      const absWithTmpdir = await h.exec("mktemp -p /workspace/custom_tmp /abs/path.XXXXXX");
      assert.equal(absWithTmpdir.exitCode, 1);
    });
  });

  it("11. readlink distinguishes raw link target vs -f (canonicalize existing parent), -e (canonicalize existing), and -m (canonicalize missing)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        mkdir -p /workspace/rl/dir
        printf 'hello\n' > /workspace/rl/dir/real.txt
        ln -s dir/real.txt /workspace/rl/link_rel
        ln -s link_rel /workspace/rl/link_chain
        ln -s dir/not_created_yet.txt /workspace/rl/dangling_ok_parent
        ln -s missing_sub/file.txt /workspace/rl/dangling_bad_parent

        readlink /workspace/rl/link_chain
        readlink -f /workspace/rl/link_chain
        readlink -e /workspace/rl/link_chain
        readlink -f /workspace/rl/dangling_ok_parent
        readlink -m /workspace/rl/dangling_bad_parent
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "link_rel",
          "/workspace/rl/dir/real.txt",
          "/workspace/rl/dir/real.txt",
          "/workspace/rl/dir/not_created_yet.txt",
          "/workspace/rl/missing_sub/file.txt",
          "",
        ].join("\n"),
      );

      const rawRegular = await h.exec("readlink /workspace/rl/dir/real.txt");
      assert.equal(rawRegular.exitCode, 1);

      const existDangling = await h.exec("readlink -e /workspace/rl/dangling_ok_parent");
      assert.equal(existDangling.exitCode, 1);

      const canonBadParent = await h.exec("readlink -f /workspace/rl/dangling_bad_parent");
      assert.equal(canonBadParent.exitCode, 1);
    });
  });

  it("12. readlink handles multiple operands, -n (--no-newline) on single vs multiple arguments, and -z (--zero) NUL terminators", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        mkdir -p /workspace/rl2
        printf 'x' > /workspace/rl2/target.txt
        ln -s target.txt /workspace/rl2/a
        ln -s a /workspace/rl2/b

        printf '[%s]\n' "$(readlink -n /workspace/rl2/a)"
        readlink -f /workspace/rl2/a /workspace/rl2/b
        readlink -z /workspace/rl2/a /workspace/rl2/b | tr '\0' '|'
        printf '\n'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "[target.txt]",
          "/workspace/rl2/target.txt",
          "/workspace/rl2/target.txt",
          "target.txt|a|",
          "",
        ].join("\n"),
      );
    });
  });

  it("13. realpath supports -E (default), -e (--canonicalize-existing), -m (--canonicalize-missing), and -s (--no-symlinks)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        mkdir -p /workspace/rp/actual_dir
        ln -s /workspace/rp/actual_dir /workspace/rp/sym_dir
        printf 'ok\n' > /workspace/rp/actual_dir/present.txt

        realpath /workspace/rp/sym_dir/present.txt
        realpath /workspace/rp/sym_dir/future.txt
        realpath -s /workspace/rp/sym_dir/../sym_dir/present.txt
        realpath -m /workspace/rp/sym_dir/deep/missing/../leaf.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "/workspace/rp/actual_dir/present.txt",
          "/workspace/rp/actual_dir/future.txt",
          "/workspace/rp/sym_dir/present.txt",
          "/workspace/rp/actual_dir/deep/leaf.txt",
          "",
        ].join("\n"),
      );

      const errExisting = await h.exec("realpath -e /workspace/rp/sym_dir/future.txt");
      assert.equal(errExisting.exitCode, 1);

      const errParent = await h.exec("realpath /workspace/rp/sym_dir/missing_parent/leaf.txt");
      assert.equal(errParent.exitCode, 1);
    });
  });

  it("14. realpath computes relative paths with --relative-to, --relative-base, and -z NUL delimiters", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        mkdir -p /workspace/rp_rel/base/sub /workspace/rp_rel/outside
        printf '1' > /workspace/rp_rel/base/sub/item.txt
        printf '2' > /workspace/rp_rel/outside/ext.txt

        realpath --relative-to=/workspace/rp_rel/base /workspace/rp_rel/base/sub/item.txt /workspace/rp_rel/outside/ext.txt
        echo "---"
        realpath --relative-base=/workspace/rp_rel/base /workspace/rp_rel/base/sub/item.txt /workspace/rp_rel/base /workspace/rp_rel/outside/ext.txt
        echo "---"
        realpath -z --relative-to=/workspace/rp_rel/base /workspace/rp_rel/base/sub/item.txt /workspace/rp_rel/base | tr '\0' ':'
        printf '\n'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "sub/item.txt",
          "../outside/ext.txt",
          "---",
          "sub/item.txt",
          ".",
          "/workspace/rp_rel/outside/ext.txt",
          "---",
          "sub/item.txt:.:",
          "",
        ].join("\n"),
      );
    });
  });

  it("15. install -d creates multiple nested directories with symbolic and octal -m permissions", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        install -d -m u=rwx,g=rx,o= /workspace/inst_d/alpha/inner /workspace/inst_d/beta/inner
        stat -c '%a:%F' /workspace/inst_d/alpha/inner /workspace/inst_d/beta/inner
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "750:directory\n750:directory\n");
    });
  });

  it("16. install copies multiple sources into an existing directory, supports -D -t DIR, and -D -T single-file target", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        printf 'one\n' > /workspace/f1.txt
        printf 'two\n' > /workspace/f2.txt
        mkdir -p /workspace/multi_dest
        install -m u=rw,go=r /workspace/f1.txt /workspace/f2.txt /workspace/multi_dest
        stat -c '%a:%n' /workspace/multi_dest/f1.txt /workspace/multi_dest/f2.txt

        install -D -m 0755 -t /workspace/nested_target/bin /workspace/f1.txt /workspace/f2.txt
        stat -c '%a:%n' /workspace/nested_target/bin/f1.txt /workspace/nested_target/bin/f2.txt

        install -D -T -m 0700 /workspace/f1.txt /workspace/single_target/sub/app_bin
        stat -c '%a:%n' /workspace/single_target/sub/app_bin
        cat /workspace/single_target/sub/app_bin
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "644:/workspace/multi_dest/f1.txt",
          "644:/workspace/multi_dest/f2.txt",
          "755:/workspace/nested_target/bin/f1.txt",
          "755:/workspace/nested_target/bin/f2.txt",
          "700:/workspace/single_target/sub/app_bin",
          "one",
          "",
        ].join("\n"),
      );
    });
  });

  it("17. install supports simple (-b), custom suffix (-S), numbered (--backup=numbered), and existing (--backup=existing) backups", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        mkdir -p /workspace/bak
        printf 'v1\n' > /workspace/bak/src.txt
        install -m 0644 /workspace/bak/src.txt /workspace/bak/app.conf

        printf 'v2\n' > /workspace/bak/src.txt
        install -b -S .orig -m 0644 /workspace/bak/src.txt /workspace/bak/app.conf
        cat /workspace/bak/app.conf.orig

        printf 'v3\n' > /workspace/bak/src.txt
        install --backup=numbered -m 0644 /workspace/bak/src.txt /workspace/bak/app.conf
        cat /workspace/bak/app.conf.~1~

        printf 'v4\n' > /workspace/bak/src.txt
        install --backup=existing -m 0644 /workspace/bak/src.txt /workspace/bak/app.conf
        cat /workspace/bak/app.conf.~2~
        cat /workspace/bak/app.conf
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "v1\nv2\nv3\nv4\n");
    });
  });

  it("18. install -C (--compare) skips rewriting and backup creation when content and mode match, but updates when either differs", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        mkdir -p /workspace/cmp
        printf 'payload_v1\n' > /workspace/cmp/src.txt
        install -m 0644 /workspace/cmp/src.txt /workspace/cmp/target.txt

        # Identical content and mode 0644 -> should skip rewrite and NOT create backup
        install -C -b -m 0644 /workspace/cmp/src.txt /workspace/cmp/target.txt
        test ! -e /workspace/cmp/target.txt~ && echo "no_backup_on_match"

        # Mode change to 0755 -> should update and create backup
        install -C -b -m 0755 /workspace/cmp/src.txt /workspace/cmp/target.txt
        test -f /workspace/cmp/target.txt~ && stat -c '%a' /workspace/cmp/target.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "no_backup_on_match\n755\n");
    });
  });

  it("19. install reports errors on missing sources, omitting source directories, and mutually exclusive -C -p options", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/src_dir", { recursive: true });
      await h.writeText("/workspace/valid.txt", "ok\n");

      const errMissing = await h.exec("install /workspace/no_such_file.txt /workspace/out.txt");
      assert.equal(errMissing.exitCode, 1);
      assert.match(errMissing.stderr, /No such file or directory/);

      const errDir = await h.exec("install /workspace/src_dir /workspace/out.txt");
      assert.equal(errDir.exitCode, 1);
      assert.match(errDir.stderr, /omitting directory/);

      const errMutex = await h.exec("install -C -p /workspace/valid.txt /workspace/out.txt");
      assert.equal(errMutex.exitCode, 1);
      assert.match(errMutex.stderr, /mutually exclusive/);
    });
  });

  it("20. end-to-end release staging pipeline combining pathchk, mktemp -d, uname, nproc, getconf, locale, id, install -D, ln -s, readlink -f, and realpath", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        pathchk -p -P "release-1.0/bin/app-cli"
        stage=$(mktemp -d -p /workspace stage.XXXXXX)
        sys=$(UNAME_S=Linux UNAME_M=x86_64 uname -s -m | tr ' ' '-')
        workers=$(NPROC=8 OMP_NUM_THREADS=4 nproc)
        pagesz=$(getconf PAGE_SIZE)
        cmap=$(LC_ALL=C.UTF-8 locale charmap)
        builder=$(USER=releng id -un)

        printf '#!/bin/sh\necho "%s|%s|%s|%s|%s"\n' "$sys" "$workers" "$pagesz" "$cmap" "$builder" > "$stage/app-cli"
        install -D -m 0755 "$stage/app-cli" /workspace/opt/releases/v1/bin/app-cli
        mkdir -p /workspace/opt/current
        ln -s ../releases/v1/bin/app-cli /workspace/opt/current/app-cli

        readlink /workspace/opt/current/app-cli
        readlink -f /workspace/opt/current/app-cli
        realpath --relative-to=/workspace/opt /workspace/opt/current/app-cli
        /workspace/opt/current/app-cli || sh /workspace/opt/current/app-cli
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "../releases/v1/bin/app-cli",
          "/workspace/opt/releases/v1/bin/app-cli",
          "releases/v1/bin/app-cli",
          "Linux-x86_64|4|4096|UTF-8|releng",
          "",
        ].join("\n"),
      );
    });
  });
});
