// Core Types & Schemas
export * from './core/types/diagnostic-context.js';
export * from './core/types/repair-evidence.js';
export * from './core/errors/engine-errors.js';

// Trace Ingestion
export * from './trace/archive-reader.js';
export * from './trace/version-detector.js';
export * from './trace/trace-parser.js';
export * from './trace/snapshot-resolver.js';
export * from './trace/adapters/trace-adapter.js';
export * from './trace/adapters/adapter-registry.js';
export * from './trace/adapters/v8-adapter.js';
export * from './trace/adapters/v9-adapter.js';
export * from './trace/adapters/v10-adapter.js';
export * from './trace/adapters/unknown-adapter.js';

// Diagnostics
export * from './diagnostics/failure-classifier.js';
export * from './diagnostics/evidence-correlator.js';
export * from './diagnostics/diagnostic-report.js';

// Selector Intelligence & Abstention
export * from './selector/candidate-extractor.js';
export * from './selector/selector-scorer.js';
export * from './selector/abstention-policy.js';

// AST Repair & Verification
export * from './repair/ast-patcher.js';
export * from './repair/assertion-hasher.js';
export * from './repair/diff-allowlist.js';
export * from './repair/intent-validator.js';
export * from './repair/repair-planner.js';
export * from './repair/approval-service.js';
export * from './repair/workspace-promoter.js';

// Selector Verification & Live Reproduction
export * from './selector/live-locator-verifier.js';
export * from './reproduce/direct-browser-investigator.js';
export * from './reproduce/diagnostic-rerunner.js';

// Sandbox & Worktree Management
export * from './sandbox/dependency-strategy.js';
export * from './sandbox/worktree-manager.js';
export * from './sandbox/execution-runner.js';

// Memory & Generation
export * from './memory/stability-ledger.js';
export * from './generator/test-generator.js';

// Framework & MCP
export * from './framework/config-adapter.js';
export * from './mcp/server.js';
export * from './cli/index.js';

