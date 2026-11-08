export async function finishCleanup(cleanup: () => unknown, failed: boolean): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    if (!failed) throw error;
  }
}
