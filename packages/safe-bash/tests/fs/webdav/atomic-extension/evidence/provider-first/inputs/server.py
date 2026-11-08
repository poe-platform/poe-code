import base64
import errno
import json
import os
import stat
import sys
import threading
import time
from urllib.parse import urlsplit
from cheroot.wsgi import Server
from cheroot.ssl.builtin import BuiltinSSLAdapter
from wsgidav import util
from wsgidav.dav_error import DAVError
from wsgidav.fs_dav_provider import FilesystemProvider, FolderResource
from wsgidav.wsgidav_app import WsgiDAVApp

workspace = sys.argv[1]
operation = "atomic-empty-rmdir/v1"
events = []


def record(event):
    events.append(event)
    with open(os.path.join(workspace, "provider.jsonl"), "a") as output:
        output.write(json.dumps(event) + "\n")


def reject(environ, code, status):
    environ["atomic.error"] = code
    raise DAVError(status, code)


class AtomicFolder(FolderResource):
    def get_descendants(self, *args, **kwargs):
        if self.environ.get("atomic.request"):
            record({"event": "FORBIDDEN-descendant-visitation", "path": self.path})
            reject(self.environ, "EIO", 500)
        return super().get_descendants(*args, **kwargs)

    def handle_delete(self):
        if not self.environ.get("atomic.request"):
            return super().handle_delete()
        environ = self.environ
        record({"event": "hook-after-standard-parent-check", "path": self.path,
                "principal": environ["wsgidav.user_name"]})
        try:
            self.provider.lock_manager.check_write_permission(
                url=self.get_ref_url(), depth="infinity",
                token_list=environ["wsgidav.ifLockTokenList"],
                principal=environ["wsgidav.user_name"],
            )
        except DAVError:
            record({"event": "actual-lock-manager-rejected", "path": self.path})
            raise
        record({"event": "actual-lock-manager-approved", "path": self.path})
        if self.path.rstrip("/") == "/late-child":
            with open(os.path.join(workspace, "entered-native-gate"), "x"):
                pass
            deadline = time.monotonic() + 5
            while not os.path.exists(os.path.join(workspace, "release-native-gate")):
                if time.monotonic() > deadline:
                    reject(environ, "ETIMEDOUT", 500)
                time.sleep(0.005)
        record({"event": "native-rmdir", "path": self.path})
        try:
            os.rmdir(self._file_path)
        except OSError as error:
            code = errno.errorcode.get(error.errno, "EIO")
            record({"event": "native-error", "path": self.path, "code": code})
            reject(environ, code, {"ENOTEMPTY": 409, "ENOENT": 404, "ENOTDIR": 409, "EACCES": 403}.get(code, 500))
        record({"event": "native-removed", "path": self.path})
        self.remove_all_properties(recursive=False)
        self.remove_all_locks(recursive=False)
        environ["atomic.removed"] = True
        return True


class AtomicProvider(FilesystemProvider):
    def __init__(self, root):
        super().__init__(root, fs_opts={"follow_symlinks": False})
        self.atomic_root = os.path.realpath(root)
        self.root_identity = os.lstat(self.atomic_root)
        self.namespace = None
        self.serial = threading.RLock()

    def get_resource_inst(self, path, environ):
        resource = super().get_resource_inst(path, environ)
        if resource and resource.is_collection:
            return AtomicFolder(path, environ, resource._file_path)
        return resource

    def validate_target(self, environ):
        path = environ["PATH_INFO"]
        if path != "/" and path.endswith("/"):
            path = path[:-1]
        if not path.startswith("/") or "\\" in path or "\x00" in path:
            reject(environ, "EINVAL", 400)
        if path == "/":
            reject(environ, "EBUSY", 409)
        parts = path[1:].split("/")
        if any(part in ("", ".", "..") for part in parts):
            reject(environ, "EINVAL", 400)
        encoded = base64.urlsafe_b64encode(path.encode()).decode().rstrip("=")
        if environ.get("HTTP_X_ATOMIC_PATH") != encoded:
            reject(environ, "EINVAL", 400)
        current = os.lstat(self.atomic_root)
        if (current.st_dev, current.st_ino) != (self.root_identity.st_dev, self.root_identity.st_ino):
            reject(environ, "ENOTSUP", 409)
        native_path = self.atomic_root
        for part in parts:
            native_path = os.path.join(native_path, part)
            try:
                observed = os.lstat(native_path)
            except FileNotFoundError:
                reject(environ, "ENOENT", 404)
            if stat.S_ISLNK(observed.st_mode) or not stat.S_ISDIR(observed.st_mode):
                reject(environ, "ENOTDIR", 409)
        environ["atomic.path"] = path

    def custom_request_handler(self, environ, start_response, default_handler):
        with self.serial:
            extension = environ.get("HTTP_X_ATOMIC_EMPTY_DIRECTORY")
            probe = environ.get("HTTP_X_ATOMIC_EMPTY_PROBE")
            if extension is None and probe is None:
                yield from default_handler(environ, start_response)
                return

            def respond(status, headers, exc_info=None):
                if environ.get("atomic.error"):
                    headers.append(("X-Atomic-Error", environ["atomic.error"]))
                if environ.get("atomic.removed"):
                    receipt = {"operation": operation, "namespaceUrl": self.namespace,
                               "path": environ["atomic.path"], "outcome": "removed"}
                    encoded = base64.urlsafe_b64encode(json.dumps(receipt, ensure_ascii=False).encode()).decode().rstrip("=")
                    headers.append(("X-Atomic-Receipt", encoded))
                return start_response(status, headers, exc_info)

            record({"event": "authenticated-extension-request", "method": environ["REQUEST_METHOD"],
                    "path": environ["PATH_INFO"], "principal": environ["wsgidav.user_name"]})
            try:
                if environ["wsgidav.user_name"] != "fixture":
                    reject(environ, "EACCES", 403)
                if environ.get("HTTP_HOST") != urlsplit(self.namespace).netloc or environ.get("QUERY_STRING"):
                    reject(environ, "ENOTSUP", 409)
                if environ.get("HTTP_X_ATOMIC_NAMESPACE") != self.namespace:
                    reject(environ, "ENOTSUP", 409)
                if probe is not None:
                    if probe != operation or extension is not None or environ["REQUEST_METHOD"] != "OPTIONS":
                        reject(environ, "EINVAL", 400)
                    start_response("200 OK", [("Content-Length", "0"), ("X-Atomic-Capability", operation),
                                               ("X-Atomic-Namespace", self.namespace)])
                    yield b""
                    return
                if extension != operation or environ["REQUEST_METHOD"] != "DELETE":
                    reject(environ, "EINVAL", 400)
                self.validate_target(environ)
                environ["atomic.request"] = True
                yield from default_handler(environ, respond)
            except DAVError as error:
                yield from util.send_status_response(environ, respond, error)


provider = AtomicProvider(os.path.join(workspace, "root", "extension"))
app = WsgiDAVApp({
    "provider_mapping": {
        "/dav": provider,
        "/stock": FilesystemProvider(os.path.join(workspace, "root", "stock"), fs_opts={"follow_symlinks": False}),
    },
    "simple_dc": {"user_mapping": {"*": {
        "fixture": {"password": "fixture-only-password"},
        "other": {"password": "other-fixture-password"},
    }}},
    "http_authenticator": {"accept_basic": True, "accept_digest": False, "default_to_digest": False},
    "property_manager": True, "lock_storage": True, "dir_browser": {"enable": False}, "verbose": 1,
})
server = Server(("127.0.0.1", 0), app, numthreads=4, timeout=10)
server.ssl_adapter = BuiltinSSLAdapter(os.path.join(workspace, "cert.pem"), os.path.join(workspace, "key.pem"))
try:
    server.prepare()
    port = server.socket.getsockname()[1]
    provider.namespace = f"https://127.0.0.1:{port}/dav/"
    with open(os.path.join(workspace, "ready.json"), "x") as output:
        json.dump({"port": port, "namespaceUrl": provider.namespace}, output)
    server.serve()
finally:
    server.stop()
