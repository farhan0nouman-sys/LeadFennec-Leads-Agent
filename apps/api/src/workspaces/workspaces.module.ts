import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { campaignServicesProvider } from './campaign-services.js';
import { CampaignsController } from './campaigns.controller.js';
import { DashboardController } from './dashboard.controller.js';
import { DiscoveryController } from './discovery.controller.js';
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
  ],
  providers: [
    WorkspaceGuard,
    PermissionGuard,
    campaignServicesProvider,
    organizationSearchProvider,
  ],
})
export class WorkspacesModule {}
