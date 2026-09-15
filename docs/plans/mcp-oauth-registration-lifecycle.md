# Dynamic registration request lifecycle

Two red provider checks reproduced absent registration fetch deadline/redirect policy and stalled registration JSON remaining pending after abort. Use one 30-second deadline through registration fetch and bounded strict UTF-8 body parsing. Forbid redirects on the registration POST and preserve the abort reason. The authorization callback must close on failure.

Run the complete current-source OAuth suite and relevant client/type/lint checks. Tests use a mocked callback and in-memory session store; they do not start sockets or write credential files.
