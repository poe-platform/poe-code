/** Native CLI exit handling, shared without changing loader/tool error boundaries. */
export const pythonLlmExitHandlers=/* @__PURE__ */ (()=>String.raw`
except (KeyboardInterrupt, EOFError, Abort) as error:
 echo(("" if isinstance(error, Abort) else "\n") + "Aborted!", err=True)
 send("exit")
 raise SystemExit(1)
except SystemExit:
 send("exit")
 raise
`)();

/** Discovery failures have CLI semantics; loader invocation failures do not. */
export const pythonLlmLookupErrors=/* @__PURE__ */ (()=>String.raw`
 except (EOFError, Abort):
  raise
 except ClickException as error:
  error.show()
  raise SystemExit(error.exit_code)
 except Exception as error:
  send('lookup', message=str(error))
  return
`)();
