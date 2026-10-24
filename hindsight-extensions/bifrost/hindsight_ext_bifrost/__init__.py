"""Bifrost extension for the Hindsight API server.

Configure the server to load it with::

    HINDSIGHT_API_LLM_REQUEST_EXTENSION=hindsight_ext_bifrost:BifrostExtension
"""

from hindsight_ext_bifrost.extension import BifrostExtension

__all__ = ["BifrostExtension"]
