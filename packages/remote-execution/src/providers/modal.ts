import type {ModalProviderConfig} from '../modal-driver.js';
export default {
 transport:'https',
 executionClass:'standard-sandbox',
 port:8080,
 readinessTimeoutMs:60_000,
} satisfies ModalProviderConfig;
