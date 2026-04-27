# Product Overview

Heirloom is a local-first CLI tool that digitizes handwritten and printed family recipes from photographs into structured, searchable data. Users photograph stacks of recipe cards or cookbook pages, and the pipeline produces first-pass transcriptions ready for human review.

## Core Workflow

1. **Init** — Create a local job workspace, drop photos in.
2. **Ingest** — Scan images, generate a manifest CSV. User annotates which images belong to which recipe and their source collection.
3. **Transcribe** — Upload images to S3, run OCR via AWS Textract, extract structure via Bedrock FM (0-shot, Zod-validated), persist to DynamoDB.
4. **Export** — Generate outputs from DynamoDB: print-ready PDF cookbook, interlinked Obsidian vault, or direct datastore access.

## Input Types

- **Recipe flashcards**: Index cards photographed front/back or quartered. Blank sections skipped.
- **Community cookbook pages**: Bound/stapled booklets photographed page-by-page.

## Key Principles

- **First pass, not final pass.** Surface confidence scores so reviewers know where to focus.
- **Preserve voice.** Keep original language and phrasing — don't normalize.
- **Images are source of truth.** Every transcription links back to its source photo.
- **Regenerable outputs.** DynamoDB is canonical; PDFs and vaults are derived and rebuildable.
- **Batch-friendly.** Designed for dozens to hundreds of recipes at once.
- **Resumable and idempotent.** Job tracking prevents reprocessing. Same command twice = no duplicate work.
- **Pluggable OCR.** Textract sits behind an `OCRProvider` port — swappable without touching domain logic.
