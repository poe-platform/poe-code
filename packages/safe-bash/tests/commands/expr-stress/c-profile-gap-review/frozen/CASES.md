# Exact frozen observations

Derived without execution from CASE_MATRIX.json. JSON strings below are escaped display, not shell commands. Every tuple includes status and exact stdout/stderr UTF-8 strings and hex bytes; empty strings/hex mean zero bytes. No newline or pathname normalization. Full provenance, argv hex, explicit environments and native identity are in the matrix.

## nullable (8)

### nullable-separate/empty

Classification: semantic failure.

argv: ["+","",":","\\(a*\\)*\\1"]

Virtual environment: {"LC_ALL":"C"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=1; stdout="\n"; stderr=""

expected bytes: stdout hex="0a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: unsupported BRE: backreference to a capture in nullable repetition\n"

actual bytes: stdout hex=""; stderr hex="657870723a20756e737570706f72746564204252453a206261636b7265666572656e636520746f2061206361707475726520696e206e756c6c61626c652072657065746974696f6e0a"

### nullable-separate/a

Classification: semantic failure.

argv: ["+","a",":","\\(a*\\)*\\1"]

Virtual environment: {"LC_ALL":"C"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=1; stdout="\n"; stderr=""

expected bytes: stdout hex="0a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: unsupported BRE: backreference to a capture in nullable repetition\n"

actual bytes: stdout hex=""; stderr hex="657870723a20756e737570706f72746564204252453a206261636b7265666572656e636520746f2061206361707475726520696e206e756c6c61626c652072657065746974696f6e0a"

### nullable-separate/aa

Classification: semantic failure.

argv: ["+","aa",":","\\(a*\\)*\\1"]

Virtual environment: {"LC_ALL":"C"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=0; stdout="a\n"; stderr=""

expected bytes: stdout hex="610a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: unsupported BRE: backreference to a capture in nullable repetition\n"

actual bytes: stdout hex=""; stderr hex="657870723a20756e737570706f72746564204252453a206261636b7265666572656e636520746f2061206361707475726520696e206e756c6c61626c652072657065746974696f6e0a"

### nullable-separate/aaa

Classification: semantic failure.

argv: ["+","aaa",":","\\(a*\\)*\\1"]

Virtual environment: {"LC_ALL":"C"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=1; stdout="\n"; stderr=""

expected bytes: stdout hex="0a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: unsupported BRE: backreference to a capture in nullable repetition\n"

actual bytes: stdout hex=""; stderr hex="657870723a20756e737570706f72746564204252453a206261636b7265666572656e636520746f2061206361707475726520696e206e756c6c61626c652072657065746974696f6e0a"

### nullable-separate/no-reference

Classification: control.

argv: ["+","aaa",":","\\(a*\\)*"]

Virtual environment: {"LC_ALL":"C"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=0; stdout="aaa\n"; stderr=""

expected bytes: stdout hex="6161610a"; stderr hex=""

actual: status=0; stdout="aaa\n"; stderr=""

actual bytes: stdout hex="6161610a"; stderr hex=""

### nullable-separate/not-repeated

Classification: control.

argv: ["+","aaa",":","\\(a*\\)\\1"]

Virtual environment: {"LC_ALL":"C"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=0; stdout="a\n"; stderr=""

expected bytes: stdout hex="610a"; stderr hex=""

actual: status=0; stdout="a\n"; stderr=""

actual bytes: stdout hex="610a"; stderr hex=""

### nullable-separate/nonnullable

Classification: control.

argv: ["+","aaa",":","\\(a\\)*\\1"]

Virtual environment: {"LC_ALL":"C"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=0; stdout="a\n"; stderr=""

expected bytes: stdout hex="610a"; stderr hex=""

actual: status=0; stdout="a\n"; stderr=""

actual bytes: stdout hex="610a"; stderr hex=""

### nullable-separate/mandatory-empty

Classification: semantic failure.

argv: ["+","",":","\\(a*\\)\\{2\\}\\1"]

Virtual environment: {"LC_ALL":"C"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=1; stdout="\n"; stderr=""

expected bytes: stdout hex="0a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: unsupported BRE: backreference to a capture in nullable repetition\n"

actual bytes: stdout hex=""; stderr hex="657870723a20756e737570706f72746564204252453a206261636b7265666572656e636520746f2061206361707475726520696e206e756c6c61626c652072657065746974696f6e0a"

## namedLocale (10)

### original95/gnu-9.7-darwin-en_US.UTF-8/unicode-length

Classification: semantic failure.

argv: ["length","Aé😀é"]

Virtual environment: {"LC_ALL":"en_US.UTF-8","PATH":"/usr/bin:/bin","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"en_US.UTF-8","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=0; stdout="5\n"; stderr=""

expected bytes: stdout hex="350a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: character operations require C/POSIX or C.UTF-8/C.utf8 locale\n"

actual bytes: stdout hex=""; stderr hex="657870723a20636861726163746572206f7065726174696f6e73207265717569726520432f504f534958206f7220432e5554462d382f432e75746638206c6f63616c650a"

### original95/gnu-9.7-darwin-en_US.UTF-8/unicode-substr

Classification: semantic failure.

argv: ["substr","Aé😀Z","3","1"]

Virtual environment: {"LC_ALL":"en_US.UTF-8","PATH":"/usr/bin:/bin","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"en_US.UTF-8","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=0; stdout="😀\n"; stderr=""

expected bytes: stdout hex="f09f98800a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: character operations require C/POSIX or C.UTF-8/C.utf8 locale\n"

actual bytes: stdout hex=""; stderr hex="657870723a20636861726163746572206f7065726174696f6e73207265717569726520432f504f534958206f7220432e5554462d382f432e75746638206c6f63616c650a"

### original95/gnu-9.7-darwin-en_US.UTF-8/unicode-index

Classification: semantic failure.

argv: ["index","Aé😀Z","Z😀"]

Virtual environment: {"LC_ALL":"en_US.UTF-8","PATH":"/usr/bin:/bin","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"en_US.UTF-8","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=0; stdout="3\n"; stderr=""

expected bytes: stdout hex="330a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: character operations require C/POSIX or C.UTF-8/C.utf8 locale\n"

actual bytes: stdout hex=""; stderr hex="657870723a20636861726163746572206f7065726174696f6e73207265717569726520432f504f534958206f7220432e5554462d382f432e75746638206c6f63616c650a"

### original95/gnu-9.7-darwin-en_US.UTF-8/unicode-regex-dot

Classification: semantic failure.

argv: ["é😀",":","."]

Virtual environment: {"LC_ALL":"en_US.UTF-8","PATH":"/usr/bin:/bin","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"en_US.UTF-8","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=0; stdout="1\n"; stderr=""

expected bytes: stdout hex="310a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: character operations require C/POSIX or C.UTF-8/C.utf8 locale\n"

actual bytes: stdout hex=""; stderr hex="657870723a20636861726163746572206f7065726174696f6e73207265717569726520432f504f534958206f7220432e5554462d382f432e75746638206c6f63616c650a"

### original95/gnu-9.7-darwin-en_US.UTF-8/unicode-capture

Classification: semantic failure.

argv: ["é😀",":","\\(.\\)"]

Virtual environment: {"LC_ALL":"en_US.UTF-8","PATH":"/usr/bin:/bin","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"en_US.UTF-8","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=0; stdout="é\n"; stderr=""

expected bytes: stdout hex="c3a90a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: character operations require C/POSIX or C.UTF-8/C.utf8 locale\n"

actual bytes: stdout hex=""; stderr hex="657870723a20636861726163746572206f7065726174696f6e73207265717569726520432f504f534958206f7220432e5554462d382f432e75746638206c6f63616c650a"

### original95/gnu-9.7-darwin-en_US.UTF-8/unicode-combining-not-graphemes

Classification: semantic failure.

argv: ["length","é"]

Virtual environment: {"LC_ALL":"en_US.UTF-8","PATH":"/usr/bin:/bin","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"en_US.UTF-8","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=0; stdout="2\n"; stderr=""

expected bytes: stdout hex="320a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: character operations require C/POSIX or C.UTF-8/C.utf8 locale\n"

actual bytes: stdout hex=""; stderr hex="657870723a20636861726163746572206f7065726174696f6e73207265717569726520432f504f534958206f7220432e5554462d382f432e75746638206c6f63616c650a"

### original95/gnu-9.7-darwin-en_US.UTF-8/unicode-collation

Classification: semantic failure.

argv: ["é","<","z"]

Virtual environment: {"LC_ALL":"en_US.UTF-8","PATH":"/usr/bin:/bin","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"en_US.UTF-8","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=0; stdout="1\n"; stderr=""

expected bytes: stdout hex="310a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: string comparison requires C/POSIX or C.UTF-8/C.utf8 byte collation\n"

actual bytes: stdout hex=""; stderr hex="657870723a20737472696e6720636f6d70617269736f6e20726571756972657320432f504f534958206f7220432e5554462d382f432e75746638206279746520636f6c6c6174696f6e0a"

### extension-original20/gnu-9.7-darwin-en_US.UTF-8/utf8-whole-prefix-span

Classification: semantic failure.

argv: ["Aé😀Z",":","A.."]

Virtual environment: {"LC_ALL":"en_US.UTF-8","PATH":"/usr/bin:/bin","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"en_US.UTF-8","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=0; stdout="3\n"; stderr=""

expected bytes: stdout hex="330a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: character operations require C/POSIX or C.UTF-8/C.utf8 locale\n"

actual bytes: stdout hex=""; stderr hex="657870723a20636861726163746572206f7065726174696f6e73207265717569726520432f504f534958206f7220432e5554462d382f432e75746638206c6f63616c650a"

### extension-original20/gnu-9.7-darwin-en_US.UTF-8/utf8-shifted-first-span

Classification: semantic failure.

argv: ["Aé😀Z",":","Aé\\(.\\)"]

Virtual environment: {"LC_ALL":"en_US.UTF-8","PATH":"/usr/bin:/bin","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"en_US.UTF-8","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=0; stdout="😀\n"; stderr=""

expected bytes: stdout hex="f09f98800a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: character operations require C/POSIX or C.UTF-8/C.utf8 locale\n"

actual bytes: stdout hex=""; stderr hex="657870723a20636861726163746572206f7065726174696f6e73207265717569726520432f504f534958206f7220432e5554462d382f432e75746638206c6f63616c650a"

### extension-original20/gnu-9.7-darwin-en_US.UTF-8/combining-first-span

Classification: semantic failure.

argv: ["éZ",":","\\(e.\\)"]

Virtual environment: {"LC_ALL":"en_US.UTF-8","PATH":"/usr/bin:/bin","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"en_US.UTF-8","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=0; stdout="é\n"; stderr=""

expected bytes: stdout hex="65cc810a"; stderr hex=""

actual: status=2; stdout=""; stderr="expr: character operations require C/POSIX or C.UTF-8/C.utf8 locale\n"

actual bytes: stdout hex=""; stderr hex="657870723a20636861726163746572206f7065726174696f6e73207265717569726520432f504f534958206f7220432e5554462d382f432e75746638206c6f63616c650a"

## cDiagnostics (9)

### original95/gnu-9.7-darwin-C/ambiguous-index-keyword

Classification: diagnostic difference.

argv: ["index","index","a"]

Virtual environment: {"LC_ALL":"C","PATH":"/usr/bin:/bin","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=2; stdout=""; stderr="expr: syntax error: missing argument after 'a'\n"

expected bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a206d697373696e6720617267756d656e74206166746572202761270a"

actual: status=2; stdout=""; stderr="expr: syntax error: missing operand\n"

actual bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a206d697373696e67206f706572616e640a"

### original95/gnu-9.7-darwin-C/missing-operands

Classification: diagnostic difference.

argv: []

Virtual environment: {"LC_ALL":"C","PATH":"/usr/bin:/bin","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=2; stdout=""; stderr="expr: missing operand\nTry 'expr --help' for more information.\n"

expected bytes: stdout hex=""; stderr hex="657870723a206d697373696e67206f706572616e640a547279202765787072202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"

actual: status=2; stdout=""; stderr="expr: syntax error: missing operand\n"

actual bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a206d697373696e67206f706572616e640a"

### original95/gnu-9.7-darwin-C/missing-rhs

Classification: diagnostic difference.

argv: ["1","+"]

Virtual environment: {"LC_ALL":"C","PATH":"/usr/bin:/bin","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=2; stdout=""; stderr="expr: syntax error: missing argument after '+'\n"

expected bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a206d697373696e6720617267756d656e7420616674657220272b270a"

actual: status=2; stdout=""; stderr="expr: syntax error: missing operand\n"

actual bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a206d697373696e67206f706572616e640a"

### original95/gnu-9.7-darwin-C/missing-close

Classification: diagnostic difference.

argv: ["(","1","+","2"]

Virtual environment: {"LC_ALL":"C","PATH":"/usr/bin:/bin","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=2; stdout=""; stderr="expr: syntax error: expecting ')' after '2'\n"

expected bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a20657870656374696e6720272927206166746572202732270a"

actual: status=2; stdout=""; stderr="expr: syntax error: expecting ')'\n"

actual bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a20657870656374696e67202729270a"

### original95/gnu-9.7-darwin-C/trailing-token

Classification: diagnostic difference.

argv: ["1","2"]

Virtual environment: {"LC_ALL":"C","PATH":"/usr/bin:/bin","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=2; stdout=""; stderr="expr: syntax error: unexpected argument '2'\n"

expected bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a20756e657870656374656420617267756d656e74202732270a"

actual: status=2; stdout=""; stderr="expr: syntax error: unexpected argument\n"

actual bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a20756e657870656374656420617267756d656e740a"

### original95/gnu-9.7-darwin-C/skip-still-requires-rhs

Classification: diagnostic difference.

argv: ["kept","|","1","+"]

Virtual environment: {"LC_ALL":"C","PATH":"/usr/bin:/bin","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=2; stdout=""; stderr="expr: syntax error: missing argument after '+'\n"

expected bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a206d697373696e6720617267756d656e7420616674657220272b270a"

actual: status=2; stdout=""; stderr="expr: syntax error: missing operand\n"

actual bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a206d697373696e67206f706572616e640a"

### original95/gnu-9.7-darwin-C/skip-still-requires-close

Classification: diagnostic difference.

argv: ["0","&","(","1"]

Virtual environment: {"LC_ALL":"C","PATH":"/usr/bin:/bin","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=2; stdout=""; stderr="expr: syntax error: expecting ')' after '1'\n"

expected bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a20657870656374696e6720272927206166746572202731270a"

actual: status=2; stdout=""; stderr="expr: syntax error: expecting ')'\n"

actual bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a20657870656374696e67202729270a"

### original95/gnu-9.7-darwin-C/skip-still-requires-keyword-args

Classification: diagnostic difference.

argv: ["kept","|","substr","abc","1"]

Virtual environment: {"LC_ALL":"C","PATH":"/usr/bin:/bin","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=2; stdout=""; stderr="expr: syntax error: missing argument after '1'\n"

expected bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a206d697373696e6720617267756d656e74206166746572202731270a"

actual: status=2; stdout=""; stderr="expr: syntax error: missing operand\n"

actual bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a206d697373696e67206f706572616e640a"

### extension-original20/gnu-9.7-darwin-C/class-parenthesis-not-capture

Classification: diagnostic difference.

argv: ["(",":","[(]"]

Virtual environment: {"LC_ALL":"C","PATH":"/usr/bin:/bin","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native environment: {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}

Native executable: /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr; argv0="expr"

expected: status=2; stdout=""; stderr="expr: syntax error: expecting ')' instead of '[(]'\n"

expected bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a20657870656374696e672027292720696e7374656164206f6620275b285d270a"

actual: status=2; stdout=""; stderr="expr: syntax error: expecting ')'\n"

actual bytes: stdout hex=""; stderr hex="657870723a2073796e746178206572726f723a20657870656374696e67202729270a"

## Separate quoted-parenthesis correction (not a replacement)

argv=["+","(",":","[(]"]; expected and actual status=0, stdout="1\n", stderr="". GNU correction 1/1 remains outside original104 and extension23. Apple counterpart remains separately recorded in the matrix.
