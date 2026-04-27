# Implementation Plan: Project Init & CLI Stubs

## Overview

Scaffold the Heirloom project from scratch: configuration files, hexagonal directory structure, CLI entry point with command routing, six stub command handlers, shared error infrastructure, a Convict configuration module, and minimal CDK stacks. Each task builds incrementally so the project compiles and tests pass at every checkpoint.

## Tasks

- [x] 1. Create project configuration files
  - [x] 1.1 Create `package.json` with name `heirloom`, type `module`, engine constraint `node >=22.0.0`, and all required dependencies/devDependencies (`tsc`, `tsx`, `jest`, `ts-jest`, `typescript`, `zod`, `convict`, `fast-check`, `aws-cdk-lib`, `constructs`, `@types/node`, `@types/convict`)
    - Include npm scripts: `build` (tsc), `test` (jest), `clean` (rm -rf dist), `init`, `ingest`, `transcribe`, `export`, `jobs`, `use` (each running `npx tsx bin/heirloom.ts <command>`)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

  - [x] 1.2 Create `tsconfig.json` with strict mode, ES2022 target, NodeNext module resolution, and appropriate compiler options
    - _Requirements: 1.10_

  - [x] 1.3 Create Jest configuration (jest.config.ts or in package.json) using ts-jest transformer, discovering `**/*.unit.ts`, `**/*.pbt.ts`, and `**/test/**/*.test.ts` patterns
    - _Requirements: 1.11_

  - [x] 1.4 Create `.gitignore` including `node_modules/`, `dist/`, `jobs/`, and other standard entries
    - _Requirements: 2.9_

- [x] 2. Set up directory structure and barrel files
  - [x] 2.1 Create domain barrel files: `src/domain/ports/index.ts`, `src/domain/models/index.ts`, `src/domain/services/index.ts`
    - Each file contains only a comment: `// Barrel file — exports will be added by feature specs`
    - _Requirements: 2.3_

  - [x] 2.2 Create `src/adapters/outbound/index.ts` barrel file
    - Same placeholder comment pattern
    - _Requirements: 2.5_

  - [x] 2.3 Create empty `test/` directory with a `.gitkeep` file
    - _Requirements: 2.8_

- [x] 3. Implement shared error infrastructure
  - [x] 3.1 Create `src/shared/errors.ts` with `HeirloomError` class extending `Error`
    - Accept `message: string` and optional `cause: unknown` parameters
    - Pass cause via the standard `Error` options bag `{ cause }`
    - Set `this.name` to `this.constructor.name`
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 3.2 Write property test `src/shared/errors.pbt.ts` for HeirloomError construction round-trip
    - **Property 3: HeirloomError construction round-trip**
    - For arbitrary message strings and cause values, verify: (a) instanceof Error, (b) .message equals input, (c) .cause equals input, (d) .name equals "HeirloomError"
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [x] 4. Implement Convict configuration module
  - [x] 4.1 Create `src/config/config.ts` with Convict schema defining `aws.region`, `s3.bucketName`, `dynamodb.recipesTableName`, `dynamodb.jobsTableName`
    - Provide sensible defaults for local development
    - Allow environment variable overrides: `HEIRLOOM_AWS_REGION`, `HEIRLOOM_BUCKET_NAME`, `HEIRLOOM_RECIPES_TABLE`, `HEIRLOOM_JOBS_TABLE`
    - Call `config.validate({ allowed: 'strict' })` and export the config object as default
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 5. Checkpoint - Verify project compiles
  - Ensure `npm install` and `npm run build` succeed. Ask the user if questions arise.

- [x] 6. Implement CLI command routing and stub handlers
  - [x] 6.1 Create `src/adapters/inbound/stub-handler.ts` with `createStubHandler` factory function
    - Export a function that takes a command name string and returns a `CommandHandler` that prints `{command} is not implemented yet` to stdout
    - _Requirements: 5.7_

  - [x] 6.2 Create `src/adapters/inbound/cli.ts` with `CommandHandler` type, command registry `Map<string, CommandHandler>`, `printHelp()`, and `runCli(argv)` function
    - Register all six commands: `init`, `ingest`, `transcribe`, `export`, `jobs`, `use`
    - No arguments → print help, exit 0
    - Unknown command → print error to stderr, print help to stdout, set `process.exitCode = 1`
    - Known command → delegate to handler
    - Wrap handler call in try/catch; on error print message to stderr and set `process.exitCode = 1`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 6.3 Create the six command handler files in `src/adapters/inbound/`
    - `init-handler.ts`, `ingest-handler.ts`, `transcribe-handler.ts`, `export-handler.ts`, `jobs-handler.ts`, `use-handler.ts`
    - Each uses `createStubHandler` to produce its handler and exports it as a named export
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 6.4 Create CLI entry point `bin/heirloom.ts`
    - Import and call `runCli(process.argv.slice(2))` from `src/adapters/inbound/cli.ts`
    - _Requirements: 2.1, 4.1_

- [x] 7. Implement CDK stacks
  - [x] 7.1 Create `infra/stateful/stateful-stack.ts` with empty `StatefulStack` extending `cdk.Stack`
    - _Requirements: 3.2_

  - [x] 7.2 Create `infra/stateless/stateless-stack.ts` with empty `StatelessStack` extending `cdk.Stack`
    - _Requirements: 3.3_

  - [x] 7.3 Create `infra/app.ts` CDK app entry point that instantiates both stacks
    - _Requirements: 3.4_

  - [x] 7.4 Create `cdk.json` pointing to the CDK app entry point
    - _Requirements: 3.1_

- [x] 8. Checkpoint - Verify build and CLI routing
  - Ensure `npm run build` succeeds, `npx tsx bin/heirloom.ts` prints help, and `npx tsx bin/heirloom.ts init` prints "init is not implemented yet". Ask the user if questions arise.

- [x] 9. Write unit tests for CLI and stub handlers
  - [x] 9.1 Create `src/adapters/inbound/cli.unit.ts` with tests for:
    - No-argument invocation displays help message
    - Unknown command prints error to stderr and help to stdout, sets exitCode to 1
    - Each of the six recognized commands routes to its handler
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 9.2 Create unit test files for each command handler stub
    - `init-handler.unit.ts`, `ingest-handler.unit.ts`, `transcribe-handler.unit.ts`, `export-handler.unit.ts`, `jobs-handler.unit.ts`, `use-handler.unit.ts`
    - Each verifies the handler prints `{command} is not implemented yet` to stdout
    - _Requirements: 8.1, 8.2, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [ ] 10. Write property-based tests for CLI and stubs
  - [ ]* 10.1 Create `src/adapters/inbound/stub-handler.pbt.ts`
    - **Property 1: Stub message format consistency**
    - For arbitrary command name strings, `createStubHandler(name)` produces output exactly matching `"{name} is not implemented yet"`
    - **Validates: Requirements 5.7**

  - [ ]* 10.2 Create `src/adapters/inbound/cli.pbt.ts`
    - **Property 2: Unknown command rejection**
    - For arbitrary strings not in `{init, ingest, transcribe, export, jobs, use}`, `runCli([unknownCommand])` writes error to stderr containing the unknown command, writes help to stdout, and sets `process.exitCode` to 1
    - **Validates: Requirements 4.2**

- [x] 11. Final checkpoint - Ensure all tests pass
  - Run `npm run build` and `npm run test`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project should compile and be runnable after each checkpoint
