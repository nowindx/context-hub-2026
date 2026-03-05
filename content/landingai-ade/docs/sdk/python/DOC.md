---
name: landingai-ade-python
description: "Python SDK reference for LandingAI's Agentic Document Extraction (ADE). Includes Pydantic schema extraction, async processing, error handling, save_to, visual grounding, table cell lookup, and complete API context."
metadata:
  languages: "python"
  versions: ">=0.1.0"
  updated-on: "2026-03-04"
  source: maintainer
  tags: "landingai,ade,python,sdk,pydantic,document-extraction,parse,extract,split,async"
---

# LandingAI ADE — Python SDK Reference

Python SDK for LandingAI's Agentic Document Extraction.

## Installation

```bash
pip install landingai-ade
export VISION_AGENT_API_KEY="v2_..."
```

## Client Setup

```python
from landingai_ade import LandingAIADE
from pathlib import Path

client = LandingAIADE()  # Uses VISION_AGENT_API_KEY env var
```

### Constructor Arguments

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `api_key` | `str \| None` | env `VISION_AGENT_API_KEY` | API key |
| `environment` | `"production" \| "eu"` | `"production"` | Region — `"production"` (US) or `"eu"` |
| `base_url` | `str \| None` | — | Override base URL |
| `timeout` | `float \| Timeout \| None` | SDK default | Request timeout in seconds |
| `max_retries` | `int` | SDK default | Max retry attempts for transient errors |
| `http_client` | `httpx.Client \| None` | — | Custom httpx client |

```python
# EU region
client = LandingAIADE(environment="eu")

# Pass key directly
client = LandingAIADE(api_key="v2_...")
```

---

## 1. Parse

Converts documents to structured markdown with visual grounding.

### Arguments

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `document` | `FileTypes \| None` | One required | Local file (Path, bytes, file-like) |
| `document_url` | `str \| None` | One required | Remote document URL |
| `model` | `str \| None` | No | Model version (default: `dpt-2-latest`) |
| `split` | `"page" \| None` | No | Split by pages |
| `save_to` | `str \| None` | No | Directory to save `{filename}_parse_output.json` |

### Returns `ParseResponse`

```
.markdown          → str: full document as markdown
.chunks[]          → Chunk: {id, type, markdown, grounding: {page, box}}
.grounding         → dict: {id → Grounding} with bounding boxes and tableCell positions
.splits[]          → Split: {chunks[], class, identifier, markdown, pages[]} (only if split="page")
.metadata          → ParseMetadata: {filename, page_count, duration_ms, credit_usage, version, job_id, failed_pages}
```

### Example

```python
response = client.parse(
    document=Path("invoice.pdf"),
    model="dpt-2-latest",
    save_to="./output",
)

print(response.markdown)
print(f"{len(response.chunks)} chunks, {response.metadata.page_count} pages")

tables = [c for c in response.chunks if c.type == "table"]
```

### Visual Grounding and Table Cells

```python
for chunk in response.chunks:
    box = chunk.grounding.box
    print(f"{chunk.type} on page {chunk.grounding.page}: "
          f"({box.left:.3f}, {box.top:.3f}) → ({box.right:.3f}, {box.bottom:.3f})")

for gid, grounding in response.grounding.items():
    if grounding.type == "tableCell":
        pos = grounding.position
        print(f"Cell ({pos.row}, {pos.col}) span=({pos.rowspan}x{pos.colspan})")
```

### Extract a Cell Value by Row and Column (PDF)

```python
import re

table = next(c for c in response.chunks if c.type == "table")

rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table.markdown, re.DOTALL)
grid = {}
for r, row_html in enumerate(rows):
    for c, m in enumerate(re.finditer(r'<td[^>]*>(.*?)</td>', row_html, re.DOTALL)):
        grid[(r, c)] = re.sub(r'<[^>]+>', '', m.group(1)).strip()

value = grid[(1, 0)]  # zero-indexed row, col
```

### Read a Spreadsheet Cell by Reference

```python
import re

response = client.parse(document=Path("report.xlsx"))
table = next(c for c in response.chunks if c.type == "table")

# Spreadsheet cell IDs are "{tab_name}-{cell_ref}" (e.g., "Sheet 1-B2").
# grounding is null for spreadsheets, so parse IDs directly from HTML.
cell_text = {}
for m in re.finditer(
    r'<td[^>]*\bid=["\']([^"\']+)["\'][^>]*>(.*?)</td>',
    table.markdown, re.DOTALL,
):
    cell_text[m.group(1)] = re.sub(r"<[^>]+>", "", m.group(2)).strip()

value = cell_text["Sheet 1-B2"]
```

---

## 2. Extract

Extracts structured data from markdown using a JSON schema.

### Arguments

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `schema` | `str` | Yes | JSON schema string (use `pydantic_to_json_schema()` to generate from Pydantic models) |
| `markdown` | `FileTypes \| str \| None` | One required | Markdown content, string, or file |
| `markdown_url` | `str \| None` | One required | URL to markdown |
| `model` | `str \| None` | No | Model version (default: `extract-latest`) |
| `save_to` | `str \| None` | No | Directory to save `{filename}_extract_output.json` |

### Returns `ExtractResponse`

```
.extraction        → dict: extracted key-value pairs matching schema
.extraction_metadata → dict: {field → {references: [chunk_ids]}} for grounding
.metadata          → Metadata: {credit_usage, duration_ms, filename, job_id, version, schema_violation_error}
```

### Pydantic Schema Extraction

```python
from pydantic import BaseModel, Field
from landingai_ade.lib import pydantic_to_json_schema

class InvoiceData(BaseModel):
    invoice_number: str = Field(description="Invoice number or ID")
    total_amount: float = Field(description="Total amount to be paid")
    vendor_name: str = Field(description="Vendor or supplier name")
    line_items: list[dict] | None = Field(default=None, description="Line items")

# Parse once, extract many
parsed = client.parse(document=Path("invoice.pdf"))

response = client.extract(
    markdown=parsed.markdown,
    schema=pydantic_to_json_schema(InvoiceData),
)

invoice = InvoiceData(**response.extraction)
print(f"Invoice {invoice.invoice_number}: ${invoice.total_amount}")
```

### Grounding References (Tracing Back to Source)

```python
chunk_map = {c.id: c for c in parsed.chunks}

for field, meta in response.extraction_metadata.items():
    if meta.get("references"):
        chunk = chunk_map.get(meta["references"][0])
        if chunk:
            print(f"{field}: page {chunk.grounding.page}, type={chunk.type}")
```

### `pydantic_to_json_schema(model)`

Converts a Pydantic `BaseModel` class to a resolved JSON schema string (all `$ref` inlined). Pass the result directly to `schema=`.

```python
from landingai_ade.lib import pydantic_to_json_schema

schema_str = pydantic_to_json_schema(InvoiceData)  # → JSON string
```

---

## 3. Split

Classifies and splits mixed documents by type.

### Arguments

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `split_class` | `Iterable[SplitClass]` | Yes | List of `{"name": str, "description"?: str, "identifier"?: str}` |
| `markdown` | `FileTypes \| str \| None` | One required | Markdown content or file |
| `markdown_url` | `str \| None` | One required | URL to markdown |
| `model` | `str \| None` | No | Model version (default: `split-latest`) |
| `save_to` | `str \| None` | No | Directory to save `{filename}_split_output.json` |

### Returns `SplitResponse`

```
.splits[]          → Split: {classification, identifier, markdowns[], pages[]}
.metadata          → Metadata: {credit_usage, duration_ms, filename, page_count}
```

### Split → Extract Pipeline

```python
parsed = client.parse(document=Path("mixed_invoices.pdf"))

splits = client.split(
    markdown=parsed.markdown,
    split_class=[
        {"name": "Invoice", "description": "Sales invoice", "identifier": "Invoice Number"},
        {"name": "Receipt", "description": "Payment receipt", "identifier": "Receipt Number"},
    ],
)

for split in splits.splits:
    print(f"{split.classification}: {split.identifier} (pages {split.pages})")

# Extract from each split
schema = pydantic_to_json_schema(InvoiceData)
results = []
for split in splits.splits:
    extracted = client.extract(markdown=split.markdowns[0], schema=schema)
    results.append({"type": split.classification, "id": split.identifier, **extracted.extraction})
```

---

## 4. Parse Jobs (Async, Large Files)

For files >50MB, use asynchronous processing.

### `parse_jobs.create()` Arguments

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `document` | `FileTypes \| None` | One required | Local file |
| `document_url` | `str \| None` | One required | Remote document URL |
| `model` | `str \| None` | No | Model version (default: `dpt-2-latest`) |
| `split` | `"page" \| None` | No | Split by pages |
| `output_save_url` | `str \| None` | If ZDR | URL for zero data retention output |

### Returns `ParseJobCreateResponse`

```
.job_id            → str: unique job identifier
```

### `parse_jobs.get(job_id)` Returns `ParseJobGetResponse`

```
.job_id            → str
.status            → str: pending|processing|completed|failed|cancelled
.progress          → float: 0.0 to 1.0
.failure_reason    → str | None: error message if failed
.data              → ParseResponse | None: full result when completed
.output_url        → str | None: presigned URL if result >1MB (expires 1hr)
```

### `parse_jobs.list()` Arguments & Returns

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | `"pending" \| "processing" \| "completed" \| "failed" \| "cancelled"` | No | Filter by status |
| `page` | `int \| None` | No | Page number (0-indexed) |
| `page_size` | `int \| None` | No | Items per page |

```
.jobs[]            → Job: {job_id, status, progress, received_at, failure_reason}
.has_more          → bool | None
```

### Example

```python
import time

job = client.parse_jobs.create(document=Path("large.pdf"))
print(f"Job ID: {job.job_id}")

while True:
    status = client.parse_jobs.get(job.job_id)
    print(f"Status: {status.status}, Progress: {status.progress * 100:.0f}%")

    if status.status == "completed":
        result = status.data  # ParseResponse
        break
    elif status.status == "failed":
        raise RuntimeError(f"Job failed: {status.failure_reason}")

    time.sleep(5)
```

---

## Error Handling

### Exception Classes

All exceptions inherit from `LandingAiadeError`:

| Exception | HTTP Status | Description |
|-----------|-------------|-------------|
| `BadRequestError` | 400 | Invalid parameters |
| `AuthenticationError` | 401 | Invalid API key |
| `PermissionDeniedError` | 403 | Forbidden |
| `NotFoundError` | 404 | Resource not found |
| `UnprocessableEntityError` | 422 | Invalid file type or malformed schema |
| `RateLimitError` | 429 | Too many requests |
| `InternalServerError` | 5xx | Server error |
| `APIConnectionError` | — | Network failure |
| `APITimeoutError` | — | Request timeout |

`APIStatusError` is the base for all HTTP errors and has a `status_code` attribute.

### Retry with Fallback to Jobs

```python
from landingai_ade import RateLimitError, APITimeoutError, APIStatusError, APIConnectionError

def parse_with_retry(client, file_path, max_retries=3):
    for attempt in range(max_retries):
        try:
            return client.parse(document=Path(file_path))
        except RateLimitError:
            time.sleep(2 ** attempt * 10)
        except (APITimeoutError, APIStatusError) as e:
            if isinstance(e, APIStatusError) and e.status_code not in (413, 504):
                raise
            print("Timeout or too large — switching to parse jobs")
            job = client.parse_jobs.create(document=Path(file_path))
            return poll_job(client, job.job_id)
        except APIConnectionError:
            time.sleep(2)
    raise RuntimeError("Failed after retries")

def poll_job(client, job_id, timeout=300):
    start = time.time()
    while time.time() - start < timeout:
        status = client.parse_jobs.get(job_id)
        if status.status == "completed":
            return status.data
        if status.status == "failed":
            raise RuntimeError(f"Job failed: {status.failure_reason}")
        time.sleep(5)
    raise TimeoutError("Job did not complete in time")
```

---

## Async / Concurrent Processing

```python
import asyncio
from landingai_ade import AsyncLandingAIADE

async def parse_multiple(files: list[str]):
    client = AsyncLandingAIADE()
    tasks = [client.parse(document=Path(f)) for f in files]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return [r for r in results if not isinstance(r, Exception)]
```

`AsyncLandingAIADE` has the same constructor and methods as `LandingAIADE` — all methods are `async`.

---

## API Reference

The following sections provide the complete API context so this document is fully self-contained.

### Base Configuration

| Region | Base URL |
|--------|----------|
| US (default) | `https://api.va.landing.ai/v1/ade` |
| EU | `https://api.va.eu-west-1.landing.ai/v1/ade` |

**Authentication**: All requests require `Authorization: Bearer $VISION_AGENT_API_KEY`

### Quick Reference

| Endpoint | Method | Path | Model | Input |
|----------|--------|------|-------|-------|
| Parse | POST | `/v1/ade/parse` | `dpt-2-latest` | `document` (file) or `document_url` |
| Extract | POST | `/v1/ade/extract` | `extract-latest` | `markdown` (file/string) or `markdown_url` + `schema` |
| Split | POST | `/v1/ade/split` | `split-latest` | `markdown` (file/string) or `markdown_url` + `split_class` |
| Create Job | POST | `/v1/ade/parse/jobs` | `dpt-2-latest` | `document` or `document_url` |
| Get Job | GET | `/v1/ade/parse/jobs/{id}` | — | — |
| List Jobs | GET | `/v1/ade/parse/jobs` | — | `?status=&page=&pageSize=` |

### Data Types

#### Chunk Types
- `text` — Characters, paragraphs, headings, lists, form fields, checkboxes, code blocks
- `table` — Grid of rows and columns; includes spreadsheets and receipts
- `figure` — Visual/graphical non-text content — images, graphs, flowcharts, diagrams
- `marginalia` — Content in document margins — headers, footers, page numbers, handwritten notes
- `logo` — Logos (DPT-2 only)
- `card` — ID cards and driver's licenses (DPT-2 only)
- `attestation` — Signatures, stamps, and seals (DPT-2 only)
- `scan_code` — QR codes and barcodes (DPT-2 only)

#### Grounding Types
- Chunk grounding: `chunkText`, `chunkTable`, `chunkFigure`, `chunkMarginalia`, `chunkLogo`, `chunkCard`, `chunkAttestation`, `chunkScanCode`
- Structure: `table`, `tableCell` (with position data)

#### Bounding Box
All coordinates normalized 0–1: `{ left, top, right, bottom }`.

#### Table Cell Position
`{ row, col, rowspan, colspan, chunk_id }` — zero-indexed.

#### Table Chunk Formats

**PDF/Image tables**: Element IDs use `{page}-{base62_seq}`. Grounding object has bounding boxes and `tableCell` entries.

**Spreadsheet tables (XLSX/CSV)**: Element IDs use `{tab_name}-{cell_ref}` (e.g., `Sheet 1-B2`). **Grounding is null** — positions are encoded in IDs.

### Error Codes

| Status | Error Type | Description | Solution |
|--------|------------|-------------|----------|
| 400 | `validation_error` | Invalid parameters | Check request format |
| 401 | `authentication_error` | Invalid API key | Check VISION_AGENT_API_KEY |
| 413 | `payload_too_large` | File too large | Use Parse Jobs API |
| 422 | `unprocessable_entity` | Invalid file type or malformed schema | Validate file format and schema JSON |
| 429 | `rate_limit_error` | Too many requests | Implement backoff |
| 500 | `internal_error` | Server error | Retry with backoff |
| 504 | `timeout_error` | Request timeout | Use Parse Jobs API |

### Supported File Types

| Category | Formats | Notes |
|----------|---------|-------|
| **PDF** | PDF | Up to 100 pages; no password-protected files |
| **Images** | JPEG, JPG, PNG, APNG, BMP, DCX, DDS, DIB, GD, GIF, ICNS, JP2, PCX, PPM, PSD, TGA, TIF, TIFF, WEBP | |
| **Text Documents** | DOC, DOCX, ODT | Converted to PDF before parsing |
| **Presentations** | ODP, PPT, PPTX | Converted to PDF before parsing |
| **Spreadsheets** | CSV, XLSX | Up to 10 MB in Playground; no sheet/column/row limits |

> **Note:** Word, PowerPoint, and OpenDocument files are converted to PDF server-side before parsing.

### Model Versions

| Operation | Current Version | Description |
|-----------|----------------|-------------|
| Parse | `dpt-2-latest` | Document parsing and OCR |
| Extract | `extract-latest` | Schema-based extraction |
| Split | `split-latest` | Document classification |

---

## External Links

- [Python SDK Documentation](https://docs.landing.ai/ade/ade-python)
- [Python SDK GitHub](https://github.com/landing-ai/ade-python)
