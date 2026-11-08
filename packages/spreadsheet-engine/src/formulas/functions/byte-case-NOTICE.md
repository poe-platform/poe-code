Byte case conversion follows the C-locale behavior in GLib 2.84.4
`glib/guniprop.c`, adapted to owned byte cursors, explicit output admission,
and cooperative cancellation. The source is copyright 1999 Tom Tromey and
2000 Red Hat, Inc., licensed under LGPL-2.1-or-later. Its authenticated
SHA-256 is `2ef544374495f5f808bd8313702de18134cbd8c17f9198df28e7bb84408d1d9d`.
The license text is included at `../../encoding/LGPL-2.1.txt`.

The Unicode 16 category/full-case data derives from the same authenticated
source and its `gunichartables.h` (SHA-256
`f24cd0f88dec64240c884782af669018da8595caa3ef9cbdae9d76c66983d65c`).
Unicode's permission notice is retained in the data module. The existing
simple-case and alphabetic tables are reused. This implementation does not
use the host runtime's Unicode casing tables.

The TypeScript implementation and data are included in the package. The
reference archive is available from
https://download.gnome.org/sources/glib/2.84/glib-2.84.4.tar.xz.
