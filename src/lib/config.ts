import { z } from 'zod';
export const settingsSchema = z.object({
  autoApproveDeals: z.boolean().default(false),
  monitoringEnabled: z.boolean().default(true),
  monitoringMinutes: z.number().int().min(30).max(1440).default(30),
  batchSize: z.number().int().min(1).max(20).default(10),
  minDiscount: z.number().min(1).max(90).default(15),
  minSavings: z.number().int().min(100).max(1000000).default(1500),
  minScore: z.number().int().min(0).max(100).default(65),
  minHistoryDays: z.number().int().min(7).max(90).default(7),
  minHistorySamples: z.number().int().min(8).max(100).default(8),
  maxHistoryGapHours: z.number().min(1).max(72).default(48),
  freshnessMinutes: z.number().int().min(5).max(120).default(60),
  duplicateHours: z.number().int().min(24).max(720).default(168),
  scoreWeights: z
    .object({
      discount: z.number().min(0).max(100).default(30),
      savings: z.number().min(0).max(100).default(15),
      history: z.number().min(0).max(100).default(25),
      freshness: z.number().min(0).max(100).default(15),
      availability: z.number().min(0).max(100).default(10),
      seller: z.number().min(0).max(100).default(5),
    })
    .default({
      discount: 30,
      savings: 15,
      history: 25,
      freshness: 15,
      availability: 10,
      seller: 5,
    }),
  categoryBoosts: z.record(z.string(), z.number().min(-10).max(10)).default({}),
  postingMode: z.enum(['disabled', 'manual', 'automatic']).default('disabled'),
  socialMinScore: z.number().int().min(0).max(100).default(85),
  maxDailyPosts: z.number().int().min(1).max(3).default(3),
  minPostHours: z.number().min(3).max(48).default(3),
  accountEligible: z.boolean().default(false),
  organizationId: z.string().max(100).default(''),
  channelId: z.string().max(100).default(''),
  publishingPausedUntil: z.number().default(0),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaults = settingsSchema.parse({});
export async function getSettings(db: D1Database): Promise<Settings> {
  const row = await db
    .prepare("SELECT value FROM application_settings WHERE id='main'")
    .first<{ value: string }>();
  return settingsSchema.parse(row ? JSON.parse(row.value) : {});
}
export async function saveSettings(db: D1Database, value: Settings) {
  await db
    .prepare(
      "INSERT INTO application_settings VALUES ('main',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
    .bind(JSON.stringify(settingsSchema.parse(value)))
    .run();
}
