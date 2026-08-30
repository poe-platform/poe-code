# Versioned control correction, not a source change

The unchanged author12 controls passed196 assertions. Independent v1 completed
7/8 families,59 attempted assertions. I04's first assertion incorrectly expected
`/MANIFEST/`; the actual correctly refused cycle throws `SEAL_CYCLE`. Its remaining
seven assertions were unrun. Both children exited/closed naturally with captures
flushed/closed; scratch removed and source pins unchanged. This is an ordinary
captured fixture assertion failure, not a safety, integrity or retirement failure.

Before successor execution, pin a separate I04-only recipe with exact declared
source diagnostics: four `SEAL_CYCLE`, one `SEAL_PATH`, one `SEAL_MEMBER`, then the
unchanged accessor rejection/no-read control. No source edit, no additional family,
no replay/rescore of the original seven passed families or author12. Root grant
permits ordinary fully captured retired helper/assertion corrections within cap.
