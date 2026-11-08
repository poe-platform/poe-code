interface BrowserTimer {
  close(): void;
  ref(): BrowserTimer;
  unref(): BrowserTimer;
}
export function setTimeout(callback: () => void, delay?: number): BrowserTimer;
export function clearTimeout(timer: BrowserTimer | undefined): void;
