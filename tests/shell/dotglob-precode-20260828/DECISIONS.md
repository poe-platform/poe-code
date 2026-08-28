# Native observations versus proposed project decisions

No product execution. Tuple order: **stdout, stderr, status, dotglob poststate**.
All values below are exact byte strings encoded as JSON escapes; all captured
text is ASCII, with original base64 retained in RESULTS.json. Tokens resolve
through the dictionary; native full listings resolve to the named exact tuple
field rather than pretending those options are implemented. Project diagnostic
bodies/usage are defined exactly in PROFILE.md; source-name/line prefixes remain
existing runtime policy, not a fabricated native prefix or claimed exact parity.

`EMPTY=""`; `OFF="dotglob             \toff\n"`;
`ON="dotglob             \ton\n"`; `P_OFF="shopt -u dotglob\n"`;
`P_ON="shopt -s dotglob\n"`. OFF/ON contain exactly thirteen spaces before TAB.

| Probe | Static native command | Exact native tuple | Proposed project decision |
|---|---|---|---|
| 01-default:0 | `shopt` | (O1, EMPTY, 0, off) | (OFF, EMPTY, 0, off): supported-only list |
| 02-off:0 | `shopt dotglob` | (OFF, EMPTY, 1, off) | Same stdout/status/state; empty stderr |
| 02-off:1 | `shopt -q dotglob` | (EMPTY, EMPTY, 1, off) | Same stdout/status/state; empty stderr |
| 02-off:2 | `shopt -p dotglob` | (P_OFF, EMPTY, 1, off) | Same stdout/status/state; empty stderr |
| 03-set:0 | `shopt -s dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 03-set:1 | `shopt dotglob` | (ON, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 03-set:2 | `shopt -q dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 03-set:3 | `shopt -p dotglob` | (P_ON, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 04-unset:0 | `shopt -u dotglob` | (EMPTY, EMPTY, 0, off) | Same stdout/status/state; empty stderr |
| 04-unset:1 | `shopt dotglob` | (OFF, EMPTY, 1, off) | Same stdout/status/state; empty stderr |
| 05-conflict:0 | `shopt -su dotglob` | (EMPTY, E2, 1, off) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 05-conflict:1 | `shopt -us dotglob` | (EMPTY, E3, 1, off) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 05-conflict:2 | `shopt -s -u dotglob` | (EMPTY, E4, 1, off) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 05-conflict:3 | `shopt -u -s dotglob` | (EMPTY, E5, 1, off) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 06-repeat:0 | `shopt -ss -s dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 06-repeat:1 | `shopt -qq -q dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 06-repeat:2 | `shopt -pp -p dotglob` | (P_ON, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 06-repeat:3 | `shopt -uu -u dotglob` | (EMPTY, EMPTY, 0, off) | Same stdout/status/state; empty stderr |
| 07-set-quiet:0 | `shopt -sq dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 07-set-quiet:1 | `shopt -u dotglob` | (EMPTY, EMPTY, 0, off) | Same stdout/status/state; empty stderr |
| 07-set-quiet:2 | `shopt -qs dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 08-unset-quiet:0 | `shopt -uq dotglob` | (EMPTY, EMPTY, 0, off) | Same stdout/status/state; empty stderr |
| 08-unset-quiet:1 | `shopt -s dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 08-unset-quiet:2 | `shopt -qu dotglob` | (EMPTY, EMPTY, 0, off) | Same stdout/status/state; empty stderr |
| 09-set-print:0 | `shopt -sp dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 09-set-print:1 | `shopt -u dotglob` | (EMPTY, EMPTY, 0, off) | Same stdout/status/state; empty stderr |
| 09-set-print:2 | `shopt -ps dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 10-unset-print:0 | `shopt -up dotglob` | (EMPTY, EMPTY, 0, off) | Same stdout/status/state; empty stderr |
| 10-unset-print:1 | `shopt -s dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 10-unset-print:2 | `shopt -pu dotglob` | (EMPTY, EMPTY, 0, off) | Same stdout/status/state; empty stderr |
| 11-quiet-print:0 | `shopt -qp dotglob` | (EMPTY, EMPTY, 1, off) | Same stdout/status/state; empty stderr |
| 11-quiet-print:1 | `shopt -s dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 11-quiet-print:2 | `shopt -pq dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 12-filtered:0 | `shopt -s` | (O6, EMPTY, 0, off) | (EMPTY, EMPTY, 0, off): no enabled supported names |
| 12-filtered:1 | `shopt -u` | (O7, EMPTY, 0, off) | (OFF, EMPTY, 0, off): disabled supported names only |
| 12-filtered:2 | `shopt -sp` | (O8, EMPTY, 0, off) | (EMPTY, EMPTY, 0, off): no enabled supported names |
| 12-filtered:3 | `shopt -up` | (O9, EMPTY, 0, off) | (P_OFF, EMPTY, 0, off): disabled supported names only |
| 12-filtered:4 | `shopt -sq` | (EMPTY, EMPTY, 0, off) | Same stdout/status/state; empty stderr |
| 12-filtered:5 | `shopt -uq` | (EMPTY, EMPTY, 0, off) | Same stdout/status/state; empty stderr |
| 12-filtered:6 | `shopt -q` | (EMPTY, EMPTY, 0, off) | Same stdout/status/state; empty stderr |
| 13-end-options:0 | `shopt -- dotglob` | (OFF, EMPTY, 1, off) | Same stdout/status/state; empty stderr |
| 13-end-options:1 | `shopt -s -- dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 13-end-options:2 | `shopt -- -s` | (EMPTY, E10, 1, on) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 14-unsupported-flags:0 | `shopt -z dotglob` | (EMPTY, E11, 2, off) | (EMPTY, unsupported-flag + usage, 2, off) |
| 14-unsupported-flags:1 | `shopt -o dotglob` | (EMPTY, E12, 1, off) | (EMPTY, unsupported-flag + usage, 2, off): -o refused, no set namespace |
| 15-nonoption-order:0 | `shopt dotglob -s` | (OFF, E13, 1, off) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 15-nonoption-order:1 | `shopt -s dotglob -u` | (EMPTY, E14, 1, on) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 16-partial-set:0 | `shopt -s dotglob unknown_dotglob dotglob` | (EMPTY, E15, 1, on) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 16-partial-set:1 | `shopt -u dotglob` | (EMPTY, EMPTY, 0, off) | Same stdout/status/state; empty stderr |
| 16-partial-set:2 | `shopt -s unknown_dotglob dotglob` | (EMPTY, E16, 1, on) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 17-partial-unset:0 | `shopt -u dotglob unknown_dotglob dotglob` | (EMPTY, E15, 1, off) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 18-mixed-list:0 | `shopt dotglob unknown_dotglob dotglob` | (O17, E15, 1, off) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 18-mixed-list:1 | `shopt -s dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 18-mixed-list:2 | `shopt -p dotglob unknown_dotglob dotglob` | (O18, E16, 1, on) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 19-quiet-error:0 | `shopt -q dotglob unknown_dotglob dotglob` | (EMPTY, E15, 1, off) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 19-quiet-error:1 | `shopt -sq dotglob unknown_dotglob dotglob` | (EMPTY, E19, 1, on) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 20-native-alias-option:0 | `shopt -s expand_aliases` | (EMPTY, EMPTY, 0, off) | (EMPTY, unsupported-name expand_aliases, 1, off): explicit refusal, no alias state |
| 20-native-alias-option:1 | `shopt -q expand_aliases` | (EMPTY, EMPTY, 0, off) | (EMPTY, unsupported-name expand_aliases, 1, off): explicit refusal, no alias state |
| 20-native-alias-option:2 | `shopt -u expand_aliases` | (EMPTY, EMPTY, 0, off) | (EMPTY, unsupported-name expand_aliases, 1, off): explicit refusal, no alias state |
| 20-native-alias-option:3 | `shopt -q expand_aliases` | (EMPTY, EMPTY, 1, off) | (EMPTY, unsupported-name expand_aliases, 1, off): explicit refusal, no alias state |
| 21-name-validation:0 | `shopt ''` | (EMPTY, E20, 1, off) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 21-name-validation:1 | `shopt -` | (EMPTY, E21, 1, off) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 21-name-validation:2 | `shopt +s` | (EMPTY, E22, 1, off) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 21-name-validation:3 | `shopt Dotglob` | (EMPTY, E23, 1, off) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 22-parse-before-mutation:0 | `shopt -s -z dotglob` | (EMPTY, E11, 2, off) | (EMPTY, unsupported-flag + usage, 2, off) |
| 22-parse-before-mutation:1 | `shopt -s -- dotglob unknown_dotglob dotglob` | (EMPTY, E19, 1, on) | Same stdout/status/state; PROFILE diagnostic (not native prefix) |
| 23-full-print-restrict:0 | `shopt -p` | (O24, EMPTY, 0, off) | (P_OFF, EMPTY, 0, off): supported-only print |
| 23-full-print-restrict:1 | `shopt -s dotglob` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 23-full-print-restrict:2 | `shopt -sq` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 23-full-print-restrict:3 | `shopt -uq` | (EMPTY, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 23-full-print-restrict:4 | `shopt -p dotglob dotglob` | (O18, EMPTY, 0, on) | Same stdout/status/state; empty stderr |
| 24-glob-timing:0 | `printf '<%s>\n' * .* . ..; shopt -s dotglob; printf '<%s>\n' * */* [.]hidden [.v]* '*' missing* . ..; shopt -u dotglob; printf '<%s>\n' * */* .*` | (O25, EMPTY, 0, off) | Same tiny fixture stdout proposed; custom-VFS overlap remains BLOCKED; not product evidence |

## Remaining exact token dictionary

- O1: EXACT-NATIVE-TUPLES.json tuple `01-default:0` stdout, exactly 1465 bytes (full native option inventory; excluded from project inventory).
- E2: `"dotglob-reference: line 3: shopt: cannot set and unset shell options simultaneously\n"`.
- E3: `"dotglob-reference: line 9: shopt: cannot set and unset shell options simultaneously\n"`.
- E4: `"dotglob-reference: line 15: shopt: cannot set and unset shell options simultaneously\n"`.
- E5: `"dotglob-reference: line 21: shopt: cannot set and unset shell options simultaneously\n"`.
- O6: `"checkwinsize        \ton\ncmdhist             \ton\ncomplete_fullquote  \ton\nextquote            \ton\nforce_fignore       \ton\nglobasciiranges     \ton\nglobskipdots        \ton\nhostcomplete        \ton\ninteractive_comments\ton\npatsub_replacement  \ton\nprogcomp            \ton\npromptvars          \ton\nsourcepath          \ton\n"`.
- O7: EXACT-NATIVE-TUPLES.json tuple `12-filtered:1` stdout, exactly 1153 bytes (full native option inventory; excluded from project inventory).
- O8: `"shopt -s checkwinsize\nshopt -s cmdhist\nshopt -s complete_fullquote\nshopt -s extquote\nshopt -s force_fignore\nshopt -s globasciiranges\nshopt -s globskipdots\nshopt -s hostcomplete\nshopt -s interactive_comments\nshopt -s patsub_replacement\nshopt -s progcomp\nshopt -s promptvars\nshopt -s sourcepath\n"`.
- O9: EXACT-NATIVE-TUPLES.json tuple `12-filtered:3` stdout, exactly 954 bytes (full native option inventory; excluded from project inventory).
- E10: `"dotglob-reference: line 15: shopt: -s: invalid shell option name\n"`.
- E11: `"dotglob-reference: line 3: shopt: -z: invalid option\nshopt: usage: shopt [-pqsu] [-o] [optname ...]\n"`.
- E12: `"dotglob-reference: line 9: shopt: dotglob: invalid option name\n"`.
- E13: `"dotglob-reference: line 3: shopt: -s: invalid shell option name\n"`.
- E14: `"dotglob-reference: line 9: shopt: -u: invalid shell option name\n"`.
- E15: `"dotglob-reference: line 3: shopt: unknown_dotglob: invalid shell option name\n"`.
- E16: `"dotglob-reference: line 15: shopt: unknown_dotglob: invalid shell option name\n"`.
- O17: `"dotglob             \toff\ndotglob             \toff\n"`.
- O18: `"shopt -s dotglob\nshopt -s dotglob\n"`.
- E19: `"dotglob-reference: line 9: shopt: unknown_dotglob: invalid shell option name\n"`.
- E20: `"dotglob-reference: line 3: shopt: : invalid shell option name\n"`.
- E21: `"dotglob-reference: line 9: shopt: -: invalid shell option name\n"`.
- E22: `"dotglob-reference: line 15: shopt: +s: invalid shell option name\n"`.
- E23: `"dotglob-reference: line 21: shopt: Dotglob: invalid shell option name\n"`.
- O24: EXACT-NATIVE-TUPLES.json tuple `23-full-print-restrict:0` stdout, exactly 1247 bytes (full native option inventory; excluded from project inventory).
- O25: `"<nest>\n<visible>\n<.hidden>\n<.nest>\n<.>\n<..>\n<.hidden>\n<.nest>\n<nest>\n<visible>\n<.nest/plain>\n<nest/.inner>\n<nest/plain>\n<.hidden>\n<.hidden>\n<.nest>\n<visible>\n<*>\n<missing*>\n<.>\n<..>\n<nest>\n<visible>\n<nest/plain>\n<.hidden>\n<.nest>\n"`.

## Interpretation limits

The mixed-name rows demonstrate continuing valid mutations and duplicate output,
not transactionality. The wrappers use actual builtin shopt/printf, never stubs.
Full native no-name listings return0 even when some options are off. Named
listing/query returns1 for disabled names; named -u returns0 after disabling.
-q does not mask invalid-name diagnostics. Both -s and -u always conflict.
Native supports expand_aliases; the project intentionally does not. Native -o
selects another namespace; the project intentionally rejects that flag.

Primary source: GNU Manual5.3 The Shopt Builtin, Filename Expansion and Simple
Command Expansion; qualified local shopt.def lines300–350 and460–550 corroborate
precedence, partial changes and print policy. See BINDINGS-v1.json for exact
GNU URLs and SHA256. This is a selected bounded profile, not broad Bash parity.
