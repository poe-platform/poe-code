# Authorization-server credential lifetimes

Four red cases reproduced zero/negative/fractional/non-finite/overflowing configured access token, authorization code, transaction, and refresh-token lifetimes accepted at construction. Validate explicit lifetime seconds as positive safe integers whose millisecond conversion is also safe. Keep existing defaults. Fail before credentials or transactions can be issued under invalid expiration settings.

The complete authorization-server suite passes 26 cases across two files, and the selected maintained dependency build subsequently compiled this change. Run final focused lint and consumer scopes. No README additions have been made.
