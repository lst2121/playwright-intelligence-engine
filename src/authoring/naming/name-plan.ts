import { z } from 'zod';

export const SymbolSourceSchema = z.enum(['llm', 'heuristic']);
export type SymbolSource = z.infer<typeof SymbolSourceSchema>;

export const SymbolEntrySchema = z.object({
  ref: z.string().min(1),
  role: z.string().optional(),
  accessibleName: z.string().optional(),
  property: z.string().min(1),
  method: z.string().min(1),
  verb: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source: SymbolSourceSchema,
  assumptions: z.array(z.string()).default([]),
});
export type SymbolEntry = z.infer<typeof SymbolEntrySchema>;

export const NamePlanSchema = z.object({
  planVersion: z.literal('1').default('1'),
  pageClassName: z.string().min(1),
  pageVariable: z.string().min(1),
  symbols: z.array(SymbolEntrySchema),
  assumptions: z.array(z.string()).default([]),
});
export type NamePlan = z.infer<typeof NamePlanSchema>;

