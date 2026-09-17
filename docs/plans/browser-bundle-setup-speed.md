# Bound browser bundle test setup work

The full and focused runners reproduced a ten-second setup-hook timeout in
browser bundle verification. Separate filesystem build, shell build, artifact
rewrite and consumer VM initialization into dependent setup phases. Avoid
source-map generation in this suite because its assertions inspect JavaScript
and the module graph. Use esbuild import metadata to rewrite only artifacts
that reference the canonical filesystem specifier, avoiding parsing unrelated
large generated chunks. Preserve all browser isolation and identity assertions.
Validate the focused suite and lint, then the maintained full test route before
delivery.
