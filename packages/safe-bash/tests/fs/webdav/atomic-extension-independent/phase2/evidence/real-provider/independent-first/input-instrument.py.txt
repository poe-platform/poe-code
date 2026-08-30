import atexit
import hashlib
import json
import os
import runpy
import shutil
import sys
import threading
import time
import types
from cheroot.wsgi import Server
from wsgidav.request_server import RequestServer
from wsgidav.fs_dav_provider import FolderResource

author = sys.argv[1]
workspace = sys.argv[2]
local = threading.local()
trace_lock = threading.Lock()
sequence = 0
native_rmdir = os.rmdir


def record(event, **fields):
    global sequence
    environ = getattr(local, "environ", {})
    with trace_lock:
        sequence += 1
        row = {"seq": sequence, "ns": time.monotonic_ns(), "event": event,
               "method": environ.get("REQUEST_METHOD"), "path": environ.get("PATH_INFO"),
               "principal": environ.get("wsgidav.user_name"), "thread": threading.get_ident(), **fields}
        with open(os.path.join(workspace, "independent.jsonl"), "a") as output:
            output.write(json.dumps(row, default=str) + "\n")


def settings():
    try:
        with open(os.path.join(workspace, "settings.json")) as source:
            return json.load(source)
    except FileNotFoundError:
        return {}


def gate(stage):
    environ = getattr(local, "environ", {})
    current = settings().get("gate")
    if not current or current["path"] != environ.get("PATH_INFO", "").rstrip("/") or current["stage"] != stage:
        return
    record("gate-enter", stage=stage, gate=current["id"])
    with open(os.path.join(workspace, "entered-" + current["id"]), "w") as output:
        output.write(stage)
    deadline = time.monotonic() + 8
    while not os.path.exists(os.path.join(workspace, "release-" + current["id"])):
        if time.monotonic() > deadline:
            raise RuntimeError("independent gate timeout")
        time.sleep(0.005)
    record("gate-release", stage=stage, gate=current["id"])


def traced_rmdir(path, *args, **kwargs):
    record("os.rmdir-enter", native=str(path))
    gate("before-native")
    mutation = settings().get("mutation")
    environ = getattr(local, "environ", {})
    try:
        if mutation == "recursive" and environ.get("PATH_INFO", "").rstrip("/") == "/mut-recursive" and not getattr(local, "recursive", False):
            record("MUTATION-recursive-delete")
            local.recursive = True
            try:
                shutil.rmtree(path)
            finally:
                local.recursive = False
        else:
            native_rmdir(path, *args, **kwargs)
    except Exception as error:
        record("os.rmdir-error", errno=getattr(error, "errno", None), error=str(error))
        raise
    record("os.rmdir-return", native=str(path))
    gate("after-native")


os.rmdir = traced_rmdir
original_check = RequestServer._check_write_permission


def standard_check(self, resource, depth, environ):
    record("standard-check-enter", checked=resource.get_ref_url() if resource else None, depth=depth)
    try:
        result = original_check(self, resource, depth, environ)
    except Exception as error:
        record("standard-check-rejected", error=str(error))
        raise
    record("standard-check-return")
    return result


RequestServer._check_write_permission = standard_check
original_descendants = FolderResource.get_descendants


def descendants(self, *args, **kwargs):
    record("base-descendants", resource=self.path)
    return original_descendants(self, *args, **kwargs)


FolderResource.get_descendants = descendants
original_server_init = Server.__init__


def server_init(self, bind_addr, application, *args, **kwargs):
    provider = application.provider_map["/dav"]
    manager = provider.lock_manager
    record("real-provider-installed", provider=type(provider).__name__,
           manager=type(manager).__module__ + "." + type(manager).__name__,
           storage=type(manager.storage).__module__ + "." + type(manager.storage).__name__,
           mappings={key: type(value).__name__ for key, value in application.provider_map.items()})
    for name in ["check_write_permission", "acquire", "refresh", "release"]:
        original = getattr(manager, name)

        def delegated(*method_args, _name=name, _original=original, **method_kwargs):
            record("manager-" + _name + "-enter", arguments=method_kwargs, positional=method_args)
            try:
                result = _original(*method_args, **method_kwargs)
            except Exception as error:
                record("manager-" + _name + "-rejected", error=str(error))
                environ = getattr(local, "environ", {})
                if _name == "check_write_permission" and settings().get("mutation") == "ignore-lock" and environ.get("PATH_INFO", "").rstrip("/") == "/mut-lock":
                    record("MUTATION-ignored-real-lock-rejection")
                    return None
                raise
            record("manager-" + _name + "-return", result=result)
            return result

        setattr(manager, name, delegated)
    original_handler = provider.custom_request_handler

    def handler(self, environ, start_response, default_handler):
        local.environ = environ
        record("provider-arrival", authenticated=environ.get("wsgidav.auth.user_name"))
        if settings().get("mutation") == "ignore-auth" and environ["PATH_INFO"].rstrip("/") == "/mut-auth":
            record("MUTATION-principal-relabel", original=environ["wsgidav.user_name"])
            environ["wsgidav.user_name"] = "fixture"

        def dispatch(current, respond):
            record("serialized-dispatch")
            yield from default_handler(current, respond)

        try:
            yield from original_handler(environ, start_response, dispatch)
        finally:
            record("provider-finished")
            del local.environ

    provider.custom_request_handler = types.MethodType(handler, provider)
    original_server_init(self, bind_addr, application, *args, **kwargs)


Server.__init__ = server_init


def closure():
    modules = {}
    for name, module in list(sys.modules.items()):
        path = getattr(module, "__file__", None)
        if path and os.path.isfile(path) and ("site-packages" in path or path == author):
            with open(path, "rb") as source:
                modules[name] = {"file": path, "sha256": hashlib.sha256(source.read()).hexdigest()}
    with open(os.path.join(workspace, "python-closure.json"), "w") as output:
        json.dump(modules, output, indent=2)


atexit.register(closure)
sys.argv = [author, workspace]
runpy.run_path(author, run_name="__main__")
