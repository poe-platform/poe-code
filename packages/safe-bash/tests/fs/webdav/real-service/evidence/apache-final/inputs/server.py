import json
import os
import sys
from cheroot.wsgi import Server
from cheroot.ssl.builtin import BuiltinSSLAdapter
from wsgidav.wsgidav_app import WsgiDAVApp
from wsgidav.fs_dav_provider import FilesystemProvider

workspace = sys.argv[1]
root = os.path.join(workspace, "root")
app = WsgiDAVApp({
    "provider_mapping": {
        "/dav": FilesystemProvider(root, fs_opts={"follow_symlinks": True}),
        "/alias": FilesystemProvider(root, fs_opts={"follow_symlinks": True}),
        "/readonly": FilesystemProvider(root, readonly=True, fs_opts={"follow_symlinks": True}),
    },
    "simple_dc": {"user_mapping": {"*": {"fixture": {"password": "fixture-only-password"}}}},
    "http_authenticator": {"accept_basic": True, "accept_digest": False, "default_to_digest": False},
    "property_manager": True,
    "lock_storage": True,
    "dir_browser": {"enable": False},
    "verbose": 1,
})
server = Server(("127.0.0.1", 0), app, numthreads=4, timeout=10)
server.ssl_adapter = BuiltinSSLAdapter(os.path.join(workspace, "cert.pem"), os.path.join(workspace, "key.pem"))
try:
    server.prepare()
    with open(os.path.join(workspace, "ready.json"), "x") as output:
        json.dump({"port": server.socket.getsockname()[1]}, output)
    server.serve()
finally:
    server.stop()
