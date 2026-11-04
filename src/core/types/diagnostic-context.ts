import { z } from 'zod';

export const NetworkEventSchema = z.object({
  url: z.string(),
  method: z.string(),
  status: z.number(),
  statusText: z.string().optional(),
  headers: z.record(z.string()).optional(),
  timestamp: z.number(),
  durationMs: z.number().optional(),
  errorText: z.string().optional(),
});

export type NetworkEvent = z.infer<typeof NetworkEventSchema>;

export const ConsoleEventSchema = z.object({
  type: z.enum(['log', 'info', 'warn', 'error', 'debug']),
  text: z.string(),
  timestamp: z.number(),
  location: z.object({
    url: z.string().optional(),
    lineNumber: z.number().optional(),
    columnNumber: z.number().optional(),
  }).optional(),
});

export type ConsoleEvent = z.infer<typeof ConsoleEventSchema>;

export const FailureCategorySchema = z.enum([
  'LOCATOR_DRIFT',
  'AUTH_EXPIRED',
  'TIMING_RACE',
  'BACKEND_500',
  'ASSERTION_FAILURE',
  'NETWORK_OFFLINE',
  'AMBIGUOUS_MATCH',
  'UNKNOWN_ERROR',
]);

export type FailureCategory = z.infer<typeof FailureCategorySchema>;

export const FailedActionSchema = z.object({
  callId: z.string(),
  action: z.string(),             // e.g. "click", "fill", "waitFor"
  selector: z.string().optional(), // original failed locator
  sourceFile: z.string().optional(),
  line: z.number().optional(),
  column: z.number().optional(),
  errorStack: z.string().optional(),
  errorMessage: z.string().optional(),
  durationMs: z.number().optional(),
});

export type FailedAction = z.infer<typeof FailedActionSchema>;

export const DiagnosticContextSchema = z.object({
  playwrightVersion: z.string(),
  traceFormatVersion: z.number(),
  failedAction: FailedActionSchema,
  snapshots: z.object({
    before: z.string().optional(),
    action: z.string().optional(),
    after: z.string().optional(),
  }),
  networkEvents: z.array(NetworkEventSchema),
  consoleEvents: z.array(ConsoleEventSchema),
  failureCategory: FailureCategorySchema.optional(),
  evidenceCompleteness: z.object({
    domAvailable: z.boolean(),
    networkAvailable: z.boolean(),
    sourceAvailable: z.boolean(),
  }),
});

export type DiagnosticContext = z.infer<typeof DiagnosticContextSchema>;

