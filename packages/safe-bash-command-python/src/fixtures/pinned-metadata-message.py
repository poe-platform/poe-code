# Native metadata getter and adapter methods extracted verbatim from Pyodide 314.0.6.
# Only the methods used by distribution metadata parsing are included.
from __future__ import annotations
from typing import cast
import email.message
import functools
import textwrap
import warnings

_warn = functools.partial(
    warnings.warn,
    "Implicit None on return values is deprecated and will raise KeyErrors.",
    DeprecationWarning,
    stacklevel=2,
)

class Message(email.message.Message):
    def __new__(cls, orig: email.message.Message):
        res = super().__new__(cls)
        vars(res).update(vars(orig))
        return res

    def __init__(self, *args, **kwargs):
        self._headers = self._repair_headers()

    def __iter__(self):
        return super().__iter__()

    def __getitem__(self, item):
        """
        Warn users that a ``KeyError`` can be expected when a
        missing key is supplied. Ref python/importlib_metadata#371.
        """
        res = super().__getitem__(item)
        if res is None:
            _warn()
        return res

    def _repair_headers(self):
        def redent(value):
            "Correct for RFC822 indentation"
            if not value or '\n' not in value:
                return value
            return textwrap.dedent(' ' * 8 + value)

        headers = [(key, redent(value)) for key, value in vars(self)['_headers']]
        if self._payload:
            headers.append(('Description', self.get_payload()))
        return headers

def metadata(self) -> _meta.PackageMetadata:
    """Return the parsed metadata for this Distribution.

    The returned object will have keys that name the various bits of
    metadata per the
    `Core metadata specifications <https://packaging.python.org/en/latest/specifications/core-metadata/#core-metadata>`_.

    Custom providers may provide the METADATA file or override this
    property.
    """
    # deferred for performance (python/cpython#109829)
    from . import _adapters

    opt_text = (
        self.read_text('METADATA')
        or self.read_text('PKG-INFO')
        # This last clause is here to support old egg-info files.  Its
        # effect is to just end up using the PathDistribution's self._path
        # (which points to the egg-info file) attribute unchanged.
        or self.read_text('')
    )
    text = cast(str, opt_text)
    return _adapters.Message(email.message_from_string(text))
