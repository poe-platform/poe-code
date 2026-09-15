# JWKS body ownership and byte bounds

Two focused failing checks reproduced rejected JWKS responses not being cancelled and declared oversized JWKS bodies being read. Cancel rejected bodies before mapping temporary unavailability. Bound successful UTF-8 JSON reads to one MiB, and keep the fetch timeout signal active through body reads so stalled readers are cancelled and released.

Use the maintained bounded-response implementation; consolidate the client/OAuth helper copies after the broad gate completes and consumers can be rebuilt sequentially. Focused tests are running. Add streamed multibyte and stalled-reader cancellation cases, then full server verifier regression validation.
