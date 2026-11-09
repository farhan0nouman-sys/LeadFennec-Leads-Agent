// What a contact enrichment run stores about itself (task 08C, docs/decisions.md D-08C-01), read
// back only through these schemas. The inputs (source run, companies, targets, exclusions,
// destination) are written once when the run is asked for and never change (a trigger forbids it).
import {
  CONTACT_DATA_PROVIDERS,
  ENRICHMENT_LIMITS,
  enrichmentTargetingSchema,
  type EnrichmentRunInfo,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import type { Import } from '../generated/prisma/client.js';

export const enrichmentMetadataSchema = z.strictObject({
  kind: z.literal('contact_enrichment'),
  sourceImportId: z.uuid(),
  campaignId: z.uuid().nullable(),
  attribution: z.string().min(1).max(300),
  maxContactsPerCompany: z
    .int()
    .min(1)
    .max(ENRICHMENT_LIMITS.maxContactsPerCompany),
  /** The companies covered, in the source run's order. */
  organizationIds: z.array(z.uuid()).min(1).max(ENRICHMENT_LIMITS.maxCompanies),
  /** Companies of the source run beyond the limit (not covered). */
  beyondLimit: z.int().min(0),
  /** The campaign's exclusions when asked for, normalized; null without a campaign. */
  exclusions: z
    .strictObject({
      emails: z.array(z.string()).max(1000),
      domains: z.array(z.string()).max(1000),
      leadListIds: z.array(z.uuid()).max(100),
    })
    .nullable(),
});
export type EnrichmentMetadata = z.output<typeof enrichmentMetadataSchema>;

/** The run's info for the API; `skipped` is counted from its results. */
export function enrichmentInfo(
  row: Import,
  skipped: number,
): EnrichmentRunInfo {
  const metadata = enrichmentMetadataSchema.parse(row.sourceMetadata);
  return {
    sourceImportId: metadata.sourceImportId,
    icpId: z.uuid().parse(row.icpId),
    campaignId: metadata.campaignId,
    leadListId: row.leadListId,
    provider: z.enum(CONTACT_DATA_PROVIDERS).parse(row.searchProvider),
    attribution: metadata.attribution,
    targeting: enrichmentTargetingSchema.parse(row.searchFilters),
    maxContactsPerCompany: metadata.maxContactsPerCompany,
    companies: {
      total: metadata.organizationIds.length,
      done: row.pagesFetched,
      skipped,
      beyondLimit: metadata.beyondLimit,
    },
  };
}
