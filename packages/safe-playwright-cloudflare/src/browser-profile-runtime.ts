import type { Browser, BrowserContext } from '@cloudflare/playwright';
import type { BrowserProfileContext } from '@poe-platform/safe-bash/playwright';
import { captureRunCodeState, replaceRunCodeContextInitScripts, restoreRunCodePageState, restoreRunCodeTimeouts } from './browser-run-code-native.js';
import { restoreRunCodeContextState } from './browser-run-code-context-state.js';
import { validateRunCodeState } from './browser-run-code-state.js';

const provider = '@cloudflare/playwright@1.3.6';

/** Reuse reconnect state transfer, with ordered new pages instead of old target identities. */
export function browserProfileRuntime(browser: Browser, context: BrowserContext): NonNullable<BrowserProfileContext['browserProfile']> {
  return {
    async capture(signal) {
      signal.throwIfAborted();
      const state = validateRunCodeState(captureRunCodeState(browser, context));
      return { provider, state };
    },
    async restore(value, signal) {
      signal.throwIfAborted();
      if (!value || typeof value !== 'object' || !('provider' in value) || value.provider !== provider || !('state' in value)) throw new Error('Unsupported Cloudflare browser profile settings');
      const state = validateRunCodeState(value.state);
      const pages = context.pages();
      if (state.pages.length !== pages.length && !(state.pages.length === 0 && pages.length === 1)) throw new Error('Cloudflare browser profile tab settings mismatch');
      await restoreRunCodeContextState(context, state.context);
      restoreRunCodeTimeouts(context, state.contextTimeouts);
      signal.throwIfAborted();
      await replaceRunCodeContextInitScripts(browser, context, state.contextInitScripts);
      for (let index = 0; index < state.pages.length; index++) {
        signal.throwIfAborted();
        await restoreRunCodePageState(browser, pages[index]!, state.pages[index]!);
      }
      signal.throwIfAborted();
    },
  };
}
