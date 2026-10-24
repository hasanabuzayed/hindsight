# Bifrost extension

A Hindsight `LLMRequestExtension` for servers whose LLM is a [Bifrost](https://github.com/maximhq/bifrost)
gateway. It adds headers to each LLM call, and changes nothing else (same endpoint, key and model):

| Header | Value | In Bifrost |
| --- | --- | --- |
| `x-bf-dim-hindsight-bank` | the bank id | A label on metrics and log entries: spend and latency per bank |
| `x-bf-dim-hindsight-op` | the operation (`retain`, `reflect`, `consolidation`, ...) | Spend per operation |
| `x-bf-cache-key` | `hindsight:<bank id>` | Semantic cache entries of one bank never answer another bank |

- Only calls to the `openai` provider (Bifrost's OpenAI-compatible endpoint) get the headers.
- A bank id outside `[A-Za-z0-9._:-]{1,128}` becomes `invalid`, and a missing value becomes `none`.
- Each bank adds one metric label value. Drop the bank dimension if banks number in the thousands.
- Headers from `HINDSIGHT_API_LLM_DEFAULT_HEADERS` stay. These headers are added to them.

## Configure

```bash
HINDSIGHT_API_LLM_REQUEST_EXTENSION=hindsight_ext_bifrost:BifrostExtension
HINDSIGHT_API_LLM_PROVIDER=openai
HINDSIGHT_API_LLM_BASE_URL=http://bifrost:8080/v1
```

Give the API and every worker the same variables. Batch retain
(`HINDSIGHT_API_RETAIN_BATCH_ENABLED=true`) is refused with any `LLM_REQUEST` extension.

## Develop

```bash
uv sync
uv run pytest tests -v
```
