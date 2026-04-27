# 📖 Heirloom — Digitize Your Family Recipes

**Turn shoeboxes of handwritten recipe cards and community cookbook pages into a living, searchable, beautifully formatted collection.**

Heirloom is a local-first CLI that ingests photos of recipe flashcards and cookbook pages — taken in bulk, in order — and produces structured, first-pass transcriptions ready for human review. OCR runs via AWS Textract, structured data persists in DynamoDB, and output is exported in three complementary formats: a printable PDF cookbook, an interlinked Obsidian vault, and direct datastore access for future tooling.

---

## The Problem

Family recipes live on index cards, in spiral-bound church cookbooks, and on stained notebook pages. They're fragile, scattered, and one coffee spill away from gone. Manually transcribing dozens (or hundreds) of them is a chore nobody finishes.

## The Idea

Photograph the whole stack. Let the machine do the first pass. Fix what it gets wrong. Keep the originals linked so nothing is lost.

---

## Input

### Image Corpus

A directory of photos, taken **in order**, covering one or both of these source types:

#### a) Recipe Flashcards

Standard index-card-style recipe cards, photographed in sequence. Supported capture orders:

| Layout | Photo Sequence |
|---|---|
| Simple (front/back) | front → back |
| Quartered (large or dense cards) | front-top → front-bottom → back-top → back-bottom |

Blank sections are **skipped** during capture — no need to photograph empty backs or unused quadrants. The pipeline infers card boundaries from the sequence metadata and image content.

#### b) Community Cookbook Pages

Pages from bound or stapled recipe booklets (church cookbooks, family reunion collections, etc.), photographed page-by-page in reading order.

### Context

These are **familial recipes across generations** — handwriting styles vary, ingredients may be regional or archaic ("oleo", "a coffee cup of flour"), and formatting is inconsistent by nature. The transcription pipeline should be tolerant of all of this and preserve the original voice rather than normalize it.

---

## Architecture

### Local-First CLI + AWS Backend

Heirloom runs as a local CLI tool using local AWS credentials. Cloud resources are limited to what the pipeline needs: image staging, OCR, and structured storage. No deployed compute — no Lambdas, no Step Functions. The CLI orchestrates everything.

### Hexagonal (Ports & Adapters)

Strict dependency direction following the ports and adapters pattern:

- `domain/` — pure business logic, zero external dependencies. Models, ports (interfaces), and services.
- `adapters/` — port implementations. Only layer that touches AWS SDK, file system, or export libraries.
- `shared/` — cross-cutting concerns: logger, custom errors, schemas.
- `config/` — Convict configuration schemas.

```
heirloom/
├── bin/                            # CLI entry point
├── infra/                          # CDK stacks
│   ├── stateful/                   # S3 bucket, DynamoDB tables (RETAIN)
│   └── stateless/                  # IAM policies, Textract access
├── src/
│   ├── domain/
│   │   ├── ports/                  # OCRProvider, DataStore, Exporter interfaces
│   │   ├── models/                 # Recipe, Source, Job — Zod schemas + types
│   │   └── services/               # Ingest, transcribe, export orchestration
│   ├── adapters/
│   │   ├── inbound/                # CLI command handlers
│   │   └── outbound/               # S3, Textract, DynamoDB, PDF, Obsidian adapters
│   ├── shared/                     # Logger, custom errors, shared schemas
│   └── config/                     # Convict config (AWS region, table names, bucket, etc.)
├── test/                           # Integration tests
└── .kiro/steering/                 # Project steering docs
```

### Dependency Rules (strict)

- `domain/` → depends on nothing. No AWS SDK, no file system, no adapters.
- `adapters/` → depends on `domain/` (implements port interfaces).
- `shared/` → depends on nothing. Consumed by all layers.
- `config/` → depends on nothing. Consumed by all layers.
- `infra/` → depends on `src/` only for reference constants (table names, bucket names).

---

## Pipeline

```
┌─────────────────┐
│  Local Images    │
│  (ordered dir)   │
└──────┬──────────┘
       │  CLI: ingest
       ▼
┌─────────────────┐
│  Card/Page       │  ← Detect boundaries, group images into logical
│  Segmentation    │    recipe units (front+back, multi-shot, pages)
└──────┬──────────┘
       │  CLI: upload
       ▼
┌─────────────────┐
│  S3 Staging      │  ← Upload unprocessed images, record in job table
│  + Job Tracking  │
└──────┬──────────┘
       │  CLI: transcribe
       ▼
┌─────────────────┐
│  AWS Textract    │  ← Async batch OCR (StartDocumentAnalysis)
│  (handwriting +  │    Poll or SNS notification for completion
│   printed text)  │
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  Structure       │  ← Parse Textract output into title / ingredients /
│  Extraction      │    steps / notes. Handle freeform layouts.
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  DynamoDB        │  ← Canonical recipe records + image refs +
│  Datastore       │    confidence scores + review status
└──────┬──────────┘
       │  CLI: export
       ├──► PDF Cookbook
       └──► Obsidian Vault
```

### Job Tracking

A DynamoDB table tracks processing state per image/document:

- Which images have been uploaded to S3
- Which Textract jobs have been submitted, are in progress, or completed
- Which results have been parsed and persisted as recipe records
- Error/retry state for failed jobs

The CLI checks this table to determine what work remains — `heirloom transcribe` only submits jobs for unprocessed documents, making the pipeline resumable and idempotent.

---

## AWS Resources (CDK)

### Stateful Stack (RETAIN policy)

| Resource | Purpose |
|---|---|
| S3 Bucket | Image staging — source photos uploaded here for Textract |
| DynamoDB Table: Recipes | Canonical recipe records (structured transcriptions) |
| DynamoDB Table: Jobs | Processing state tracking per image/document |

### Stateless Stack

| Resource | Purpose |
|---|---|
| IAM Policy | Textract access, scoped S3 read, DynamoDB read/write |

Minimal footprint. No compute resources deployed — the CLI runs locally and calls AWS APIs directly with local credentials.

---

## Output

Three synchronized output formats, all exported from the DynamoDB datastore:

### 1. 📄 PDF Cookbook

A print-ready PDF compiling all transcribed recipes into a cohesive book.

- Table of contents with page numbers
- Recipes grouped by category (if detectable) or source order
- Each recipe includes: title, attribution/source, ingredients, instructions
- Optional: thumbnail of the original card/page alongside the transcription
- Clean, readable typography — something you'd actually want to print and bind

### 2. 🗂️ Obsidian Vault

A fully structured [Obsidian](https://obsidian.md) vault for browsing, searching, linking, and extending the collection over time.

```
vault/
├── Recipes/
│   ├── Grandma's Cornbread.md
│   ├── Aunt Ruth's Chicken and Dumplings.md
│   └── ...
├── Sources/
│   ├── Mom's Card Box.md
│   └── First Baptist Cookbook 1987.md
├── Tags/
│   └── (managed via frontmatter)
├── Attachments/
│   └── originals/        ← source images downloaded from S3
└── README.md
```

Each recipe note includes:

- YAML frontmatter (source, category, tags, date if known, confidence score)
- Ingredients list
- Instructions
- Embedded or linked original image(s)
- Wikilinks to source, related recipes, and shared ingredients

### 3. 💾 DynamoDB Datastore

The persistent, canonical data layer that both the PDF and the vault are exported from.

- Structured recipe records (title, ingredients, steps, metadata)
- S3 key references to original source image(s) per recipe
- Transcription confidence scores per field
- Review/edit status tracking (unreviewed → reviewed → approved)
- Re-exportable — update a record, regenerate the PDF or vault

---

## Tech Stack

### Core

- **Language:** TypeScript (~5.9), strict mode, ES2022 target, NodeNext module resolution
- **Runtime:** Node.js 22.x
- **Infrastructure:** AWS CDK v2 (`aws-cdk-lib`)
- **Build:** `tsc` (no bundler for app code)
- **CLI entry:** `npx tsx bin/heirloom.ts`

### Key Libraries

- **zod** (v4) — runtime schema validation for Textract responses, domain models, CLI input. Import from `zod/v4`.
- **convict** — typed, environment-aware configuration (AWS region, bucket name, table names, etc.)
- **@aws-sdk/client-s3** — image upload/download
- **@aws-sdk/client-textract** — OCR job submission and result retrieval
- **@aws-sdk/lib-dynamodb** — recipe and job record persistence

### Testing

- **Jest 30** with `ts-jest`
- **fast-check** for property-based testing
- Colocated test files: `foo.unit.ts` (unit), `foo.pbt.ts` (property-based)
- Integration tests in `test/`

### Naming Conventions

| Scope | Convention | Example |
|---|---|---|
| Files and folders | `kebab-case` | `recipe-service.ts` |
| Classes / interfaces | `PascalCase` | `RecipeService` |
| Functions / variables | `camelCase` | `parseIngredients` |
| Environment variables | `SCREAMING_SNAKE_CASE` | `HEIRLOOM_BUCKET_NAME` |
| Zod schemas | `camelCase` + `Schema` suffix | `recipeSchema` |
| CDK construct IDs | `PascalCase` | `RecipeTable` |
| AWS resource names | `kebab-case` | `heirloom-recipes` |

### Error Handling

Custom error classes extending `Error` with a `cause` property, centralized in `src/shared/errors.ts`.

### Commit Conventions

Conventional Commits enforced via `commitlint` + Husky pre-commit hooks.

---

## Design Principles

- **First pass, not final pass.** The goal is a solid transcription that a human can quickly review and correct — not perfection out of the box. Surface confidence scores so reviewers know where to focus.
- **Preserve voice.** "A pinch" stays "a pinch." Don't normalize Grandma's language into sterile recipe-blog format.
- **Images are the source of truth.** Every transcription links back to its source photo in S3. If the OCR is wrong, the original is one click away.
- **Regenerable outputs.** DynamoDB is canonical. PDFs and vaults are derived artifacts that can be rebuilt after edits.
- **Batch-friendly.** Designed for processing dozens to hundreds of recipes in one go, not one at a time.
- **Resumable and idempotent.** Job tracking means you can stop and restart without reprocessing. Running the same command twice doesn't duplicate work.
- **Pluggable OCR.** Textract sits behind an `OCRProvider` port. Swappable for Tesseract, a vision LLM, or another service without touching domain logic.

---

## Common Commands

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript (`tsc`) |
| `npm run test` | Run all Jest tests (unit + PBT + integration) |
| `npm run clean` | Remove build artifacts |
| `cdk synth` | Synthesize CloudFormation templates |
| `cdk deploy --all` | Deploy S3 bucket, DynamoDB tables, IAM policies |
| `cdk destroy --all` | Tear down all stacks |
| `heirloom ingest <dir>` | Segment and register images from a local directory |
| `heirloom transcribe` | Upload unprocessed images to S3, submit Textract jobs |
| `heirloom export pdf` | Generate PDF cookbook from datastore |
| `heirloom export vault <dir>` | Generate Obsidian vault from datastore |

---

## Status

🧠 **Concept phase** — this README is the design sketch. No code yet.

---

## License

TBD
