# Requirements Document

## Introduction

This spec covers the initial scaffolding of the Heirloom project and the creation of CLI command stubs. The goal is to stand up the full directory structure, configuration files (package.json, tsconfig.json, Jest config, CDK config), and a working CLI entry point where every command (`init`, `ingest`, `transcribe`, `export`, `jobs`, `use`) is wired up but responds with a consistent "not implemented yet" message. After this spec is complete, the project compiles, tests run, and every CLI command can be invoked without error.

## Glossary

- **CLI**: The command-line interface entry point at `bin/heirloom.ts`, invoked via `npx tsx bin/heirloom.ts`
- **Command_Handler**: A function in `src/adapters/inbound/` that implements a single CLI command (e.g., `init`, `ingest`)
- **Stub**: A placeholder implementation of a Command_Handler that prints a "not implemented yet" message and exits cleanly
- **Project_Scaffold**: The complete set of directories, configuration files, and placeholder source files that constitute a buildable Heirloom project
- **Build_System**: The TypeScript compiler (`tsc`) and associated configuration that produces JavaScript output
- **Test_Runner**: Jest 30 with ts-jest, configured to discover `*.unit.ts`, `*.pbt.ts`, and `test/**/*.test.ts` files
- **CDK_App**: The AWS CDK v2 application entry point and empty stack definitions in `infra/`

## Requirements

### Requirement 1: Project Configuration Files

**User Story:** As a developer, I want the project to have correct package.json, tsconfig.json, and Jest configuration files, so that I can build, test, and run the project from a fresh clone.

#### Acceptance Criteria

1. THE Project_Scaffold SHALL include a `package.json` with name `heirloom`, type `module`, and engine constraint `node >=22.0.0`
2. THE Project_Scaffold SHALL include `tsc`, `tsx`, `jest`, `ts-jest`, `typescript`, `zod`, `convict`, `fast-check`, `aws-cdk-lib`, `constructs`, and `@types/node` as dependencies or devDependencies in `package.json`
3. THE Project_Scaffold SHALL include npm scripts for `build` (tsc), `test` (jest), and `clean` (remove build artifacts) in `package.json`
4. THE `package.json` SHALL include an `init` script that runs `npx tsx bin/heirloom.ts init`
5. THE `package.json` SHALL include an `ingest` script that runs `npx tsx bin/heirloom.ts ingest`
6. THE `package.json` SHALL include a `transcribe` script that runs `npx tsx bin/heirloom.ts transcribe`
7. THE `package.json` SHALL include an `export` script that runs `npx tsx bin/heirloom.ts export`
8. THE `package.json` SHALL include a `jobs` script that runs `npx tsx bin/heirloom.ts jobs`
9. THE `package.json` SHALL include a `use` script that runs `npx tsx bin/heirloom.ts use`
10. THE Project_Scaffold SHALL include a `tsconfig.json` with strict mode enabled, ES2022 target, and NodeNext module resolution
11. THE Project_Scaffold SHALL include a Jest configuration that discovers test files matching `**/*.unit.ts`, `**/*.pbt.ts`, and `**/test/**/*.test.ts` patterns using ts-jest as the transformer
12. WHEN a developer runs `npm run build`, THE Build_System SHALL compile all TypeScript source files without errors
13. WHEN a developer runs `npm run test`, THE Test_Runner SHALL execute and report zero failures (with no tests discovered initially, this is a passing run)

### Requirement 2: Directory Structure Scaffolding

**User Story:** As a developer, I want the full hexagonal architecture directory tree created with placeholder files, so that the project structure is established and ready for feature development.

#### Acceptance Criteria

1. THE Project_Scaffold SHALL create the `bin/` directory containing the CLI entry point file `heirloom.ts`
2. THE Project_Scaffold SHALL create the `infra/stateful/` and `infra/stateless/` directories each containing an empty CDK stack file
3. THE Project_Scaffold SHALL create the `src/domain/ports/`, `src/domain/models/`, and `src/domain/services/` directories each containing an index barrel file
4. THE Project_Scaffold SHALL create the `src/adapters/inbound/` directory for CLI command handlers
5. THE Project_Scaffold SHALL create the `src/adapters/outbound/` directory with a placeholder index barrel file
6. THE Project_Scaffold SHALL create the `src/shared/` directory containing an `errors.ts` file with a base `HeirloomError` custom error class
7. THE Project_Scaffold SHALL create the `src/config/` directory containing a placeholder Convict configuration file
8. THE Project_Scaffold SHALL create the `test/` directory for integration tests
9. THE Project_Scaffold SHALL include `jobs/` in the `.gitignore` file

### Requirement 3: CDK Application Entry Point

**User Story:** As a developer, I want a minimal CDK app with empty stateful and stateless stacks, so that `cdk synth` succeeds and the infrastructure layer is ready for resource definitions.

#### Acceptance Criteria

1. THE Project_Scaffold SHALL include a `cdk.json` file that points to the CDK app entry point
2. THE CDK_App SHALL define an empty `StatefulStack` in `infra/stateful/` that extends `cdk.Stack`
3. THE CDK_App SHALL define an empty `StatelessStack` in `infra/stateless/` that extends `cdk.Stack`
4. THE CDK_App SHALL instantiate both stacks in the CDK app entry point
5. WHEN a developer runs `cdk synth`, THE CDK_App SHALL produce valid CloudFormation templates without errors

### Requirement 4: CLI Entry Point and Command Routing

**User Story:** As a developer, I want a CLI entry point that parses commands and routes to the appropriate handler, so that the command structure is established and extensible.

#### Acceptance Criteria

1. WHEN a user runs `npx tsx bin/heirloom.ts` with no arguments, THE CLI SHALL display a help message listing all available commands
2. WHEN a user runs `npx tsx bin/heirloom.ts` with an unrecognized command, THE CLI SHALL print an error message indicating the command is unknown and display the help message
3. THE CLI SHALL accept the following commands: `init`, `ingest`, `transcribe`, `export`, `jobs`, `use`
4. THE CLI SHALL route each recognized command to its corresponding Command_Handler in `src/adapters/inbound/`

### Requirement 5: CLI Command Stubs

**User Story:** As a developer, I want every CLI command to have a stub handler that prints a consistent "not implemented yet" message, so that the command routing is verifiable and each command is individually exercisable.

#### Acceptance Criteria

1. WHEN a user runs `npx tsx bin/heirloom.ts init <job-name>`, THE CLI SHALL print "init is not implemented yet" to stdout and exit with code 0
2. WHEN a user runs `npx tsx bin/heirloom.ts ingest`, THE CLI SHALL print "ingest is not implemented yet" to stdout and exit with code 0
3. WHEN a user runs `npx tsx bin/heirloom.ts transcribe`, THE CLI SHALL print "transcribe is not implemented yet" to stdout and exit with code 0
4. WHEN a user runs `npx tsx bin/heirloom.ts export <format>`, THE CLI SHALL print "export is not implemented yet" to stdout and exit with code 0
5. WHEN a user runs `npx tsx bin/heirloom.ts jobs`, THE CLI SHALL print "jobs is not implemented yet" to stdout and exit with code 0
6. WHEN a user runs `npx tsx bin/heirloom.ts use <job-name>`, THE CLI SHALL print "use is not implemented yet" to stdout and exit with code 0
7. THE CLI SHALL use a consistent message format of `{command} is not implemented yet` across all Stub handlers

### Requirement 6: Shared Error Infrastructure

**User Story:** As a developer, I want a base custom error class in `src/shared/errors.ts`, so that all future feature errors follow a consistent pattern with cause chaining.

#### Acceptance Criteria

1. THE Project_Scaffold SHALL include a `HeirloomError` class in `src/shared/errors.ts` that extends the built-in `Error` class
2. THE `HeirloomError` class SHALL accept a `message` parameter and an optional `cause` parameter of type `unknown`
3. THE `HeirloomError` class SHALL set the error `name` property to the class name

### Requirement 7: Placeholder Configuration Module

**User Story:** As a developer, I want a Convict configuration schema with placeholder values for AWS region, bucket name, and table names, so that the config layer is established and importable.

#### Acceptance Criteria

1. THE Project_Scaffold SHALL include a Convict configuration schema in `src/config/` that defines entries for AWS region, S3 bucket name, DynamoDB recipes table name, and DynamoDB jobs table name
2. THE configuration schema SHALL provide sensible default values for local development
3. THE configuration schema SHALL allow overrides via environment variables using SCREAMING_SNAKE_CASE naming (e.g., `HEIRLOOM_AWS_REGION`, `HEIRLOOM_BUCKET_NAME`)

### Requirement 8: Stub Verification Tests

**User Story:** As a developer, I want unit tests that verify each CLI command stub prints the correct message, so that the command routing and stub behavior are validated by the test suite.

#### Acceptance Criteria

1. WHEN the test suite runs, THE Test_Runner SHALL verify that each Command_Handler Stub outputs the correct `{command} is not implemented yet` message
2. THE test files SHALL be colocated with the Command_Handler source files following the `*.unit.ts` naming convention
3. WHEN a developer runs `npm run test`, THE Test_Runner SHALL execute the stub verification tests and report all passing
