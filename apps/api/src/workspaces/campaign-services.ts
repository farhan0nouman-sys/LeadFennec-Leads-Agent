// Which later services a running campaign needs exist (task 06C, docs/decisions.md D-06C-02).
// Production provides BUILT_SERVICES: none yet, so activation fails closed with a reason for
// each. Only tests override this token.
import { BUILT_SERVICES, type CampaignServices } from '@lead-fennec-ai/shared';

export const CAMPAIGN_SERVICES = Symbol('CAMPAIGN_SERVICES');

export const campaignServicesProvider = {
  provide: CAMPAIGN_SERVICES,
  useValue: BUILT_SERVICES satisfies CampaignServices,
};
