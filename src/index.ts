// Core Types & Schemas
export * from './core/types/diagnostic-context.js';
export * from './core/types/repair-evidence.js';
export * from './core/errors/engine-errors.js';

// Trace Ingestion
export * from './trace/archive-reader.js';
export * from './trace/version-detector.js';
export * from './trace/trace-parser.js';
export * from './trace/snapshot-resolver.js';

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
export * from './repair/intent-validator.js';
export * from './repair/repair-planner.js';

// Sandbox & Worktree Management
export * from './sandbox/worktree-manager.js';
export * from './sandbox/execution-runner.js';

// Memory & Generation
export * from './memory/stability-ledger.js';
export * from './generator/test-generator.js';

// Framework & MCP
export * from './framework/config-adapter.js';
export * from './mcp/server.js';
export * from './cli/index.js';

