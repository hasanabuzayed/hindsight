"""Hindsight LLMRequestExtension that labels each LLM call for Bifrost.

- x-bf-dim-hindsight-bank / x-bf-dim-hindsight-op: Bifrost telemetry and log labels,
  so the dashboard shows spend per bank and per operation.
- x-bf-cache-key: scopes semantic cache entries to the bank, so one bank's cached
  answer never answers another bank.

Headers only: the server's Bifrost endpoint, key and default headers stay as they are.

    HINDSIGHT_API_LLM_REQUEST_EXTENSION=hindsight_ext_bifrost:BifrostExtension
"""

import re

from hindsight_api.extensions.llm_request import LLMRequestExtension, LLMRequestOverrides, LLMRequestTarget

# Bank ids come from API callers: anything outside this set becomes "invalid" instead of
# reaching a header. ponytail: one label value per bank, fine for a handful of banks;
# drop the bank dimension if banks ever number in the thousands (Prometheus cardinality).
_SAFE = re.compile(r"[A-Za-z0-9._:-]{1,128}")


def _label(value: str | None) -> str:
    if value is None:
        return "none"
    return value if _SAFE.fullmatch(value) else "invalid"


class BifrostExtension(LLMRequestExtension):
    async def resolve(self, target: LLMRequestTarget) -> LLMRequestOverrides | None:
        # Bifrost is the server's OpenAI-compatible endpoint. Any other provider is not Bifrost.
        if target.provider != "openai":
            return None
        bank = _label(target.bank_id)
        return LLMRequestOverrides(
            headers={
                "x-bf-dim-hindsight-bank": bank,
                "x-bf-dim-hindsight-op": _label(target.operation),
                "x-bf-cache-key": f"hindsight:{bank}",
            }
        )
