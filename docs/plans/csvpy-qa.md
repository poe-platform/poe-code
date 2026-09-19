# csvpy implementation and qualification

1. Authenticate csvkit 2.2.0 source archive SHA-256 against `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`; inspect literal `csvkit/utilities/csvpy.py` and frozen Agate reader/config sources.
2. Keep the executable descriptor unchanged; audit source-local and inherited options, excluded output/selector/line-number flags, and DictReader's unsupported `header` keyword under `-H`.
3. Reproduce failing reader-iteration timing, filename probe order, guest module identity, SystemExit and config regressions before code changes. Extend maintained PythonSession object/library APIs with original failing ownership/import/callback tests.
4. Exercise the actual registered safe-bash command with an independent agent using memory filesystem inputs. Compare stdout, stderr, status, consumed stdin, guest closure and cancellation reason.
5. Run maintained selected workspace build and csvkit lint; run narrow unit checks, then root `npm test` and root lint because PythonSession is shared infrastructure. Never count timeout or unmeasured profiles as passes.
6. Inspect an ad hoc screenshot of the console through the registered engine. Keep generated evidence under `out` and purge it after use.
7. Record remaining transport, Agate library, console compilation/traceback and IPython gaps in `docs/specs/csvpy.md`. This procedure does not qualify a full csvkit 2.2.0 compatibility gate.
