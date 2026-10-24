"""The experimental Gorse MCP extension: off by default, and safe paths when on."""

import os
from unittest.mock import patch

import httpx
import pytest
from fastmcp import FastMCP

from hindsight_api.extensions.loader import load_extension
from hindsight_api.extensions.mcp import MCPExtension

from hindsight_ext_bifrost import GorseMCPExtension

ENV = {
    "HINDSIGHT_API_MCP_EXTENSION": "hindsight_ext_bifrost:GorseMCPExtension",
    "HINDSIGHT_API_MCP_GORSE_URL": "http://gorse.test:8087/",
    "HINDSIGHT_API_MCP_GORSE_API_KEY": "k",
}


async def _tool_names(mcp: FastMCP) -> set[str]:
    return {t.name for t in await mcp.list_tools()}


async def test_off_unless_flag_is_true():
    with patch.dict(os.environ, ENV, clear=False):
        ext = load_extension("MCP", MCPExtension)
    assert isinstance(ext, GorseMCPExtension) and not ext.enabled
    mcp = FastMCP("t")
    ext.register_tools(mcp, None)
    assert not {n for n in await _tool_names(mcp) if n.startswith("gorse_")}


@pytest.fixture
def calls(monkeypatch):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[{"Id": "105", "Score": 1.0}])

    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    return seen


async def test_tools_call_gorse_read_only(calls):
    with patch.dict(os.environ, {**ENV, "HINDSIGHT_API_MCP_GORSE_ENABLED": "true"}, clear=False):
        ext = load_extension("MCP", MCPExtension)
    mcp = FastMCP("t")
    ext.register_tools(mcp, None)
    assert await _tool_names(mcp) >= {"gorse_recommend", "gorse_similar_items", "gorse_popular"}

    await mcp.call_tool("gorse_recommend", {"user_id": "a/../b", "n": 999, "category": "fragrance"})
    await mcp.call_tool("gorse_similar_items", {"item_id": "104"})
    await mcp.call_tool("gorse_popular", {"recommender": "bestsellers", "n": 3})
    # raw_path: url.path is decoded and would hide whether the slash was quoted.
    assert [(r.method, r.url.raw_path.split(b"?")[0].decode(), dict(r.url.params)) for r in calls] == [
        ("GET", "/api/recommend/a%2F..%2Fb", {"n": "50", "category": "fragrance"}),
        ("GET", "/api/item-to-item/neighbors/104", {"n": "10"}),
        ("GET", "/api/non-personalized/bestsellers", {"n": "3"}),
    ]
    assert all(r.headers["x-api-key"] == "k" for r in calls)

    with pytest.raises(Exception, match="invalid recommender name"):
        await mcp.call_tool("gorse_popular", {"recommender": "../users"})
