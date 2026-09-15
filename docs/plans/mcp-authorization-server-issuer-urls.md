# Authorization server issuer URL validation

Six red tests reproduced acceptance of FTP localhost issuers and credential-bearing issuers, and rejection of actual IPv6/127/8 HTTP loopback issuers. Require HTTPS or explicitly HTTP with a verified loopback hostname/address; reject embedded credentials. Existing origin-only path/query and fragment restrictions remain enforced.

Run the complete maintained authorization-server suite, scope lint, and types. Preserve intentional native application redirect schemes; issuer URL security is a separate requirement.
