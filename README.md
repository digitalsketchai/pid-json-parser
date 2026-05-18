# pid-json-parser  Parse PID infomation & spec details

AI-powered parser for extracting structured specifications, info box, project details and engineering metadata from P&ID drawings and process documents.

Converts P&ID PDFs and images into machine-readable JSON for industrial automation, asset intelligence, and engineering data workflows.

---

## Node.js Sample Code for P&ID Drawing Info Extraction

Extract drawing-level information from P&ID drawings into JSON format using AI-powered document and drawing analysis.

This sample Node.js client demonstrates how to upload images or multi-page PDF drawings, run a P&ID extraction pipeline, and save the drawing info (title block, sheet metadata, drawing attributes, and other engineering details) as JSON output.

The workflow supports automated extraction of drawing metadata, titles, revisions, sheet info, and other engineering-document attributes from P&IDs.

---

## Features

- Single-image upload support (PNG, JPG, JPEG, BMP)
- Multi-page PDF processing
- AI-based extraction and digitization pipeline
- Automatic polling for processing and pipeline status
- Structured drawing info JSON output per page
- Configurable polling intervals and timeout settings via environment variables
- Batch-friendly workflow for large engineering document sets

---

## Prerequisites

- Node.js 18 or newer
- Access to a compatible P&ID extraction API or AI processing service
- API credentials or authentication token (if required)

---

## Output

The extraction pipeline generates structured JSON files containing drawing-level information detected from the P&ID drawings.

Typical extracted data may include:

- Drawing title and number
- Revision and status
- Sheet and page metadata
- Project and client info
- Title block fields
- Notes, legends, and references
- Document-level annotations

Output files are saved in the `info/` directory.

---

## Typical Workflow

1. Upload image or PDF drawings
2. Start extraction pipeline
3. Monitor processing status
4. Retrieve structured drawing info
5. Save results as JSON

---

## Supported File Types

- PNG
- JPG / JPEG
- BMP
- PDF (multi-page supported)

---

## Use Cases

- Engineering document digitization
- Drawing register and title-block extraction
- P&ID modernization projects
- Data migration into asset management systems
- AI-assisted engineering workflows
- Searchable engineering documentation

Official Node.js sample code for the [DigitalSketch.ai](https://digitalsketch.ai) P&ID digitization API.

- Website: [digitalsketch.ai](https://digitalsketch.ai)
- API base: [api.digitalsketch.ai](https://api.digitalsketch.ai)
- API docs: [api.digitalsketch.ai/documentation](https://api.digitalsketch.ai/documentation)

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/<your-org>/pid-json-parser.git
cd pid-json-parser

npm install
```

### 2. Configure your API key

Copy `.env.example` to `.env` and add your key:

```env
DIGITALSKETCH_API_KEY=your_api_key_here
DIGITALSKETCH_API_BASE=https://api.digitalsketch.ai

# Optional polling / timeout overrides (defaults shown)
PIPELINE_STATUS_POLL_INTERVAL_SECONDS=40
PIPELINE_STATUS_TIMEOUT_SECONDS=7200
RUN_ID_POLL_INTERVAL_SECONDS=15
RUN_ID_TIMEOUT_SECONDS=600
PDF_POLL_INTERVAL_SECONDS=2
PDF_TIMEOUT_SECONDS=900
```

### 3. Run the extractor

Place a P&ID file in the `sample/` folder (PNG, JPG, JPEG, BMP, or PDF). If no filename is given, the first supported file in the folder is used.

```bash
# Process the first supported file in sample/
node extract_info.js

# Or specify a file
node extract_info.js sample.pdf
node extract_info.js multipage.pdf
node extract_info.js sample.jpg
```

### 4. Inspect the output

Drawing info is written to `info/` as JSON:

```
# Single image
info/<name>_<imageid>_info.json

# Multi-page PDF (one file per page)
info/<name>_page1_<imageid>_info.json
info/<name>_page2_<imageid>_info.json
```

---

## How the Pipeline Works

| Step | Endpoint | Purpose |
|------|----------|---------|
| 1 | `POST /digitalsketch/uploadimage` | Upload a single image (base64) |
| 1 | `POST /digitalsketch/uploadpdf/multipart` | Upload a multi-page PDF |
| 2 | `POST /digitalsketch/uploadpdfstatus` | Poll PDF processing, get per-page `imageid`s |
| 3 | `POST /digitalsketch/{imageid}/imagedetails` | Get metadata for an uploaded image |
| 4 | `POST /digitalsketch/pipeline/start` | Start the digitization pipeline |
| 4 | `POST /digitalsketch/pipeline/id` | Resolve `run_id` if not returned synchronously |
| 5 | `POST /digitalsketch/pipeline/status` | Poll pipeline status by `run_id` |
| 6 | `GET /digitalsketch/diagram/info/all` | Retrieve final drawing info |

Full reference: [api.digitalsketch.ai/documentation](https://api.digitalsketch.ai/documentation)

---

## Repository Layout

```
.
|-- extract_info.js           # End-to-end pipeline client
|-- package.json              # Node.js dependencies
|-- .env.example              # Template for environment variables
|-- .gitignore
|-- sample/                   # Drop your P&ID images / PDFs here
|   |-- sample.jpg
|   |-- sample.pdf
|   `-- multipage.pdf
`-- info/                     # Drawing info written here (gitignored)
```

---

## Troubleshooting

- **`ERROR: DIGITALSKETCH_API_KEY is not set`** - create `.env` from `.env.example` and add your key.
- **HTTP 401 / 403** - verify your API key at [api.digitalsketch.ai/documentation](https://api.digitalsketch.ai/documentation).
- **Pipeline timeout** - large PDFs may need a higher `PIPELINE_STATUS_TIMEOUT_SECONDS`.
- **"Image size too small" warning** - the corresponding PDF page could not be extracted; an empty info file is written and processing continues for the remaining pages.

---

## License

(c) 2025 DigitalSketch.ai, Inc. All rights reserved.
