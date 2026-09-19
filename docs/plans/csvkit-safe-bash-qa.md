# csvkit 2.2.0 safe-bash QA

This is an agent-executed procedure, not a QA program. Execute each step against
the current built engine and record exact input/output bytes, stderr, status,
filesystem changes and database/interpreter effects in `docs/csvkit`. Temporary
captures belong in an owned directory under `out`; remove that directory after
reducing the results. Preserve existing edits, staging and evidence. Do not
commit, push, publish or add README content.

## Reference and admission

1. Read root and scoped AGENTS.md. Use a different agent to stress/fix implemented
   tools; root owns integration, exports and Git. Require a failing original
   regression before each code fix. Canonical tests use in-memory inputs/memfs;
   they create no host files and launch no native programs or network requests.
2. Authenticate the csvkit 2.2.0 source archive against SHA-256
   `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
   Use `docs/csvkit/reference-profile.json` and the frozen dependency requirements,
   source manifest and requalification records. Select the CPython 3.14.2 profile
   explicitly: Agate 1.14.2, SQLAlchemy 2.0.54, C process locale, en_US typed
   number locale, UTC, UTF-8, width 80. Do not combine another profile's observations.
   CPython 3.9.6 quoting choices differ. Optional drivers, IPython and TTY profiles
   require separately measured evidence; absent profiles remain blockers.
3. Inspect actual public exports and bind codecs, locale, clock and terminal
   capabilities explicitly. Register the fourteen original executable names using
   `csvkitCommands`; never introduce a `csvkit` subcommand or product subprocess.
   Use the actual safe-bash registry and `CommandContext.invoke(name, argv)` for
   direct argv execution. Then run the equivalent command from a VFS `.sh` file
   through `sh FILE`. A string joined from argv is not direct argv evidence.

## Required memory workflows

4. Seed an in-memory `/work` with `input data.csv` containing
   `name,amount\nA,10\nB,1\nA,2\n`, two id-keyed join inputs and a malformed
   `broken.csv`. Preserve byte snapshots of every source. Run direct argv stages
   and a VFS script containing:

   ```sh
   file='input data.csv'
   csvcut -c name,amount "$file" | csvgrep -c name -m A | csvsort -c amount | csvlook
   printf '%s\n' "${PIPESTATUS[*]}"
   csvclean --length-mismatch broken.csv 2> errors.csv | csvformat -T > cleaned.tsv
   printf '%s\n' "${PIPESTATUS[*]}"
   csvformat -T "$file" > output.tsv
   csvformat -A "$file" > output.asv
   csvjoin -c id one.csv two.csv > joined.csv
   csvstack --filenames one.csv two.csv > stacked.csv
   csvjson --stream -I -y 0 "$file" > rows.jsonl
   csvstat --json "$file" > statistics.json
   ```

   Compare exact channels, statuses and effects with isolated reference captures.
   Capture PIPESTATUS immediately: the valid pipeline is `0 0 0 0`; malformed
   csvclean followed by a successful formatter is `1 0` even when pipeline status
   is zero. Verify quoted filename expansion, numeric rather than lexical sort,
   raw JSON strings with inference disabled, typed statistics, LF/tab/ASV bytes,
   join duplicate id columns and stack filename labels. Snapshot all directory
   entries; csvclean 2.2.0 emits errors on stderr and must not silently invent
   legacy `_out.csv`/`_err.csv` files.
5. Supply a checksum-bound XLSX fixture from the frozen captures as a VFS file.
   Run `in2csv -f xlsx FILE`, `in2csv -f xlsx -` with identical bytes on stdin,
   and `in2csv -f xlsx /dev/fd/3 3< FILE` where the shell exposes descriptor paths.
   Verify the `-` stdin spelling, identical conversions, descriptor ownership and
   unchanged workbook bytes. Do not invent `fd://0` as a csvkit alias. If descriptor
   paths are unavailable, record that precise blocker. Exercise `--write-sheets -`
   and compare named-file versus stdin side-file names against frozen captures.
6. Inject initialized SQLite 3.50.4 WASM and an owned memory database VFS. Run
   `csvsql --query 'select * from stdin'` with CSV stdin. Seed an owned disposable
   database, then run `sql2csv --db sqlite:///owned.db --query 'select * from owned'`.
   Verify result bytes, schema, transaction effects, result/session closure and
   no unintended database writes. SQL must execute in the actual injected engine,
   not a canned provider response. Without the capability, require an explicit
   blocker and no ambient connection attempt.
7. Inject a legitimate JavaScript Python session and a terminal reader explicitly
   bound to Python stdin. Run `csvpy FILE` with `next(reader)`, `list(reader)` and
   EOF on Python stdin. CSV comes only from FILE. Verify banner/stderr, prompts,
   Python representations, EOF and exactly-once session closure. Test `--dict`
   and `--agate` separately; missing Agate object library and CPython/IPython
   behavioral gaps are blockers, not ordinary reader-mode passes.

## Visual terminal inspection

Execute these steps manually after rebuilding the actual domain engine. An ad hoc
capture helper may bind an in-memory filesystem, terminal and interpreter, but
does not replace this Markdown procedure or become a product command/test.

1. Inspect `src/cli/commands/bash.ts` and the public SDK before choosing a route.
   Capture the existing `poe-code bash --help` route with
   `npm run screenshot-poe-code -- --output out/OWNED/bash-help.png bash --help`.
   If that route exposes no csvkit capability binding, capture actual
   `Shell.use(csvkitCommands(bindings))` execution with the terminal screenshot
   runner instead. Do not introduce a forwarding subcommand for QA.
2. Seed a memory CSV with CJK/wide and combining characters, an astral character,
   long text, a quoted multiline header and multiline cells. Capture `csvlook`
   normally, then with `--max-column-width 12 --max-rows 2 --max-columns 3
   --max-precision 2`, and with `--max-column-width 8 --max-precision 0
   --no-number-ellipsis`. Inspect headers, separators, numeric alignment,
   truncation, omitted columns/rows and upstream multiline-header behavior.
   Do not change upstream widths to terminal display widths without a measured
   reference regression.
3. Capture a full `csvstat` report including numeric and text columns, nulls,
   repeated frequencies, Unicode and decimal statistics. Bind the number
   formatter explicitly to the measured locale/profile; a missing/throwing
   formatter is a harness failure, not a successful report. Capture the
   `--max-precision` report for long/multiline headers separately.
4. Capture `csvcut -n`, `csvstat -n`, `csvlook --help`, a version report, an
   unknown-option argparse report, sniff warnings, unnamed/duplicate-column
   warnings, invalid selectors and csvclean's diagnostic CSV. Redirect warnings
   and invalid-selector stderr into VFS files and display those files through
   the registered `cat` command. Assert their exact bytes independently of the
   screenshots; warning source paths must be explicitly bound. Keep CSV/JSON
   output and paths unstyled.
5. Capture actual `csvpy FILE` and `csvpy --dict FILE` with injected legitimate
   Python sessions and separate Python stdin. Evaluate `next(reader)`,
   `list(reader)` and an error such as `1/0`, then EOF. Inspect banners, `>>>`
   prompts, representations, traceback frames and EOF text. Verify exactly-once
   session closure. Capture `--agate` separately; a missing Table object library
   is an explicit status-78 blocker, never a reader-mode pass.
6. Open every final PNG with `view_image`. Missing font glyphs are a renderer
   limitation: inspect a separate capture with suitable fallback fonts when
   available, retain the original observation in reduced evidence and leave
   remaining glyph/TTY profiles unqualified. Never alter product bytes to make
   a screenshot look better. Reduce observations to `docs/csvkit`, then purge
   only the owned helpers, logs and PNGs under `out`.

## Resource and authority checks

For user dialect stress, round-trip CSV through `csvformat -T | csvcut -t`,
semicolon/single-quote dialects with disabled doublequote and an explicit escape,
and `csvformat -U 3 -P '~' | csvcut -u 3 -p '~'`. Include embedded delimiters,
quotes, literal escapes, multiline fields, tabs, fragmented Unicode, NUL, ASCII
record/unit separators and trailing empty cells. Compare exact bytes with the
original canonical CSV. These round trips check preservation; independently
captured reference observations are still required to claim dialect parity.
Use a filename containing comma and double quotes with
`csvclean --length-mismatch --label - "$file" 2> errors.csv | csvgrep -c name -m C`.
Check diagnostic CSV escaping, multiline physical line numbers, raw leading zeros,
source immutability and absence of legacy side files.

8. Repeat selected commands with one-byte fragmented UTF-8 and BOM inputs. Reuse
   and poison a Buffer view on advancement/finalization. Compare stdoutBytes and
   stderrBytes, not only decoded text. Check default BOM stripping and `--add-bom`
   separately from the reference's explicit UTF-8 environment. Distinguish raw
   leading zeros/empty strings from typed numbers/nulls. Await slow sink writes;
   cancel cooperative pending input/query/sink operations and require registered
   cleanup to finish before exec/dispose settles. Never infer arbitrary host-work
   preemption. Named input must not advance borrowed stdin.
9. Use configured real-root or mounted remote filesystems only when separately
   authorized. Create fixtures only inside an owned disposable root/service and
   verify containment, redirects/authorization, cancellation, namespace effects
   and cleanup. A source file-command URI is not network permission. Memory or
   mock-mounted results do not qualify a deployed remote provider. Record real
   roots/remotes as unmeasured when unavailable; never seek production credentials.
   All database writes use owned disposable fixtures/services.

## Maintained verification and accounting

10. Rebuild with `npm run build:workspaces -- --workspace=@poe-code/csvkit` before
    testing registrations that import compiled domain code. Run the domain's
    maintained uncached `test` and `lint` tasks and the focused safe-bash suite.
    Register new integration tests by literal path in
    `packages/safe-bash/scripts/integration-inputs.test.mjs` and run its maintained
    runner check. For integration changes expand to the normal root `npm run build`,
    `npm test` and repository lint routes. Use maintained declarations for closure;
    do not count unavailable profiles, TODOs or explicit refusals as parity passes.
11. Inspect CLI output visually using the maintained screenshot route when the
    changed behavior reaches the visible CLI. Record unavailable renderers as
    blockers. Compare SDK and registered commands using the same engine and
    input/effect expectations. Report measured workflows separately from remaining
    source-test inventory, temporal inference, drivers, TTY and runtime gaps.
