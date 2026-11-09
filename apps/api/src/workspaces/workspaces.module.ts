import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { campaignServicesProvider } from './campaign-services.js';
import { CampaignsController } from './campaigns.controller.js';
import { DashboardController } from './dashboard.controller.js';
import { DiscoveryController } from './discovery.controller.js';
import { EnrichmentController } from './enrichment.controller.js';
import { ExportsController } from './exports.controller.js';
import { LeadsController } from './leads.controller.js';
import {
  contactProvider,
  emailVerificationProvider,
} from './enrichment-provider.js';
import { ResearchController } from './research.controller.js';
import { QualificationController } from './qualification.controller.js';
import { SendPolicyController } from './send-policy.controller.js';
import { SuppressionsController } from './suppressions.controller.js';
import { organizationSearchProvider } from './discovery-provider.js';
import { InvitationsController } from './invitations.controller.js';
import { PlatformController } from './platform.controller.js';
import { PermissionGuard, WorkspaceGuard } from './workspace-guards.js';
import { WorkspacesController } from './workspaces.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [
    WorkspacesController,
    InvitationsController,
    PlatformController,
    DashboardController,
    // After DashboardController: GET …/campaigns/summary must match before …/:campaignId.
    CampaignsController,
    DiscoveryController,
    ResearchController,
    SendPolicyController,
    QualificationController,
    EnrichmentController,
    // After DashboardController: GET …/leads/summary must match before …/leads/:contactId.
    LeadsController,
    ExportsController,
    SuppressionsController,
  ],
  providers: [
    WorkspaceGuard,
    PermissionGuard,
    campaignServicesProvider,
    organizationSearchProvider,
    contactProvider,
    emailVerificationProvider,
  ],
})
export class WorkspacesModule {}
