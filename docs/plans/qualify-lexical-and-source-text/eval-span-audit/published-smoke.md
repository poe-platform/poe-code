# Published lexical artifact verification

Run these checks independently for each exact published package/version. Record each command, exit code, runtime/ICU, output and failure in the publication receipt. A failed setup or unavailable registry version is a failed attempt; retry it without erasing the earlier observation.

## Installation and provenance

1. Create a separate temporary consumer with a private package manifest for each package.
2. Install the exact registry name/version using `npm install --prefer-online --ignore-scripts --no-audit --no-fund <name>@<version>`.
3. Download the exact-version metadata and tarball. Match its SHA-512 SRI and SHA-1. Match the SLSA subject digest to those same bytes, verify the repository/workflow and prove the provenance commit contains the source repair with `git merge-base --is-ancestor`.
4. Run `npm audit signatures` in that consumer and retain the signature/attestation counts.
5. Exercise each installed public API on Node 22.23.2 and Node 18.18.0. Also exercise SafeJS on the recorded Bun runtime. Resolve imports from the consumer, not the repository.

## SafeJS public API

Use `@poe-platform/safe-js`, or `poe-code/safe-js` for the umbrella consumer.

- For LF, CR, CRLF, LS and PS, run direct and indirect eval of `// 😀` followed by the terminator and `const x=)`. Require SyntaxError, filename `<eval>`, line 2, column 9, UTF-16 offset equal to prefix length plus 8, and the original invalid declaration in the excerpt.
- Reject a regexp literal containing each actual terminator inside its character class. The constructor/string-escape neighboring forms remain valid.
- Run `var x;do break;while(0)x=42;let y=8;y/=2;return [x,y,/=/.test("=")]`. Require `[42,4,true]`.
- Pass an invalid tagged-template escape consisting of backslash plus `xZ` to a tag that returns its raw and cooked values. Require raw backslash-plus-xZ and cooked undefined.
- Require `typeof process`, `typeof require` and `typeof fetch` all to be `undefined` without host bindings.
- Run 1,024 opening parentheses, `1`, then 1,024 closing parentheses with filename `guest.ajs`. Require bounded rejection carrying that filename and a header-only stack. The shallow `return (((1+2)))` neighbor returns 3.
- Run `/a` + CRLF + `/` with `new Budget({stringLength:2})`. Require `SandboxError`, code `budgetExceeded`, budget `stringLength`, current 3 and limit 2. The `/a/` neighbor succeeds under a fresh identical budget.
- For every terminator, lint `// 😀` + terminator + `/[` + terminator + `]/`, with filename `guest.ajs`, both normal and fix modes. Require ParseError, line 2/column 3, original filename and header-only stack. Invalid source must not be rewritten.

## Published CLI and Workerd

1. Discover the SafeJS CLI path from the installed package's bin manifest. Invoke it on a relative `broken.ajs` containing `/a` + CRLF + `/`. Require parse exit 2, `broken.ajs:1:3`, both original source lines, and no resolved consumer/host pathname in the diagnostic. Repeat with `--fix`, without allowing a write of invalid source.
2. For the public Workerd subpath, use workerd 1.20260911.1 and the recorded neutral/ESM/workerd bundle conditions. Bind only an explicit loopback socket. Repeat the five eval-coordinate controls and the `[42,4,true]` ASI/division/regexp control. Record the actual HTTP response and stop the process. The Workerd entry has no public lint export; do not invent one or count missing authority as ECMAScript failure.

## SafeFS and Safe Bash

- In the independently installed SafeFS consumer, create its memory filesystem, write UTF-8 `verified` to `/lexical.txt`, read it back and require the same text.
- In the independently installed Safe Bash consumer, construct its memory filesystem and shell with the exported agent commands, execute `printf lexical`, and require exit 0 and stdout `lexical`. Dispose the shell afterward.

These focused artifact controls do not replace the pinned Test262 corpus or its unchanged deadlines. Record partial publication per package and follow failed or superseded GitHub runs to a verified descendant before claiming release completion.
