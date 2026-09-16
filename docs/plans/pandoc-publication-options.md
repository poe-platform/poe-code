# Typed publication options

Expose the frozen PDF and EPUB publication subset through the original SDK and
CLI. Preserve native-engine rejection, resource admission and format descriptors.

The PDF engine now accepts a bounded line-height multiplier; original placement
and invalid-admission tests failed first, then passed. The maintained PDF suite
passes 47 tests; PDF lint and source/test typechecks pass.

The Pandoc SDK now accepts typed page size/orientation/margin/font/font size/line
height and EPUB title/language/identifier/chapter level. Geometry and publication
metadata are validated before input/output. Serif/sans remain explicit capability
errors because only the verified bundled mono font is available. No ambient font
or external PDF engine is permitted.

CLI inference, dash stdout and information modes have original failing tests.
The Pandoc suite passes 932 tests and package lint/typechecks pass. Required EPUB
metadata now fails with `E_METADATA` unless explicit typed `yes` enables defaults.
Adapter,
consumer and repository checks are tracked separately in
`pandoc-safe-bash-plugin.md`; they are not publication-option completion evidence.
