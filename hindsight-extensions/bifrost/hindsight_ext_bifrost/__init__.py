"""Homelab extensions for the Hindsight API server.

Configure the server to load them with::

    HINDSIGHT_API_LLM_REQUEST_EXTENSION=hindsight_ext_bifrost:BifrostExtension
    HINDSIGHT_API_MCP_EXTENSION=hindsight_ext_bifrost:GorseMCPExtension  # experimental, see gorse.py
"""

from hindsight_ext_bifrost.extension import BifrostExtension
from hindsight_ext_bifrost.gorse import GorseMCPExtension

__all__ = ["BifrostExtension", "GorseMCPExtension"]
