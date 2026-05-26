# Design documentation generator follows a symlinked output document and overwrites outside the repository

## Summary

The design-system documentation generator writes committed output documents such as `docs/DESIGN_LANGUAGE_MARKDOWN.md` directly without rejecting a symlinked output path. A crafted checkout can redirect the normal documentation regeneration command into overwriting an external file.

## Reproduction

1. From the repository root, run this disposable clean-copy probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-design-doc-probe.XXXXXX)
   git archive --format=tar HEAD | tar -xf - -C "$probe"
   ln -s "$PWD/node_modules" "$probe/node_modules"
   printf 'EXTERNAL ORIGINAL\n' > "$probe/outside.md"
   rm -f "$probe/docs/DESIGN_LANGUAGE_MARKDOWN.md"
   ln -s "$probe/outside.md" "$probe/docs/DESIGN_LANGUAGE_MARKDOWN.md"

   cat > "$probe/invoke.mts" <<'EOF'
   import { main } from './packages/design-system/scripts/generate-docs.ts';
   await main(['node', 'generate-docs', 'markdown']);
   EOF

   "$PWD/node_modules/.bin/tsx" "$probe/invoke.mts"

   realpath "$probe/docs/DESIGN_LANGUAGE_MARKDOWN.md"
   sed -n '1,10p' "$probe/outside.md"
   ```

## Observed Behavior

The repository document path resolves to the external target, and the external file is overwritten with generated content beginning with `# Design Language Markdown` and the auto-generation notice. The generator reports success for the repository-looking output path.

`packages/design-system/scripts/generate-docs.ts:18` defines fixed committed document paths under `docs/`, and `generateTextArtifacts()` writes the selected format with `writeFileSync(OUTPUT_DOCS[format], ...)` at line 621 without validating whether the document is a symbolic link.

## Expected Behavior

Design documentation regeneration should modify only canonical documentation files within the selected repository. A generated documentation output symlink that resolves outside the repository should be rejected.

## Impact

A crafted checkout can cause the required design-document regeneration workflow to overwrite arbitrary external files with developer or CI permissions. This is particularly relevant because repository guidance requires running design-doc generation after visual-language changes.
