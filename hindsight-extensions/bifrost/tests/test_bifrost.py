"""The bifrost extension, driven through the documented env value and its resolve()."""

import os
from unittest.mock import patch

from hindsight_api.extensions.llm_request import LLMRequestExtension, LLMRequestTarget
from hindsight_api.extensions.loader import load_extension

from hindsight_ext_bifrost import BifrostExtension


def _target(bank_id, operation="retain", provider="openai"):
    return LLMRequestTarget(schema="public", bank_id=bank_id, operation=operation, provider=provider, model="m")


def test_documented_env_value_loads_the_extension():
    env = {"HINDSIGHT_API_LLM_REQUEST_EXTENSION": "hindsight_ext_bifrost:BifrostExtension"}
    with patch.dict(os.environ, env, clear=False):
        assert isinstance(load_extension("LLM_REQUEST", LLMRequestExtension), BifrostExtension)


async def test_labels_bank_and_operation():
    overrides = await BifrostExtension({}).resolve(_target("woo-shop_1"))
    assert overrides.llm is None and overrides.api_key is None
    assert dict(overrides.headers) == {
        "x-bf-dim-hindsight-bank": "woo-shop_1",
        "x-bf-dim-hindsight-op": "retain",
        "x-bf-cache-key": "hindsight:woo-shop_1",
    }


async def test_unsafe_or_missing_values():
    headers = (await BifrostExtension({}).resolve(_target("a b\r\nx-bf-vk: stolen", operation=None))).headers
    assert headers["x-bf-dim-hindsight-bank"] == "invalid"
    assert headers["x-bf-cache-key"] == "hindsight:invalid"
    assert headers["x-bf-dim-hindsight-op"] == "none"
    assert (await BifrostExtension({}).resolve(_target(None))).headers["x-bf-dim-hindsight-bank"] == "none"


async def test_other_provider_untouched():
    assert await BifrostExtension({}).resolve(_target("bank", provider="gemini")) is None
