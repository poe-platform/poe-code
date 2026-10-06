/** Preserve Python exception handling across Pyodide's JSPI run_sync boundary. */
export function installPythonJspiRunSync(runtime: {runPython(source: string): unknown}): void {
  runtime.runPython(`
import pyodide.ffi as _safe_jspi_ffi
import pyodide.webloop as _safe_jspi_webloop
def _safe_jspi_run_sync(awaitable, _original=_safe_jspi_ffi.run_sync):
 async def capture():
  try:
   return True, await awaitable
  except BaseException as error:
   return False, error
 completed, value = _original(capture())
 if completed:
  return value
 raise value
_safe_jspi_ffi.run_sync = _safe_jspi_run_sync
# WebLoop captures this import during runtime initialization. asyncio.run()
# must use the same exception envelope as explicit synchronous model calls.
_safe_jspi_webloop.run_sync = _safe_jspi_run_sync
del _safe_jspi_ffi, _safe_jspi_webloop, _safe_jspi_run_sync
`);
}
