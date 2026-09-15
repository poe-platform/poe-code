# OAuth loopback URL validation

Three failing discovery checks reproduced plain HTTP being accepted for DNS names starting with 127. and genuine IPv6 loopback being rejected. Check IPv4 syntax with Node isIP before accepting the 127/8 range, and accept URL.hostname's bracketed IPv6 loopback representation. Keep localhost and actual IPv4 loopback working.

The default OAuth provider contains the same hostname rule; reproduce and fix it separately. OAuth metadata and flow endpoint tests must prove invalid DNS hosts cannot cause metadata requests or browser/token flows.

Provider reproduced the same three defects; five credential-binding/loopback tests now pass with an injected in-memory session store. Three additional live metadata/issuer checks reproduced embedded credentials and fragments being accepted. The shared URL validation now rejects them consistently before secure-scheme checks. Focused live/cache/identity verification is running.
