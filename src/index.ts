// Core Types & Schemas
export * from './core/version.js';
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
export * from './diagnostics/diagnostic-contract.js';
export * from './diagnostics/failure-category.js';
export * from './diagnostics/external-failure-evidence.js';

// Selector Intelligence & Abstention
export * from './selector/candidate-extractor.js';
export * from './selector/selector-scorer.js';
export * from './selector/abstention-policy.js';
export * from './selector/repair-candidate-ranker.js';

// AST Repair & Verification
export * from './repair/ast-patcher.js';
export * from './repair/assertion-hasher.js';
export * from './repair/diff-allowlist.js';
export * from './repair/intent-validator.js';
export * from './repair/repair-planner.js';
export * from './repair/repair-workflow.js';
export * from './repair/approval-service.js';
export * from './repair/workspace-promoter.js';
export * from './repair/repair-operations.js';
export * from './repair/verification-gates.js';
export * from './repair/safe-operation-compiler.js';
export * from './repair/browser-operation-executor.js';
export * from './repair/source-mapper.js';

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
export * from './generator/architecture-generator.js';
export * from './authoring/index.js';
export * from './gate/index.js';
export * from './perception/index.js';
export * from './config/project-config.js';
export * from './intelligence/llm-proposal.js';
export * from './intelligence/model-provider.js';
export * from './intelligence/model-contract.js';
export * from './intelligence/evidence-bundle.js';
export * from './intelligence/repair-agent.js';
export * from './intelligence/trace-proposal-workflow.js';
export * from './intelligence/verified-llm-repair-workflow.js';
export * from './intelligence/autonomous-repair-workflow.js';
export * from './intelligence/generation-agent.js';
export * from './intelligence/repository-profile.js';
export * from './intelligence/project-intelligence.js';
export * from './intelligence/failure-clustering.js';
export * from './intelligence/suite-intelligence.js';
export * from './intelligence/business-intent.js';
export * from './intelligence/test-intelligence.js';
export * from './integrations/ci-summary.js';
export * from './integrations/quality-gate.js';
export * from './integrations/playwright-report-adapter.js';
export * from './integrations/sarif-report.js';
export * from './governance/audit-log.js';
export * from './governance/workflow-audit.js';
export * from './governance/team-dashboard.js';
export * from './repair/workflow-plan.js';
export * from './evaluation/repository-inspector.js';
export * from './evaluation/repository-runner.js';
export * from './evaluation/evaluation-scorecard.js';

// Framework & MCP
export * from './framework/config-adapter.js';
export * from './mcp/server.js';
export * from './cli/index.js';

