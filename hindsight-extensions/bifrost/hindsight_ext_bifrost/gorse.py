"""Experimental Hindsight MCPExtension: read-only Gorse recommendation tools.

A shop agent gets customer memory and product recommendations from one MCP endpoint
(``/mcp/<bank_id>/``). Feedback writes stay on the NATS ``WOO`` stream and gorse-sink,
so these tools only read.

Off unless the flag is set. Config comes from ``HINDSIGHT_API_MCP_*``::

    HINDSIGHT_API_MCP_EXTENSION=hindsight_ext_bifrost:GorseMCPExtension
    HINDSIGHT_API_MCP_GORSE_ENABLED=true          # experimental flag, default off
    HINDSIGHT_API_MCP_GORSE_URL=http://gorse-server:8087
    HINDSIGHT_API_MCP_GORSE_API_KEY=...
"""

import logging
import re
from urllib.parse import quote

import httpx
from fastmcp import FastMCP

from hindsight_api.extensions.mcp import MCPExtension

logger = logging.getLogger(__name__)

# Recommender names come from the model: only names Gorse could have in its config.
_NAME = re.compile(r"[A-Za-z0-9_-]{1,64}")
_MAX_N = 50


def _n(n: int) -> int:
    return max(1, min(int(n), _MAX_N))


def _name(value: str) -> str:
    if not _NAME.fullmatch(value):
        raise ValueError(f"invalid recommender name: {value!r}")
    return value


def _params(n: int, category: str | None) -> dict[str, str | int]:
    params: dict[str, str | int] = {"n": _n(n)}
    if category:
        params["category"] = category
    return params


class GorseMCPExtension(MCPExtension):
    def __init__(self, config: dict[str, str]):
        super().__init__(config)
        self.enabled = config.get("gorse_enabled", "false").strip().lower() == "true"
        self.url = config.get("gorse_url", "http://gorse-server:8087").rstrip("/")
        self.api_key = config.get("gorse_api_key", "")

    async def _get(self, path: str, params: dict[str, str | int]) -> object:
        async with httpx.AsyncClient(base_url=self.url, timeout=10.0) as client:
            response = await client.get(path, params=params, headers={"X-API-Key": self.api_key})
            response.raise_for_status()
            return response.json() or []

    def register_tools(self, mcp: FastMCP, memory) -> None:
        if not self.enabled:
            logger.info("Gorse MCP tools are off (HINDSIGHT_API_MCP_GORSE_ENABLED is not true)")
            return
        logger.info(f"Gorse MCP tools are on (experimental), Gorse at {self.url}")

        @mcp.tool()
        async def gorse_recommend(user_id: str, n: int = 10, category: str | None = None) -> object:
            """[Experimental] Personal product recommendations for a shop customer, best first.

            Returns Gorse item ids (WooCommerce product ids). A new customer gets the
            fallback list, so the answer is never empty while the catalog has items.
            """
            return await self._get(f"/api/recommend/{quote(user_id, safe='')}", _params(n, category))

        @mcp.tool()
        async def gorse_similar_items(
            item_id: str, n: int = 10, recommender: str = "neighbors", category: str | None = None
        ) -> object:
            """[Experimental] Products similar to one product, as [{"Id", "Score"}], best first.

            recommender is a Gorse item-to-item recommender: neighbors (default),
            olfactory_accord_neighbors, laya_tags or co_purchased.
            """
            path = f"/api/item-to-item/{_name(recommender)}/{quote(item_id, safe='')}"
            return await self._get(path, _params(n, category))

        @mcp.tool()
        async def gorse_popular(n: int = 10, recommender: str = "popular", category: str | None = None) -> object:
            """[Experimental] Non-personalized product lists, as [{"Id", "Score"}], best first.

            recommender is a Gorse non-personalized recommender: popular (default),
            bestsellers, trending_weekly, most_starred_weekly, trending_fragrances_30d
            or top_rated_signature_scents.
            """
            return await self._get(f"/api/non-personalized/{_name(recommender)}", _params(n, category))
