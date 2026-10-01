// Portable ERE frames are internal shell-owned data. JavaScript hosts have no
// proxy inspection primitive; descriptor/shape validation remains shared, while
// Node's transport additionally rejects proxies using util.types.isProxy.
export const types = { isProxy: () => false };
