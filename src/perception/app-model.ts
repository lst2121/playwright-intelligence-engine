import { z } from 'zod';

export const AppElementSchema = z.object({
  tag: z.string().min(1),
  role: z.string().optional(),
  accessibleName: z.string().optional(),
  label: z.string().optional(),
  testId: z.string().optional(),
  frameSelector: z.string().optional(),
  count: z.number().int().min(1).default(1),
  visible: z.boolean().default(true),
});
export type AppElement = z.infer<typeof AppElementSchema>;

export const AppRouteSchema = z.object({
  route: z.string().min(1),
  title: z.string().optional(),
  elements: z.array(AppElementSchema).default([]),
});
export type AppRoute = z.infer<typeof AppRouteSchema>;

export const AppModelSchema = z.object({
  version: z.literal('1').default('1'),
  baseUrl: z.string().min(1),
  fingerprint: z.string().min(1),
  capturedAt: z.string(),
  routes: z.array(AppRouteSchema).default([]),
});
export type AppModel = z.infer<typeof AppModelSchema>;
