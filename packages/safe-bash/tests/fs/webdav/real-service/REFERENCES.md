# Primary references and interpretation boundary

Read alongside the actual raw responses and pinned binary/wheel hashes. Source
inspection predicts behavior but is not a substitute for the measured profiles.
The root-supplied read-only advisory was recovered at
`/tmp/safe-bash-webdav-real-protocol-review-full.md`; this author did not modify it.
No separate reviewer has yet accepted this author checkpoint.

- RFC 4918, especially 8.6 (ETags), 9.8/9.9 (COPY/MOVE), 9.10/9.11 (locks),
  10.4 (If), 10.6 (Overwrite), 14.1/14.12 (activelock/lockroot):
  `https://www.rfc-editor.org/rfc/rfc4918.html`
- RFC 9110, 8.8 and 13.1: weak versus strong comparison and conditional fields:
  `https://www.rfc-editor.org/rfc/rfc9110.html`
- WsgiDAV 4.3.5 official metadata, constraints and distribution hashes:
  `https://pypi.org/pypi/WsgiDAV/4.3.5/json`
- WsgiDAV pinned filesystem provider and request handling:
  `https://raw.githubusercontent.com/mar10/wsgidav/v4.3.5/wsgidav/fs_dav_provider.py`
  `https://raw.githubusercontent.com/mar10/wsgidav/v4.3.5/wsgidav/request_server.py`
- Cheroot official pinned release metadata and builtin TLS adapter:
  `https://pypi.org/pypi/cheroot/11.1.2/json`
  `https://github.com/cherrypy/cheroot/blob/v11.1.2/cheroot/ssl/builtin.py`
- Apache pinned DAV request and lock implementations:
  `https://raw.githubusercontent.com/apache/httpd/2.4.66/modules/dav/main/mod_dav.c`
  `https://raw.githubusercontent.com/apache/httpd/2.4.66/modules/dav/main/util.c`
  `https://raw.githubusercontent.com/apache/httpd/2.4.66/modules/dav/main/util_lock.c`
- Apache pinned filesystem ETag and dead-property handling:
  `https://raw.githubusercontent.com/apache/httpd/2.4.66/modules/dav/fs/repos.c`
- Apache configuration, FileETag, Options, locks, and HTTPS DAV:
  `https://httpd.apache.org/docs/2.4/mod/core.html#fileetag`
  `https://httpd.apache.org/docs/2.4/mod/core.html#options`
  `https://httpd.apache.org/docs/2.4/mod/mod_dav_fs.html`
  `https://httpd.apache.org/docs/2.4/mod/mod_dav.html`

The final raw profile distinguishes protocol-format failures from unexercised
conditional operations. WsgiDAV native conditional probes use untouched strong
HTTP GET validators, never quoted-up or de-weakened PROPFIND properties. The
product still requires a valid granted lockroot, a finite lock, and exact token
binding. Missing fields are not fabricated to accommodate the installed servers.
