import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure ls mkdir rmdir rm cp mv ln chmod touch stat readlink realpath du df mktemp tree parity matrix", () => {
  it("1. ls --help, --version, unrecognized long option, invalid short option, and missing path ENOENT diagnostic", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      "ls --help | head -n 2; ls --version; ls --bogus; echo RC1=$?; ls -z; echo RC2=$?; ls /nope; echo RC3=$?",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "Usage: ls [OPTION]... [FILE]...\nList virtual directory entries.\nls (safe-bash virtual implementation)\nRC1=2\nRC2=2\nRC3=1\n",
    );
    assert.equal(
      r.stderr,
      "ls: unrecognized option '--bogus'\nls: invalid option -- 'z'\nls: ENOENT: no such file or directory, lstat '/nope'\n",
    );
  });

  it("2. mkdir invalid -m mode, existing directory EEXIST, missing parent ENOENT, and non-directory parent ENOTDIR", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/f.txt": "hello\n" },
      directories: ["/tmp/d"],
    });
    const r = await h.exec(
      "mkdir -m 999 /tmp/m; echo RC1=$?; mkdir /tmp/d; echo RC2=$?; mkdir /tmp/no/sub; echo RC3=$?; mkdir /tmp/f.txt/sub; echo RC4=$?; mkdir -p /tmp/f.txt/sub; echo RC5=$?",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "RC1=2\nRC2=1\nRC3=1\nRC4=1\nRC5=1\n");
    assert.equal(
      r.stderr,
      "mkdir: invalid mode: '999'\nmkdir: EEXIST: file already exists, mkdir '/tmp/d'\nmkdir: ENOENT: no such file or directory, mkdir '/tmp/no/sub'\nmkdir: ENOTDIR: not a directory, mkdir '/tmp/f.txt/sub'\nmkdir: ENOTDIR: not a directory, mkdir '/tmp/f.txt/sub'\n",
    );
  });

  it("3. rmdir missing operand, missing path ENOENT, non-directory ENOTDIR, and non-empty directory ENOTEMPTY", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/f.txt": "hello\n", "/tmp/d/child.txt": "x\n" },
      directories: ["/tmp/d"],
    });
    const r = await h.exec(
      "rmdir; echo RC1=$?; rmdir /tmp/nope; echo RC2=$?; rmdir /tmp/f.txt; echo RC3=$?; rmdir /tmp/d; echo RC4=$?",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "RC1=2\nRC2=1\nRC3=1\nRC4=1\n");
    assert.equal(
      r.stderr,
      "rmdir: missing operand\nrmdir: ENOENT: no such file or directory, rmdir '/tmp/nope'\nrmdir: ENOTDIR: not a directory, rmdir '/tmp/f.txt'\nrmdir: ENOTEMPTY: directory not empty, rmdir '/tmp/d'\n",
    );
  });

  it("4. rm missing operand, missing path ENOENT, directory EISDIR without -r/-d, and non-empty directory ENOTEMPTY with -d", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/d/child.txt": "x\n" },
      directories: ["/tmp/d"],
    });
    const r = await h.exec(
      "rm; echo RC1=$?; rm /tmp/nope; echo RC2=$?; rm /tmp/d; echo RC3=$?; rm -d /tmp/d; echo RC4=$?",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "RC1=2\nRC2=1\nRC3=1\nRC4=1\n");
    assert.equal(
      r.stderr,
      "rm: missing operand\nrm: ENOENT: no such file or directory, rm '/tmp/nope'\nrm: EISDIR: illegal operation on a directory, rm '/tmp/d'\nrm: ENOTEMPTY: directory not empty, rmdir '/tmp/d'\n",
    );
  });

  it("5. cp missing operand, missing source ENOENT, omitting directory EISDIR without -R, and -T onto directory EISDIR", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/f.txt": "hello\n" },
      directories: ["/tmp/d"],
    });
    const r = await h.exec(
      "cp; echo RC1=$?; cp /tmp/f.txt; echo RC2=$?; cp /tmp/nope /tmp/dst; echo RC3=$?; cp /tmp/d /tmp/d2; echo RC4=$?; cp -T /tmp/f.txt /tmp/d; echo RC5=$?",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "RC1=2\nRC2=2\nRC3=1\nRC4=1\nRC5=1\n");
    assert.equal(
      r.stderr,
      "cp: missing operand\ncp: missing operand\ncp: ENOENT: no such file or directory, lstat '/tmp/nope'\ncp: EISDIR: omitting directory (use -R) '/tmp/d'\ncp: EISDIR: illegal operation on a directory '/tmp/d'\n",
    );
  });

  it("6. mv missing operand, missing source ENOENT rename diagnostic, and -T onto directory EISDIR rename diagnostic", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/f.txt": "hello\n" },
      directories: ["/tmp/d"],
    });
    const r = await h.exec(
      "mv; echo RC1=$?; mv /tmp/f.txt; echo RC2=$?; mv /tmp/nope /tmp/dst; echo RC3=$?; mv -T /tmp/f.txt /tmp/d; echo RC4=$?",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "RC1=2\nRC2=2\nRC3=1\nRC4=1\n");
    assert.equal(
      r.stderr,
      "mv: missing operand\nmv: missing operand\nmv: ENOENT: no such file or directory, rename '/tmp/nope' -> '/tmp/dst'\nmv: EISDIR: illegal operation on a directory, rename '/tmp/f.txt' -> '/tmp/d'\n",
    );
  });

  it("7. ln missing operand, existing symlink EEXIST, existing hardlink EEXIST, missing hardlink source ENOENT, and hardlinking directory EPERM", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/f.txt": "hello\n", "/tmp/f2.txt": "world\n" },
      directories: ["/tmp/d"],
    });
    const r = await h.exec(
      "ln; echo RC1=$?; ln -s /tmp/f.txt /tmp/f.txt; echo RC2=$?; ln /tmp/f.txt /tmp/f.txt; echo RC3=$?; ln /tmp/f.txt /tmp/f2.txt; echo RC4=$?; ln /tmp/nope /tmp/hl; echo RC5=$?; ln /tmp/d /tmp/d_hl; echo RC6=$?",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "RC1=2\nRC2=1\nRC3=1\nRC4=1\nRC5=1\nRC6=1\n");
    assert.equal(
      r.stderr,
      "ln: missing operand\nln: EEXIST: file already exists, symlink '/tmp/f.txt'\nln: EEXIST: file already exists '/tmp/f.txt'\nln: EEXIST: file already exists, link '/tmp/f.txt' -> '/tmp/f2.txt'\nln: ENOENT: no such file or directory, link '/tmp/nope'\nln: EPERM: operation not permitted, link '/tmp/d' -> '/tmp/d_hl'\n",
    );
  });

  it("8. chmod missing operand, invalid mode, and missing path ENOENT lstat diagnostic", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/f.txt": "hello\n" },
    });
    const r = await h.exec(
      "chmod; echo RC1=$?; chmod 755; echo RC2=$?; chmod +z /tmp/f.txt; echo RC3=$?; chmod 755 /tmp/nope; echo RC4=$?",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "RC1=1\nRC2=1\nRC3=1\nRC4=1\n");
    assert.equal(
      r.stderr,
      "chmod: missing operand\nchmod: missing operand\nchmod: invalid mode: '+z'\nchmod: ENOENT: no such file or directory, lstat '/tmp/nope'\n",
    );
  });

  it("9. touch missing operand, missing -r reference ENOENT, invalid -d date, invalid -t stamp, and valid -d/-t timestamps", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/f.txt": "hello\n" },
    });
    const r = await h.exec(
      "touch; echo RC1=$?; touch -r /tmp/nope /tmp/f.txt; echo RC2=$?; touch -d invalid-date /tmp/f.txt; echo RC3=$?; touch -t invalid /tmp/f.txt; echo RC4=$?; touch -t 202401020304.05 /tmp/f.txt && stat -c %Y /tmp/f.txt",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "RC1=2\nRC2=1\nRC3=1\nRC4=1\n1704164645\n");
    assert.equal(
      r.stderr,
      "touch: missing operand\ntouch: ENOENT: no such file or directory, stat '/tmp/nope'\ntouch: unsupported or invalid date: invalid-date\ntouch: invalid date format 'invalid'\n",
    );
  });

  it("10. stat missing operand, missing path ENOENT lstat diagnostic, and format specifiers", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/f.txt": "hello\n" },
    });
    const r = await h.exec(
      "stat; echo RC1=$?; stat /tmp/nope; echo RC2=$?; stat -c '%s:%F' /tmp/f.txt",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "RC1=1\nRC2=1\n6:regular file\n");
    assert.equal(
      r.stderr,
      "stat: missing operand\nstat: ENOENT: no such file or directory, lstat '/tmp/nope'\n",
    );
  });

  it("11. readlink missing operand, unrecognized option, and -v EINVAL/ENOENT/realpath diagnostics", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/f.txt": "hello\n" },
      symlinks: { "/tmp/sym": "/tmp/f.txt" },
    });
    const r = await h.exec(
      "readlink; echo RC1=$?; readlink --bogus; echo RC2=$?; readlink -z; echo RC3=$?; readlink -v /tmp/f.txt; echo RC4=$?; readlink -v /tmp/nope; echo RC5=$?; readlink -v -e /tmp/nope; echo RC6=$?; readlink /tmp/sym",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "RC1=2\nRC2=2\nRC3=2\nRC4=1\nRC5=1\nRC6=1\n/tmp/f.txt\n");
    assert.equal(
      r.stderr,
      "readlink: missing operand\nreadlink: unrecognized option '--bogus'\nreadlink: missing operand\nreadlink: EINVAL: invalid argument, readlink '/tmp/f.txt'\nreadlink: ENOENT: no such file or directory, readlink '/tmp/nope'\nreadlink: ENOENT: no such file or directory, realpath '/tmp/nope'\n",
    );
  });

  it("12. realpath missing operand, unrecognized option, -e realpath ENOENT, and -s/-L stat ENOENT diagnostics", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/f.txt": "hello\n" },
    });
    const r = await h.exec(
      "realpath; echo RC1=$?; realpath --bogus; echo RC2=$?; realpath -e /tmp/nope; echo RC3=$?; realpath -s -e /tmp/nope; echo RC4=$?; realpath -L /tmp/nope/..; echo RC5=$?; realpath -m /tmp/nope/sub/../leaf",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "RC1=2\nRC2=2\nRC3=1\nRC4=1\nRC5=1\n/tmp/nope/leaf\n");
    assert.equal(
      r.stderr,
      "realpath: missing operand\nrealpath: unrecognized option '--bogus'\nrealpath: ENOENT: no such file or directory, realpath '/tmp/nope'\nrealpath: ENOENT: no such file or directory, stat '/tmp/nope'\nrealpath: ENOENT: no such file or directory, stat '/tmp/nope'\n",
    );
  });

  it("13. du --help, --version, invalid -d/--max-depth, and missing operand ENOENT suppressing --total", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/d/a.txt": "hello\n" },
    });
    const r = await h.exec(
      "du --help | head -n 3; du --version; du -d abc; echo RC1=$?; du --max-depth=xyz; echo RC2=$?; du -c /tmp/nope; echo RC3=$?; du -b -s /tmp/d",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "Usage: du [OPTION]... [--] [FILE]...\nReport provider allocation; unknown allocation is an error, never logical size.\n  -a, --all                 report files as well as directories\ndu (safe-bash virtual implementation)\nRC1=1\nRC2=1\nRC3=1\n6\t/tmp/d\n",
    );
    assert.equal(
      r.stderr,
      "du: invalid maximum depth 'abc'\ndu: invalid maximum depth 'xyz'\ndu: \"/tmp/nope\": no such file or directory, lstat '/tmp/nope'\n",
    );
  });

  it("14. df --help, --version, and -P portability header", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec("df --help | head -n 3; df --version; df -P / | head -n 1");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "Usage: df [OPTION]... [FILE]...\nShow information about the file system on which each FILE resides,\nor all file systems by default (Sandbox VFS-ish/GNU).\ndf (Sandbox VFS-ish/GNU coreutils) 9.7\nPackaged by Safe-Bash (Sandbox VFS-ish/GNU runtime)\nFilesystem     1024-blocks  Used Available Capacity Mounted on\n",
    );
    assert.equal(r.stderr, "");
  });

  it("15. mktemp template X validation, -q quiet suppression on missing parent, and -d directory creation", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      "mktemp -u /tmp/badXX; echo RC1=$?; mktemp -q /tmp/no_parent/tmp.XXXXXX; echo RC2=$?; d=$(mktemp -d /tmp/work.XXXXXX) && test -d \"$d\" && echo OK",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "RC1=1\nRC2=1\nOK\n");
    assert.equal(
      r.stderr,
      "mktemp: template must contain at least three consecutive X characters in its last component\n",
    );
  });

  it("16. tree --help, --version, invalid -L, unsupported long/short options, and missing root operand diagnostic", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      "tree --help | head -n 3; tree --version; tree -L 0; echo RC1=$?; tree --bogus; echo RC2=$?; tree -Z; echo RC3=$?; tree /tmp/nope; echo RC4=$?",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "Usage: tree [-adlfirnJvU] [-L depth] [-P pattern] [-I pattern] [--dirsfirst]\n            [--sort=name|version|none] [--filelimit=number]\n            [--charset=ASCII|US-ASCII|UTF-8|UTF8] [--noreport] [--] [path ...]\ntree (virtual-bash bounded profile) 1\nRC1=2\nRC2=2\nRC3=2\n/tmp/nope  [no such file or directory, lstat '/tmp/nope']\n\n0 directories, 0 files\nRC4=1\n",
    );
    assert.equal(
      r.stderr,
      "tree: -L must be between 1 and Infinity\ntree: unsupported option: --bogus\ntree: unsupported option: -Z\ntree: /tmp/nope: no such file or directory, lstat '/tmp/nope'\n",
    );
  });

  it("17. tree -J JSON output on missing root operand and valid directory tree", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/t/sub/a.txt": "a\n" },
    });
    const r = await h.exec("tree -J -i /tmp/nope; echo RC1=$?; tree -J -i --noreport /tmp/t");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "[{\"type\":\"unknown\",\"name\":\"/tmp/nope\",\"error\":\"no such file or directory, lstat '/tmp/nope'\"},{\"type\":\"report\",\"directories\":0,\"files\":0}]\nRC1=1\n[{\"type\":\"directory\",\"name\":\"/tmp/t\",\"contents\":[{\"type\":\"directory\",\"name\":\"sub\",\"contents\":[{\"type\":\"file\",\"name\":\"a.txt\"}]}]}]\n",
    );
    assert.equal(r.stderr, "tree: /tmp/nope: no such file or directory, lstat '/tmp/nope'\n");
  });

  it("18. file missing operand, missing file message, and MIME/brief detection", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/data.json": "{\"a\":1}\n" },
    });
    const r = await h.exec(
      "file; echo RC1=$?; file /tmp/nope; echo RC2=$?; file -b --mime-type /tmp/data.json",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "RC1=2\n/tmp/nope: cannot open `/tmp/nope' (No such file or directory)\nRC2=0\napplication/json\n",
    );
    assert.equal(r.stderr, "file: missing file operand (use '-' for stdin)\n");
  });

  it("19. cp --backup=numbered and mv --backup=numbered preserve numbered backups", async () => {
    const h = await SafeBashE2EHarness.create({
      files: { "/tmp/a.txt": "v1\n", "/tmp/b.txt": "v2\n", "/tmp/c.txt": "v3\n" },
    });
    const r = await h.exec(
      "cp --backup=numbered /tmp/b.txt /tmp/a.txt && mv --backup=numbered /tmp/c.txt /tmp/a.txt && cat /tmp/a.txt /tmp/a.txt.~1~ /tmp/a.txt.~2~",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "v3\nv1\nv2\n");
    assert.equal(r.stderr, "");
  });

  it("20. symlink loop ELOOP diagnostic in realpath and readlink -v -f", async () => {
    const h = await SafeBashE2EHarness.create({
      symlinks: { "/tmp/loop1": "/tmp/loop2", "/tmp/loop2": "/tmp/loop1" },
    });
    const r = await h.exec(
      "realpath /tmp/loop1; echo RC1=$?; readlink -v -f /tmp/loop1; echo RC2=$?",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "RC1=1\nRC2=1\n");
    assert.equal(
      r.stderr,
      "realpath: ELOOP: too many symbolic links encountered '/tmp/loop1'\nreadlink: ELOOP: too many symbolic links encountered '/tmp/loop1'\n",
    );
  });
});
