import type { DefaultOAuthClientProviderOptions } from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

type ignoredDefaultOptionsShape = AssertAssignable<
  DefaultOAuthClientProviderOptions,
  {
    client:
      | {
          mode: "dynamic";
          clientId?: string;
          clientSecret?: string;
        }
      | {
          mode: "static";
          clientId: string;
          clientSecret?: string;
        };
    browser: {
      openBrowser(url: string): Promise<void>;
    };
  }
>;

const ignoredImplicitGrantOptions: DefaultOAuthClientProviderOptions = {
  client: {
    mode: "static",
    clientId: "client-id",
    // @ts-expect-error implicit response types are not configurable via the public API
    responseType: "token",
  },
  browser: {
    openBrowser: async () => {},
  },
};

const ignoredPasswordGrantOptions: DefaultOAuthClientProviderOptions = {
  client: {
    mode: "dynamic",
    // @ts-expect-error password grants are not configurable via the public API
    grantType: "password",
  },
  browser: {
    openBrowser: async () => {},
  },
};
