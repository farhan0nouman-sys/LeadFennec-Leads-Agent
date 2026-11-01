import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
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
  ],
  providers: [WorkspaceGuard, PermissionGuard],
})
export class WorkspacesModule {}
