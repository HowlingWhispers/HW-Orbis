import { z } from 'zod';

export const speculusSaveSyncSchema = z.object({
  launchId: z.string().uuid(),
  mode: z.enum(['autosave', 'snapshot']),
  title: z.string().trim().min(1).max(120).optional(),
  save: z.object({
    format: z.literal('speculus-v2-session'),
    version: z.literal(2),
    engine: z.literal('v2'),
    source: z.object({
      id: z.string().uuid(),
      type: z.string().min(1).max(40),
      revision: z.string().min(1).max(200),
    }).passthrough(),
    turns: z.array(z.unknown()).max(20000),
  }).passthrough(),
});
