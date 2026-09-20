import*as own from'../dist/index.js';import*as sdk from'tiny-oauth-test-server';const forward:typeof sdk=own;const reverse:typeof own=sdk;void[forward,reverse];

import*as ownCli from'tiny-oauth-test-server-rust/cli';import*as sdkCli from'../../tiny-oauth-test-server/dist/cli.js';const cliForward:typeof sdkCli=ownCli;const cliReverse:typeof ownCli=sdkCli;void[cliForward,cliReverse];
