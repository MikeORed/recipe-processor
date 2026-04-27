# Tech Stack

## Core

- Language: TypeScript (~5.9), strict mode, ES2022 target, NodeNext module resolution
- Runtime: Node.js 22.x
- Infrastructure: AWS CDK v2 (`aws-cdk-lib`)
- Build: `tsc` (no bundler for app code)
- CLI entry: `npx tsx bin/heirloom.ts`

## Key Libraries

- `zod` (v4) — runtime schema validation for domain models, Textract responses, CLI input. Import from `zod/v4`.
- `convict` — typed, environment-aware configuration (AWS region, bucket name, table names, etc.)
- `@aws-sdk/client-s3` — image upload/download
- `@aws-sdk/client-textract` — OCR job submission and result retrieval
- `@aws-sdk/client-bedrock-runtime` — FM invocation for structure extraction (structured output)
- `@aws-sdk/lib-dynamodb` — recipe and job record persistence
- `fast-check` — property-based testing framework

## Testing

- Framework: Jest 30 with `ts-jest`
- Test patterns: `**/*.unit.ts`, `**/*.pbt.ts`, `**/test/**/*.test.ts`
- Unit tests (`*.unit.ts`) and property-based tests (`*.pbt.ts`) colocated next to the file they test
- Integration/cross-stack tests in `test/`

## Naming Conventions

| Scope | Convention | Example |
|---|---|---|
| Files and folders | `kebab-case` | `recipe-service.ts` |
| Classes / interfaces | `PascalCase` | `RecipeService` |
| Functions / variables | `camelCase` | `parseIngredients` |
| Environment variables | `SCREAMING_SNAKE_CASE` | `HEIRLOOM_BUCKET_NAME` |
| Zod schemas | `camelCase` + `Schema` suffix | `recipeSchema` |
| CDK construct IDs | `PascalCase` | `RecipeTable` |
| AWS resource names | `kebab-case` | `heirloom-recipes` |

## Error Handling

Custom error classes extending `Error` with a `cause` property, centralized in `src/shared/errors.ts`.

## Commit Conventions

Conventional Commits enforced via `commitlint` + Husky pre-commit hooks.

## Common Commands

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript (`tsc`) |
| `npm run test` | Run all Jest tests (unit + PBT + integration) |
| `npm run clean` | Remove build artifacts |
| `cdk synth` | Synthesize CloudFormation templates |
| `cdk deploy --all` | Deploy S3 bucket, DynamoDB tables, IAM policies |
| `cdk destroy --all` | Tear down all stacks |

> `cdk` is installed globally. `tsc`, `jest`, and `tsx` are devDependencies — use via `npm run` scripts or `npx`.

## AWS Services

- **S3**: Permanent image storage, organized by job
- **DynamoDB**: Recipes table (canonical records) + Jobs table (processing state)
- **Textract**: Async batch OCR (handwriting + printed text)
- **Bedrock**: FM structured output for recipe structure extraction
- **IAM**: Scoped policies for Textract, Bedrock, S3, DynamoDB access
