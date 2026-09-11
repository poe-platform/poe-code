# Portable agent preset contract

## Entry points and inventory

The standalone entry is `@poe-platform/safe-bash/portable`; the bundled entry is
`poe-code/safe-bash/portable`. Both expose `portableAgentCommands`, the immutable
`portableAgentCommandNames` inventory, `PortableAgentCommandsOptions`, and the
existing browser shell, filesystem and regex-provider APIs.

Check the installed package version before using newly added options or entries.
Source implementation and packed-consumer validation alone do not establish a
published release of a change.

The complete preset targets workerd with `nodejs_compat` and equivalent compatible
runtimes. Compression, archives, checksums and timers use supported pure Node
builtins. It does not promise a zero-Node-builtins browser runtime. The separate
`/browser` entry retains its original lightweight, polyfill-free builtin contract.

The authoritative inventory is `portableAgentCommandNames`: the same 91 default
commands as `agentCommands`, without duplicate registration. It includes standard
filesystem and stream tools, find, sed/awk, jq, search, byte encoders and checksums,
compression, diff/patch, metadata, tar, zip/unzip, table and stream formatting, splitting,
time/environment tools, tree/file, aliases, column, HTML conversion, du, expr,
which, timeout and apply_patch. It excludes curl, node and safejs; these remain
separate explicit capability opt-ins. Existing Node `agentCommands` and
`createAgentCommands` APIs remain available and retain their options and independent
regex pools for grep, the egrep/fgrep family, expr and search. Portable composition
shares its owned executor endpoints instead. The `/browser` and `/portable`
public entries share one runtime, so their Shell and portable preset can compose
without duplicating argument ownership identities.

## Configuration

```ts
import {
  Shell, MemoryFileSystem, portableAgentCommands,
} from "@poe-platform/safe-bash/portable";

const shell = new Shell({ fs: new MemoryFileSystem() }).use(
  portableAgentCommands(),
);
try {
  await shell.exec("printf 'one\\ntwo\\n' | fgrep two");
} finally {
  await shell.dispose();
}
```

`provider` is optional. Omission constructs the existing bounded cooperative ERE
provider for that preset; a supplied provider overrides it. Invalid supplied
providers are rejected rather than silently replaced. Every `AgentCommandsOptions`
field is supported, including
family limits, `execution`, `execute`, `replace`, stream/directory limits and
`regex`. `search.regex`, when supplied, configures a separate executor using the
same selected provider; otherwise search shares the preset executor and `regex`
policy. Registration checks all collisions before modifying the host registry.
There are no new environment variables, implicit host filesystem capabilities,
network authorizations or native process fallbacks.

The explicit host-specific entry `@poe-platform/safe-bash/node` (or
`poe-code/safe-bash/node`) preserves the existing Node-root exports and adds
`createNodeRegexProvider`. Inject that provider when the portable preset needs
the existing Node worker-thread regex behavior:

```ts
import { createNodeRegexProvider } from "@poe-platform/safe-bash/node";

const plugin = portableAgentCommands({ provider: createNodeRegexProvider() });
```

Use Shell and legacy Node command factories together from `/node`; injecting its
provider into the portable preset is the supported cross-entry override. The
ordinary root preset remains unchanged in this additive stage. The broader
portable-default root transition and its breaking-version boundary are tracked
in `docs/plans/issue-669-portable-default-api.md` at the repository root.

## Regex capability and lifetime

grep, rg, egrep, fgrep and expr matching all use the selected provider. sed and awk
retain their independently bounded cooperative implementations. The built-in
`createBoundedRegexProvider` is a restricted cooperative implementation, not a
native-worker, wall-clock-preemption or RSS-isolation guarantee.

Its supported modes include restricted ASCII grep BRE/ERE patterns over valid
non-NUL UTF-8 subjects, fixed non-NUL UTF-8
matching, bounded grep `-o` extraction, and conservative ASCII BRE expr matching with anchored match lengths
and bounded captures. Its unsupported modes include non-ASCII/NUL expr inputs, rg regex and
glob descriptors, word selection, rg case modes and rg all-match enumeration.
Unsupported requests fail at provider admission with explicit diagnostics and
nonzero status, without executing an unbounded regex or falling back to Node.
For example `expr aa : 'a*'` prints `2`, while `expr abc : 'a\(.\)c'` prints `b`;
unsupported BRE extensions such as `\w` fail explicitly. `expr 2 + 3` still works.
For grep regex subjects, `.` consumes one Unicode scalar, positive ASCII
classes remain ASCII-only, and complemented classes include non-ASCII scalars.
Output and match offsets preserve the original bytes. This profile is unchanged
by `LC_ALL=C`, performs no normalization or Unicode folding, and rejects non-ASCII
regex patterns, invalid UTF-8 and NUL subjects. Expr retains its separate ASCII
restriction. See `PORTABLE_SEARCH.md` for the full matching and budget profile.
Grep `-i` supports ASCII A–Z/a–z equivalence for fixed, BRE and ERE patterns,
with or without `-o`, while preserving original output bytes and case. Bracket
classes include both ASCII cases before complementing. Non-ASCII fixed literals
still compare exactly; for example, `é` and `É` are distinct.
Plain grep also accepts escaped basic metacharacters such as `\.` and `\*`,
and treats unescaped `+?(){}|` as literals. Bracket members retain bracket
semantics. Escaped BRE groups, intervals, extended operators and backreferences
remain unsupported; `grep -E` retains its separate extended grammar.
A different host provider may implement more descriptors
while respecting the existing bounded request/reply and retirement contracts.

The plugin owns its executor(s) and their endpoints, not an injected provider
object or another preset's endpoints. Shared providers remain caller-owned and
can be reused after one preset is disposed. Shell disposal
awaits plugin disposal; direct plugin hosts must call and await `dispose`, even
after failed installation. Disposal is idempotent, rejects further regex work and
setup, and awaits worker retirement. Each command also closes its invocation
session through the existing cleanup barrier. There is deliberately no exported
definitions-only portable factory with an invisible disposal obligation.

## Public-runtime family matrix

Use a fresh MemoryFileSystem and Shell for each row, with
`portableAgentCommands({ provider: createBoundedRegexProvider() })`. Each row is
`[family, source, expectedStdout]`; expect exit code 0 and empty stderr. Always
await shell disposal. These exact 33 rows pass in the local preset tests; root
executes them separately against the actual packed standalone entry in workerd
with `nodejs_compat`. Local results are not a workerd acceptance claim.

```json
[
  ["basic","printf 'ok\\n'","ok\n"],
  ["filesystem","mkdir /files && printf hi > /files/a && cp /files/a /files/b && cat /files/b","hi"],
  ["streams","printf 'first\\nsecond\\n' | head -n 1","first\n"],
  ["text","printf 'b\\na\\n' | sort | cut -c 1","a\nb\n"],
  ["predicates","test 2 -gt 1 && echo yes","yes\n"],
  ["execution","env printf 'env\\n'","env\n"],
  ["execution-xargs","printf '\"1+1\"' | xargs jq -nc","2\n"],
  ["find","printf text > /input && find /input -type f","/input\n"],
  ["text-programs","printf 'hello\\n' | sed 's/hello/world/' | awk '{print $1}'","world\n"],
  ["structured","jq -nc '1+1'","2\n"],
  ["search","printf 'aa\\nbb\\n' | rg -F aa","aa\n"],
  ["grep","printf 'aa\\nbb\\n' | grep -E 'a+'","aa\n"],
  ["grep-aliases","printf 'aa\\nbb\\n' | egrep 'a+' | fgrep aa","aa\n"],
  ["bytes-encoding","printf abc | base64 | base64 -d","abc"],
  ["bytes-checksums","printf abc | sha256sum","ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  -\n"],
  ["bytes-compression","printf 'compressed\\n' | gzip -c | gunzip -c","compressed\n"],
  ["diff-patch","printf 'before\\n' > /old && printf 'after\\n' > /new && diff -u /old /new | patch -s /old && cat /old","after\n"],
  ["metadata","printf x > /mode && chmod 600 /mode && stat -c '%a' /mode","600\n"],
  ["archive","mkdir /archive-in /archive-out && printf payload > /archive-in/item && tar -cf - -C /archive-in item | tar -xf - -C /archive-out && cat /archive-out/item","payload"],
  ["table-text","printf 'a\\nb\\n' | paste -sd, -","a,b\n"],
  ["stream-inspection","printf 'a\\nb\\n' | tac","b\na\n"],
  ["stream-format","seq 2 3","2\n3\n"],
  ["split","printf abcd | split -b 2 - /piece- && cat /piece-aa /piece-ab","abcd"],
  ["time-env","env PORTABLE=value printenv PORTABLE","value\n"],
  ["tree","mkdir /tree && touch /tree/item && tree -if --noreport /tree","/tree\n/tree/item\n"],
  ["file","printf 'plain text\\n' > /plain && file -bi /plain","text/plain; charset=us-ascii\n"],
  ["column","printf 'a b\\nc d\\n' | column -t","a  b\nc  d\n"],
  ["html-to-markdown","printf '<h1>Hello</h1>' | html-to-markdown","# Hello\n"],
  ["du","printf abc > /size && du -b /size","3\t/size\n"],
  ["expr","expr 2 + 3","5\n"],
  ["which","mkdir /tools && printf x > /tools/run && chmod +x /tools/run && env PATH=/tools which run","/tools/run\n"],
  ["timeout","timeout 1 echo done","done\n"],
  ["apply-patch","printf '%s\\n' '*** Begin Patch' '*** Add File: /added' '+ready' '*** End Patch' | apply_patch && cat /added","Success. Updated the following files:\nA /added\nready\n"]
]
```

The separate binary controls expect `Uint8Array.of(0, 255, 65)` through
`printf '\000\377A' | base64 | base64 -d | gzip -c | gunzip -c` and through
a tar VFS round trip. Expr controls require `expr aa : 'a*'` to print `2` and exit 0.
Unsupported-mode controls require empty stdout and exit 2
for `expr aa : '\w'` and `printf 'aa\n' | rg 'a+'`, with an explicit
unsupported diagnostic rather than native fallback.
