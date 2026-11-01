// Workspace, team and platform-admin API contract (task 04B, docs/api/workspaces.md): routes,
// request and response shapes and error codes shared by the API and the web app. Pure zod.
import { z } from 'zod';
import { AUTH_ERROR_CODES, emailInputSchema, linkTokenSchema } from './auth.js';

export const WORKSPACE_ROUTES = {
  workspaces: '/workspaces',
  workspace: (workspaceId: string) => `/workspaces/${workspaceId}`,
  members: (workspaceId: string) => `/workspaces/${workspaceId}/members`,
  member: (workspaceId: string, membershipId: string) =>
    `/workspaces/${workspaceId}/members/${membershipId}`,
  roles: (workspaceId: string) => `/workspaces/${workspaceId}/roles`,
  invitations: (workspaceId: string) =>
    `/workspaces/${workspaceId}/invitations`,
  invitation: (workspaceId: string, invitationId: string) =>
    `/workspaces/${workspaceId}/invitations/${invitationId}`,
  previewInvitation: '/invitations/preview',
  acceptInvitation: '/invitations/accept',
  platformWorkspaces: '/platform/workspaces',
  platformWorkspaceAccess: (workspaceId: string) =>
    `/platform/workspaces/${workspaceId}/access`,
  platformWorkspaceStatus: (workspaceId: string) =>
    `/platform/workspaces/${workspaceId}/status`,
} as const;

/** Page of the web app that invitation emails open; the token is in the URL fragment. */
export const INVITATION_LINK_PATH = '/invitations/accept';

/** Header with the platform admin's reason on GET routes (POST routes take it in the body). */
export const ACCESS_REASON_HEADER = 'x-access-reason';

const iso = z.iso.datetime();

export const workspaceSlugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'Use lower-case letters, digits and single hyphens.',
  );

/** A platform admin's reason for an access or a change; it is stored in the audit records. */
export const accessReasonSchema = z.string().trim().min(10).max(500);

export const pageQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().max(200).optional(),
  })
  .strict();

export const createWorkspaceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    /** Omitted: derived from the name, with a random suffix. */
    slug: workspaceSlugSchema.optional(),
  })
  .strict();

export const changeMemberRoleRequestSchema = z
  .object({ roleId: z.uuid() })
  .strict();

export const createInvitationRequestSchema = z
  .object({ email: emailInputSchema, roleId: z.uuid() })
  .strict();

export const invitationTokenRequestSchema = z
  .object({ token: linkTokenSchema })
  .strict();

/** The workspace id the user confirmed on the invitation page; it must be the invitation's. */
export const acceptInvitationRequestSchema = z
  .object({ token: linkTokenSchema, workspaceId: z.uuid() })
  .strict();

export const platformAccessRequestSchema = z
  .object({ reason: accessReasonSchema })
  .strict();

export const setWorkspaceStatusRequestSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED']),
    reason: accessReasonSchema,
  })
  .strict();

const roleRefSchema = z
  .object({ id: z.uuid(), key: z.string(), name: z.string() })
  .strict();

export const workspaceSchema = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']),
    createdAt: iso,
  })
  .strict();

/** A workspace together with the signed-in user's membership in it. */
export const userWorkspaceSchema = z
  .object({
    workspace: workspaceSchema,
    membership: z
      .object({
        id: z.uuid(),
        role: roleRefSchema,
        /** Permission keys (PERMISSION_CATALOG), sorted. */
        permissions: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

export const workspaceListResponseSchema = z
  .object({ items: z.array(userWorkspaceSchema) })
  .strict();

export const memberSchema = z
  .object({
    id: z.uuid(),
    user: z
      .object({
        id: z.uuid(),
        email: z.string(),
        displayName: z.string().nullable(),
      })
      .strict(),
    role: roleRefSchema,
    status: z.enum(['ACTIVE', 'SUSPENDED']),
    createdAt: iso,
  })
  .strict();

export const memberPageSchema = z
  .object({ items: z.array(memberSchema), nextCursor: z.string().nullable() })
  .strict();

export const roleListResponseSchema = z
  .object({
    items: z.array(
      roleRefSchema
        .extend({ isSystem: z.boolean(), permissions: z.array(z.string()) })
        .strict(),
    ),
  })
  .strict();

/** An invitation as the workspace's team sees it. Never contains the token. */
export const invitationSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    role: roleRefSchema,
    invitedBy: z.object({ displayName: z.string().nullable() }).strict(),
    expiresAt: iso,
    createdAt: iso,
  })
  .strict();

export const invitationPageSchema = z
  .object({
    items: z.array(invitationSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

/** What the invited, signed-in user is about to accept. */
export const invitationPreviewSchema = z
  .object({
    workspace: z.object({ id: z.uuid(), name: z.string() }).strict(),
    role: z.object({ key: z.string(), name: z.string() }).strict(),
    invitedBy: z.object({ displayName: z.string().nullable() }).strict(),
    expiresAt: iso,
  })
  .strict();

export const platformWorkspacePageSchema = z
  .object({
    items: z.array(workspaceSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const platformWorkspaceDetailSchema = z
  .object({ workspace: workspaceSchema, memberCount: z.number().int().min(0) })
  .strict();

export type UserWorkspace = z.output<typeof userWorkspaceSchema>;
export type Member = z.output<typeof memberSchema>;
export type Invitation = z.output<typeof invitationSchema>;

export const WORKSPACE_ERROR_CODES = [
  /** 404: unknown workspace or record, or one the user may not see (indistinguishable). */
  'not_found',
  /** 403: the user's role lacks the permission, or the action needs a platform admin. */
  'forbidden',
  /** 409: the address already belongs to an active member. */
  'already_member',
  /** 409: the workspace would be left without an active Client Admin. */
  'last_admin',
  /** 409: another workspace uses this slug. */
  'slug_taken',
  /** 400: unknown, used, revoked or expired invitation, or a workspace that is not active. */
  'invalid_or_expired_invitation',
  /** 403: the invitation is for another email address. */
  'invitation_for_another_account',
  /** 400: the invitation belongs to another workspace than the one confirmed. */
  'invitation_for_another_workspace',
] as const;

export const API_ERROR_CODES = [
  ...AUTH_ERROR_CODES,
  ...WORKSPACE_ERROR_CODES,
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** The error envelope of every route (auth routes use only AUTH_ERROR_CODES). */
export const apiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.enum(API_ERROR_CODES),
        message: z.string(),
        retryAfterSeconds: z.number().int().positive().optional(),
        issues: z
          .array(z.object({ path: z.string(), message: z.string() }).strict())
          .optional(),
      })
      .strict(),
  })
  .strict();

export type ApiErrorResponse = z.output<typeof apiErrorResponseSchema>;
