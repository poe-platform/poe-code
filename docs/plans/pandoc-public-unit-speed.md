# Keep public Pandoc checks fast

The full and focused runners reproduced five-second timeouts in artifact
scanning, public declaration compilation and transformed bundle imports.
Retain strict public consumer checks in a dedicated TypeScript fixture and
run them via maintained package typecheck and pretest:unit hooks outside unit
timers. Inspect dynamic imports with the existing lightweight syntax scanner and load built public ESM
entries through native Node resolution, avoiding Vitest transformation of the
large generated graph. Validate strict compilation, focused tests and lint,
then complete the maintained test route before delivery.
