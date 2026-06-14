# 📖 Heirloom — Digitize Your Family Recipes

Turn shoeboxes of handwritten recipe cards and community cookbook pages into a searchable, formatted collection.

Heirloom (love the names the machine makes up for these things, gotta have a title) is a local-first CLI that ingests photos of recipe flashcards and cookbook pages, taken in bulk and in order, and produces structured, first-pass transcriptions ready for human review. OCR runs via AWS Textract, structured data persists in DynamoDB, and output exports as a printable PDF cookbook, an interlinked Obsidian vault, or direct datastore access for future tooling.

## The problem & solution

My family's recipes live on index cards, in spiral-bound cookbooks, and on notebook pages. They're fading, scattered, and one coffee spill away from gone. Manually transcribing dozens (or hundreds) of them would take quite a lot of tedious effort.

So instead, we photograph the whole stack, have the machine generate/manage job docs to connect photos to the recipes, let the machine do the first pass, fix what it gets wrong, and of course we keep the original photos linked so nothing is lost.

## Input

### Image corpus

After you initialize a job, you can drop in a collection of photos/images into the images folder for that job which can cover at least these two types of collection (you can mix em if you want to):

#### a) Recipe flashcards

Index-card-style recipe cards. You might photograph front and back, or quarter a large card into multiple shots, to keep things grouped, you (human) will assign which photos belong together via `recipe_number` in the manifest, and the LLM does its best to stitch the OCR text from those photos into coherent recipe(s).

#### b) Community cookbook pages

Pages from bound or stapled recipe booklets (neighborhood cookbooks, family reunion collections, etc.), photographed page-by-page, `recipe_number` is still used here, the system does expect the possibility of multiple recipes per page, so you only need to keep as granular as you need to preserve recipes that cross over pages.

### Phrasing preservation

These are familial recipes across generations: handwriting styles vary, ingredients may be regional or archaic ("oleo", "a coffee cup of flour"), and formatting is inconsistent by nature. The pipeline is tolerant of all of this and preserves original voice rather than normalizing it. We're not trying to rewrite anything in the pipeline itself.

### How it works

Photos are sorted by filename in the manifest. Name them so they sort in the order you want (timestamp-prefixed filenames from a scanner work well). The system groups photos by their assigned `recipe_number`, runs OCR on each, concatenates the text, and hands it to the LLM with instructions to make its best attempt at ordering and stitching the content into complete recipes.

Blank or irrelevant photos can just be left without a `recipe_number` in the manifest and they'll be skipped.

### Why manual grouping?

Could the system detect recipe boundaries automatically? Sure, an LLM/agentic workflow or an agent with branching logic on "does this look like a new recipe" could handle it. But LLMs are non-deterministic, and this felt like the wrong place to trust that. These are family recipes. Scrolling through the manifest, connecting photos to their cards/pages/groups, was part of the experience for me. Not everything needs to be automated, and this particular step costs minutes while buying certainty.

## Architecture

### Local-first CLI + AWS backend

The CLI calls AWS for three things: storing images, running OCR, and persisting structured data. No deployed compute: no Lambdas, no Step Functions. The CLI orchestrates everything locally using your AWS credentials.

<!-- TODO: remove this feller when I've made that update, also, for anyone reading: what do you call a shortsighted doe when she forgets her glasses at home? ... no idea (say it out loud... australian accent will help)-->
### Why cloud state for a local CLI?

When you've been spending 90% of your time with the AWS hammer, everything looks like a DynamoDB nail. The pipeline already requires AWS credentials for Textract and Bedrock, so adding a state table isn't a new dependency. At the scale most families would put through this (a few hundred recipes at most), there's little operational difference between cloud and local storage, so I'll definitely add a local store option in a future pass.

### Hexagonal (ports & adapters)

Ports and adapters pattern:

- `domain/`: pure business logic, zero external dependencies. Models, ports (interfaces), and services.
- `adapters/`: port implementations. Only layer that touches AWS SDK, file system, or export libraries.
- `shared/`: cross-cutting concerns (logger, custom errors, schemas). Available to all layers.
- `config/`: Convict configuration schemas. Available to all layers.

```
heirloom/
├── bin/                            # CLI entry point
├── infra/                          # CDK stacks
│   ├── stateful/                   # S3 bucket, DynamoDB tables (RETAIN)
│   └── stateless/                  # IAM policies, Textract access
├── src/
│   ├── domain/
│   │   ├── ports/                  # OCRProvider, StructureExtractor, DataStore, Exporter interfaces
│   │   ├── models/                 # Recipe, Source, Job — Zod schemas + types
│   │   └── services/               # Ingest, transcribe, export orchestration
│   ├── adapters/
│   │   ├── inbound/                # CLI command handlers
│   │   └── outbound/               # S3, Textract, Bedrock, DynamoDB, PDF, Obsidian adapters
│   ├── shared/                     # Logger, custom errors, shared schemas
│   └── config/                     # Convict config (AWS region, table names, bucket, etc.)
├── jobs/                           # ⛔ .gitignored — local job landing zones
│   └── <job-name>/
│       ├── images/                 # User drops source photos here
│       └── manifest.csv            # Generated by ingest, edited by user
├── test/                           # Integration tests
└── .kiro/steering/                 # Project steering docs
```

### Dependency rules

- `domain/` → depends on nothing. No AWS SDK, no file system, no adapters.
- `adapters/` → depends on `domain/` (implements port interfaces).
- `shared/` → nothing. Available to all layers.
- `config/` → nothing. Available to all layers.
- `infra/` → depends on `src/` only for reference constants (table names, bucket names).

## Pipeline

### Job management

```
heirloom init moms-card-box     # create a new job (auto-sets as active)
heirloom jobs                    # list all jobs + status
heirloom use moms-card-box       # switch active job to an existing one
```

All commands operate against the active job. `init` sets it automatically; `use` switches between existing ones. Persisted locally.

### Step 1: Initialize — `heirloom init <job-name>`

Creates a job landing zone under the `.gitignore`d `jobs/` directory:

```
jobs/
└── moms-card-box/
    └── images/             ← Drop your photos here
```

Drop your photos into `jobs/<job-name>/images/` and run ingest.

### Step 2: Ingest — `heirloom ingest`

Scans `jobs/<active-job>/images/`, sorts by filename, and generates (or updates) the manifest CSV at `jobs/<active-job>/manifest.csv`:

```csv
file,modified,recipe_number,source
IMG_0001.jpg,2026-04-25T10:01:00,,
IMG_0002.jpg,2026-04-25T10:01:05,,
IMG_0003.jpg,2026-04-25T10:01:12,,
IMG_0004.jpg,2026-04-25T10:01:18,,
IMG_0005.jpg,2026-04-25T10:02:01,,
IMG_0006.jpg,2026-04-25T10:02:06,,
```

Open the CSV and fill in two columns:

- `recipe_number`: which images belong to the same recipe. All images sharing a number are grouped together, the invoked llm+json schema will then attempt to make sense of the ocr-ed content across a recipe group and produce as many reasonably complete recipes as it can find from the provided OCR'd content.
- `source`: which collection the recipe came from. You only need to set this when the source changes; the parser inherits the last non-empty value downward.

Completed example:

```csv
file,modified,recipe_number,source
IMG_0001.jpg,2026-04-25T10:01:00,1,Mom's Card Box
IMG_0002.jpg,2026-04-25T10:01:05,1,
IMG_0003.jpg,2026-04-25T10:01:12,2,
IMG_0004.jpg,2026-04-25T10:01:18,2,
IMG_0005.jpg,2026-04-25T10:02:01,3,First Baptist Cookbook 1987
IMG_0006.jpg,2026-04-25T10:02:06,3,
IMG_0007.jpg,2026-04-25T10:02:30,4,
IMG_0008.jpg,2026-04-25T10:02:45,5,
```

Here recipes 1-2 (photos 1-4) are from Mom's Card Box, recipe 3 onward from Inherited Recipe Book.

### Step 3: Transcribe — `heirloom transcribe`

Reads the manifest, then for each recipe group:

```
┌─────────────────┐
│  Manifest CSV    │  ← Grouped images per recipe, with source
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  S3 Upload       │  ← Upload unprocessed images to s3://<bucket>/<job-name>/
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  AWS Textract    │  ← Async batch OCR (StartDocumentTextDetection)
│  (handwriting +  │    CLI polls for completion
│   printed text)  │
└──────┬──────────┘
       │  Raw text blocks per image
       ▼
┌─────────────────┐
│  FM Structure    │  ← Bedrock FM with structured output (0-shot).
│  Extraction      │    System instruction defines how to interpret
│  (Bedrock)       │    subjective fields (category, confidence, etc.).
│                  │    Input: all Textract text for the recipe group.
│                  │    Output (JSON):
│                  │      a) Image role mapping (front/back/page/etc.)
│                  │      b) Parsed recipe (title, ingredients, steps, notes)
└──────┬──────────┘
       │  Zod-validated structured response
       ▼
┌─────────────────┐
│  DynamoDB        │  ← Canonical recipe records + image role mappings +
│  Datastore       │    confidence scores + review status
└──────┬──────────┘
```

#### Job tracking

A DynamoDB table tracks processing state:

- Which images have been uploaded to S3
- Which Textract jobs are submitted, in progress, or done
- Which results have been parsed and persisted
- Error/retry state for failed jobs

The CLI checks this table to determine what work remains: `heirloom transcribe` only processes unfinished documents. Run it twice, nothing duplicates.

### Step 4: Export — `heirloom export <format>`

Pulls structured recipe data from DynamoDB and generates output locally.

Images embedded in exports (PDF thumbnails, Obsidian attachments) reference the local `jobs/<job-name>/images/` path, no re-download from S3.

```
┌─────────────────┐     ┌─────────────────┐
│  DynamoDB        │     │  Local Images    │
│  Datastore       │     │  (jobs/<name>/)  │
└──────┬──────────┘     └──────┬──────────┘
       │                       │
       └───────────┬───────────┘
                   │
       ├──► heirloom export pdf        → PDF Cookbook
       └──► heirloom export vault <dir> → Obsidian Vault
```

## AWS resources (CDK)

### Stateful stack (RETAIN policy)

| Resource | Purpose |
|---|---|
| S3 Bucket | Image storage, organized by job |
| DynamoDB Table: Recipes | Canonical recipe records |
| DynamoDB Table: Jobs | Processing state per job |

### Stateless stack

| Resource | Purpose |
|---|---|
| IAM Policy | Textract, Bedrock, scoped S3, DynamoDB access |
| Bedrock Inference Profile | Model access for structure extraction, tagged for cost attribution |

No compute deployed. CLI runs locally, calls AWS APIs directly.

## Output

Three output formats, all derived from DynamoDB:

### PDF cookbook

A print-ready PDF. Table of contents with page numbers, recipes grouped by category or source order, title/attribution/ingredients/instructions per recipe, optional thumbnail of the original card alongside the transcription.

### Obsidian vault

A structured [Obsidian](https://obsidian.md) vault for browsing, searching, and extending the collection.

```
vault/
├── Recipes/
│   ├── party-cocktail-meatballs.md
│   ├── tomato-beef-and-green-pepper.md
│   └── ...
├── Sources/
│   ├── family-recipe-book.md         ← dataview query for tag source/family-recipe-book
│   └── moms-card-box.md
├── Attachments/
│   └── originals/                    ← source images copied from jobs/<name>/images/
└── README.md
```

Each recipe note has YAML frontmatter with tags (category tags + `source/<source-snake-name>`), confidence scores, author, year, and image references. Sources are dataview pages that automatically list all recipes tagged with that source. No manual cross-linking: the vault stays self-organizing.

### DynamoDB datastore

The canonical layer both the PDF and vault export from. Structured recipe records, S3 key references to source images (resolved to local paths during export), confidence scores per field, review/edit status.

Re-exportable: update a record, regenerate the PDF or vault.

> Review/edit workflow deferred. V1 is ingest → transcribe → export.

## Tech stack

### Core

| | |
|---|---|
| Language | TypeScript (~5.9), strict mode, ES2022 target, NodeNext module resolution |
| Runtime | Node.js 22.x |
| Infrastructure | AWS CDK v2 (`aws-cdk-lib`) |
| Build | `tsc` (no bundler for app code) |
| CLI entry | `npx tsx bin/heirloom.ts` |

### Libraries

| Package | Role |
|---|---|
| zod (v4) | Runtime schema validation for Textract responses, domain models, CLI input |
| convict | Typed, environment-aware configuration (AWS region, bucket name, table names) |
| @aws-sdk/client-s3 | Image upload/download |
| @aws-sdk/client-textract | OCR job submission and result retrieval |
| @aws-sdk/client-bedrock-runtime | FM invocation for structure extraction (structured output) |
| @aws-sdk/lib-dynamodb | Recipe and job record persistence |

### Testing

Jest 30 with `ts-jest`. Property-based testing via `fast-check`. Colocated test files: `foo.unit.ts` (unit), `foo.pbt.ts` (property-based). Integration tests in `test/`.

### Naming conventions

| Scope | Convention | Example |
|---|---|---|
| Files and folders | `kebab-case` | `recipe-service.ts` |
| Classes / interfaces | `PascalCase` | `RecipeService` |
| Functions / variables | `camelCase` | `parseIngredients` |
| Environment variables | `SCREAMING_SNAKE_CASE` | `HEIRLOOM_BUCKET_NAME` |
| Zod schemas | `camelCase` + `Schema` suffix | `recipeSchema` |
| CDK construct IDs | `PascalCase` | `RecipeTable` |
| AWS resource names | `kebab-case` | `heirloom-recipes` |

### Error handling

Custom error classes extending `Error` with a `cause` property, centralized in `src/shared/errors.ts`.

### Commit conventions

Conventional Commits enforced via `commitlint` + Husky pre-commit hooks.

## Design principles

The goal is a first-pass transcription good enough for a human to review. Confidence scores flag where the machine was guessing.

Voice in, voice out.

Every transcription links back to its source photo. S3 is the durable store; `jobs/` is the local working copy. Both reference the same images: S3 keys map to local paths.

DynamoDB is canonical. PDFs and vaults are derived, rebuildable after edits.

Batch-oriented: dozens to hundreds of recipes at once. Job tracking means you can stop and restart without reprocessing. Same command twice, no duplicate work.

Textract sits behind an `OCRProvider` port, swappable for Tesseract or a vision LLM without touching domain logic.

Structure extraction uses Bedrock FM structured output validated by Zod. A 0-shot system instruction guides the FM on subjective fields (category, confidence, attribution). The output shape is deterministic and type-safe.

## Common commands

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript (`tsc`) |
| `npm run test` | Run all Jest tests (unit + PBT + integration) |
| `npm run clean` | Remove build artifacts |
| `cdk synth` | Synthesize CloudFormation templates |
| `cdk deploy --all` | Deploy S3 bucket, DynamoDB tables, IAM policies |
| `cdk destroy --all` | Tear down all stacks |
| `heirloom init <job-name>` | Create a new job landing zone, set as active |
| `heirloom jobs` | List all local jobs and their status |
| `heirloom use <job-name>` | Switch active job |
| `heirloom ingest` | Scan images, generate manifest CSV |
| `heirloom transcribe` | Upload images to S3, run Textract + FM |
| `heirloom export pdf` | Generate PDF cookbook |
| `heirloom export vault <dir>` | Generate Obsidian vault |

<!-- Need me an example output section -->

## Known limitations

Personal project. Works, not bulletproof. Known rough edges:

DynamoDB queries are unpaginated. `getRecipesByJob` returns all items in a single query. Fine for family-scale collections (dozens to low hundreds), would need pagination for anything larger.

Textract polling has no timeout. The adapter polls indefinitely on 2-second intervals. A stuck Textract job would hang the CLI.

S3 uploads buffer the entire file in memory. Recipe-card photos are typically 1–5MB so this is fine in practice, but an accidental RAW file would blow up memory without a useful error.

The stateful stack may be removable. Now that the pipeline works end-to-end, DynamoDB job-tracking state may be unnecessary, and a future audit could simplify to local-only state. Not urgent; infra cost is zero at rest.

## Status

Working. 106 recipes digitized from first batch. Pipeline is end-to-end functional. Export outputs (PDF and Obsidian vault) are rough first-pass: they work but need a TLC pass on formatting, frontmatter richness, and vault structure before they match the intended design above.

## License

[MIT](./LICENSE)
