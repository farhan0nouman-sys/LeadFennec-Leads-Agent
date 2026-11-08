// The API's endpoints (task 05B, docs/decisions.md D-05B-01): one typed list from which the
// OpenAPI document (docs/api/openapi.json) is generated and through which the web app calls the
// API. The API's contract test checks that its routes, guards, status codes and validation
// schemas match this list. Pure zod: safe for web, API and worker.
import { z } from 'zod';
import type { PermissionKey } from '../authorization.js';
import {
  AUTH_ROUTES,
  acceptedResponseSchema,
  emailRequestSchema,
  emailVerifiedResponseSchema,
  loginRequestSchema,
  passwordResetConfirmRequestSchema,
  passwordResetResponseSchema,
  registerRequestSchema,
  sessionResponseSchema,
  verifyEmailRequestSchema,
} from './auth.js';
import {
  RESEARCH_ROUTES,
  organizationResearchSchema,
  researchAcceptedSchema,
  researchCorrectionRequestSchema,
  researchRequestSchema,
  researchVersionSchema,
} from './research.js';
import {
  SEND_POLICY_ROUTES,
  sendPolicyStateSchema,
  updateSendPolicyRequestSchema,
} from './send-eligibility.js';
import {
  QUALIFICATION_ROUTES,
  leadPageSchema,
  leadQualificationViewSchema,
  qualificationDecisionRequestSchema,
  qualifyAcceptedSchema,
  qualifyRequestSchema,
} from './lead-qualification.js';
import {
  activateCampaignRequestSchema,
  activationReportSchema,
} from './campaign-activation.js';
import {
  CAMPAIGN_ROUTES,
  campaignOptionsSchema,
  campaignPageSchema,
  campaignSchema,
  createCampaignRequestSchema,
  duplicateCampaignRequestSchema,
  updateCampaignRequestSchema,
} from './campaigns.js';
import {
  activityQuerySchema,
  activityResponseSchema,
  campaignSummarySchema,
  DASHBOARD_ROUTES,
  integrationHealthResponseSchema,
  leadSummarySchema,
} from './dashboard.js';
import {
  LEAD_PROFILE_ROUTES,
  leadAssignmentRequestSchema,
  leadCorrectionRequestSchema,
  leadNoteRequestSchema,
  leadTagsRequestSchema,
} from './lead-profile.js';
import {
  LEAD_ROUTES,
  leadDetailSchema,
  leadEvidencePageSchema,
  leadEvidenceQuerySchema,
  leadSearchPageSchema,
  leadSearchQuerySchema,
} from './leads.js';
import {
  ENRICHMENT_ROUTES,
  enrichmentAcceptedSchema,
  enrichmentRequestSchema,
  enrichmentResultPageSchema,
  enrichmentResultsQuerySchema,
  recheckAcceptedSchema,
  recheckRequestSchema,
} from './enrichment-runs.js';
import {
  DISCOVERY_ROUTES,
  discoveryAcceptedSchema,
  discoveryRequestSchema,
  importRunSchema,
} from './lead-discovery.js';
import {
  IMPORT_ROUTES,
  cancelImportRequestSchema,
  csvImportRequestSchema,
  importOptionsSchema,
  importResultPageSchema,
  importResultsQuerySchema,
  importRunPageSchema,
} from './organization-import.js';
import {
  ACCESS_REASON_HEADER,
  WORKSPACE_ROUTES,
  acceptInvitationRequestSchema,
  accessReasonSchema,
  changeMemberRoleRequestSchema,
  createInvitationRequestSchema,
  createWorkspaceRequestSchema,
  invitationPageSchema,
  invitationPreviewSchema,
  invitationSchema,
  invitationTokenRequestSchema,
  memberPageSchema,
  memberSchema,
  pageQuerySchema,
  platformAccessRequestSchema,
  platformWorkspaceDetailSchema,
  platformWorkspacePageSchema,
  roleListResponseSchema,
  setWorkspaceStatusRequestSchema,
  userWorkspaceSchema,
  workspaceListResponseSchema,
  workspaceSchema,
  type ApiErrorCode,
} from './workspaces.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * Who may call it: anyone; any signed-in user; an active member of the workspace in the path
 * (plus `permission`, if set); a platform admin, who states a reason.
 */
export type EndpointAccess =
  'public' | 'session' | 'workspace' | 'platform_admin';

export const ENDPOINT_TAGS = [
  { name: 'health', description: 'Liveness and readiness probes.' },
  { name: 'auth', description: 'Accounts, sign-in and the session.' },
  { name: 'workspaces', description: "The signed-in user's workspaces." },
  {
    name: 'team',
    description: 'Members, roles and invitations of a workspace.',
  },
  {
    name: 'invitations',
    description: 'Previewing and accepting an invitation.',
  },
  {
    name: 'campaigns',
    description:
      'Campaign configuration, saved incrementally while a campaign is a draft.',
  },
  {
    name: 'imports',
    description:
      'Lead discovery runs: organization searches from an ICP, queued and followed by run id.',
  },
  {
    name: 'research',
    description:
      'Website research of a company: versions with dated evidence, refreshes and corrections.',
  },
  {
    name: 'leads',
    description:
      "Searching the workspace's people, one person in detail, and the evidence about them.",
  },
  {
    name: 'contacts',
    description:
      'People of the workspace: the quality of their data and the checks of their addresses.',
  },
  {
    name: 'settings',
    description:
      "Workspace settings: the send policy (which recipients' countries and which data sources may be emailed).",
  },
  {
    name: 'dashboard',
    description:
      'Counts, recent activity and integration health for the workspace dashboard.',
  },
  {
    name: 'platform',
    description: 'Platform-admin operations; each one states a reason.',
  },
] as const;

export type EndpointTag = (typeof ENDPOINT_TAGS)[number]['name'];

/**
 * Data the web app may keep in its client cache, and the scope its cache keys carry
 * (docs/decisions.md D-05B-03). `workspace`: keyed by the workspace id from the path, so data
 * of one workspace is never served or invalidated for another. `user`: the signed-in user's
 * own data. Every key also carries the user's id.
 */
export const CACHE_RESOURCES = {
  workspaces: 'user',
  workspace: 'workspace',
  members: 'workspace',
  roles: 'workspace',
  invitations: 'workspace',
  leadSummary: 'workspace',
  campaignSummary: 'workspace',
  activity: 'workspace',
  integrationHealth: 'workspace',
  campaigns: 'workspace',
  campaign: 'workspace',
  campaignOptions: 'workspace',
  campaignReadiness: 'workspace',
  importRun: 'workspace',
  importRuns: 'workspace',
  importOptions: 'workspace',
  importResults: 'workspace',
  enrichmentResults: 'workspace',
  leads: 'workspace',
  lead: 'workspace',
  leadEvidence: 'workspace',
  organizationResearch: 'workspace',
  researchVersion: 'workspace',
  sendPolicy: 'workspace',
  campaignLeads: 'workspace',
  campaignLead: 'workspace',
} as const;

export type CacheResource = keyof typeof CACHE_RESOURCES;
export type CacheScopeKind = (typeof CACHE_RESOURCES)[CacheResource];

export interface EndpointSpec {
  /** Unique; the OpenAPI operationId. */
  readonly id: string;
  readonly method: HttpMethod;
  /** Nest-style path: `/workspaces/:workspaceId/members`. */
  readonly path: string;
  readonly tag: EndpointTag;
  readonly summary: string;
  readonly access: EndpointAccess;
  /** Workspace endpoints: the role permission the route requires (none: any member). */
  readonly permission?: PermissionKey;
  /** One key per `:name` in the path. */
  readonly params?: z.ZodObject;
  readonly query?: z.ZodObject;
  /** Request headers the route reads (lower-case names). */
  readonly headers?: z.ZodObject;
  readonly body?: z.ZodType;
  readonly status: 200 | 201 | 202 | 204;
  /** The success body; null for 204. */
  readonly response: z.ZodType | null;
  /** Non-error answers besides `status` (the readiness probe's 503). */
  readonly otherResponses?: readonly {
    readonly status: number;
    readonly description: string;
    readonly schema: z.ZodType;
  }[];
  /** Error codes specific to this endpoint; the generic ones follow from its shape. */
  readonly errors?: readonly ApiErrorCode[];
  /** GET endpoints whose answers the web app may cache. */
  readonly cache?: CacheResource;
  /** Mutations: the cached resources their success makes stale. */
  readonly invalidates?: readonly CacheResource[];
}

/** Keeps the literal types of an endpoint (its schemas) for the typed client. */
function endpoint<const E extends EndpointSpec>(spec: E): E {
  return spec;
}

export const livenessResponseSchema = z
  .object({ status: z.literal('ok') })
  .strict();

export const readinessResponseSchema = z
  .object({
    status: z.enum(['ready', 'not_ready']),
    checks: z.record(
      z.string(),
      z
        .object({
          status: z.enum(['up', 'down']),
          durationMs: z.number().int().min(0),
          reason: z.enum(['timeout', 'unavailable']).optional(),
        })
        .strict(),
    ),
  })
  .strict();

const workspaceParams = z.object({ workspaceId: z.uuid() }).strict();
const memberParams = z
  .object({ workspaceId: z.uuid(), membershipId: z.uuid() })
  .strict();
const campaignParams = z
  .object({ workspaceId: z.uuid(), campaignId: z.uuid() })
  .strict();
const leadParams = z
  .object({
    workspaceId: z.uuid(),
    campaignId: z.uuid(),
    contactId: z.uuid(),
  })
  .strict();
const importParams = z
  .object({ workspaceId: z.uuid(), importId: z.uuid() })
  .strict();
const contactParams = z
  .object({ workspaceId: z.uuid(), contactId: z.uuid() })
  .strict();
const organizationParams = z
  .object({ workspaceId: z.uuid(), organizationId: z.uuid() })
  .strict();
const researchVersionParams = z
  .object({
    workspaceId: z.uuid(),
    organizationId: z.uuid(),
    researchId: z.uuid(),
  })
  .strict();
const invitationParams = z
  .object({ workspaceId: z.uuid(), invitationId: z.uuid() })
  .strict();
const reasonHeaders = z
  .object({ [ACCESS_REASON_HEADER]: accessReasonSchema })
  .strict();

export const API = {
  health: {
    live: endpoint({
      id: 'health.live',
      method: 'GET',
      path: '/health/live',
      tag: 'health',
      summary: 'The process is running (never checks dependencies).',
      access: 'public',
      status: 200,
      response: livenessResponseSchema,
    }),
    ready: endpoint({
      id: 'health.ready',
      method: 'GET',
      path: '/health/ready',
      tag: 'health',
      summary: 'PostgreSQL and Redis are reachable.',
      access: 'public',
      status: 200,
      response: readinessResponseSchema,
      otherResponses: [
        {
          status: 503,
          description: 'A dependency is down or timed out.',
          schema: readinessResponseSchema,
        },
      ],
    }),
  },
  auth: {
    register: endpoint({
      id: 'auth.register',
      method: 'POST',
      path: AUTH_ROUTES.register,
      tag: 'auth',
      summary:
        'Creates an account and emails a confirmation link; 202 whether or not the address has an account.',
      access: 'public',
      body: registerRequestSchema,
      status: 202,
      response: acceptedResponseSchema,
    }),
    verifyEmail: endpoint({
      id: 'auth.verifyEmail',
      method: 'POST',
      path: AUTH_ROUTES.verifyEmail,
      tag: 'auth',
      summary:
        'Confirms an email address with the token from the emailed link.',
      access: 'public',
      body: verifyEmailRequestSchema,
      status: 200,
      response: emailVerifiedResponseSchema,
      errors: ['invalid_or_expired_token'],
    }),
    resendVerification: endpoint({
      id: 'auth.resendVerification',
      method: 'POST',
      path: AUTH_ROUTES.resendVerification,
      tag: 'auth',
      summary: 'Sends a new confirmation link; 202 whether or not it was sent.',
      access: 'public',
      body: emailRequestSchema,
      status: 202,
      response: acceptedResponseSchema,
    }),
    login: endpoint({
      id: 'auth.login',
      method: 'POST',
      path: AUTH_ROUTES.login,
      tag: 'auth',
      summary: 'Signs in; the session token is set only in the session cookie.',
      access: 'public',
      body: loginRequestSchema,
      status: 200,
      response: sessionResponseSchema,
      errors: ['invalid_credentials', 'email_not_verified'],
    }),
    logout: endpoint({
      id: 'auth.logout',
      method: 'POST',
      path: AUTH_ROUTES.logout,
      tag: 'auth',
      summary: 'Ends the session and deletes the cookie.',
      access: 'session',
      status: 204,
      response: null,
    }),
    session: endpoint({
      id: 'auth.session',
      method: 'GET',
      path: AUTH_ROUTES.session,
      tag: 'auth',
      summary:
        "The signed-in user, the session's expiry and its CSRF token (never cached).",
      access: 'session',
      status: 200,
      response: sessionResponseSchema,
    }),
    passwordResetRequest: endpoint({
      id: 'auth.passwordResetRequest',
      method: 'POST',
      path: AUTH_ROUTES.passwordResetRequest,
      tag: 'auth',
      summary:
        'Emails a password-reset link; 202 whether or not the address has an account.',
      access: 'public',
      body: emailRequestSchema,
      status: 202,
      response: acceptedResponseSchema,
    }),
    passwordResetConfirm: endpoint({
      id: 'auth.passwordResetConfirm',
      method: 'POST',
      path: AUTH_ROUTES.passwordResetConfirm,
      tag: 'auth',
      summary: 'Sets a new password with the token from the emailed link.',
      access: 'public',
      body: passwordResetConfirmRequestSchema,
      status: 200,
      response: passwordResetResponseSchema,
      errors: ['invalid_or_expired_token'],
    }),
  },
  workspaces: {
    create: endpoint({
      id: 'workspaces.create',
      method: 'POST',
      path: WORKSPACE_ROUTES.workspaces,
      tag: 'workspaces',
      summary:
        'Creates a workspace; the signed-in user becomes its Client Admin.',
      access: 'session',
      body: createWorkspaceRequestSchema,
      status: 201,
      response: userWorkspaceSchema,
      errors: ['slug_taken'],
      invalidates: ['workspaces'],
    }),
    list: endpoint({
      id: 'workspaces.list',
      method: 'GET',
      path: WORKSPACE_ROUTES.workspaces,
      tag: 'workspaces',
      summary: "The signed-in user's active workspaces with their memberships.",
      access: 'session',
      status: 200,
      response: workspaceListResponseSchema,
      cache: 'workspaces',
    }),
    get: endpoint({
      id: 'workspaces.get',
      method: 'GET',
      path: WORKSPACE_ROUTES.workspace(':workspaceId'),
      tag: 'workspaces',
      summary: "A workspace with the signed-in user's membership.",
      access: 'workspace',
      params: workspaceParams,
      status: 200,
      response: userWorkspaceSchema,
      cache: 'workspace',
    }),
  },
  members: {
    list: endpoint({
      id: 'members.list',
      method: 'GET',
      path: WORKSPACE_ROUTES.members(':workspaceId'),
      tag: 'team',
      summary: "The workspace's members, one page at a time.",
      access: 'workspace',
      permission: 'members.read',
      params: workspaceParams,
      query: pageQuerySchema,
      status: 200,
      response: memberPageSchema,
      cache: 'members',
    }),
    changeRole: endpoint({
      id: 'members.changeRole',
      method: 'PATCH',
      path: WORKSPACE_ROUTES.member(':workspaceId', ':membershipId'),
      tag: 'team',
      summary: 'Gives a member another role; the last active admin is kept.',
      access: 'workspace',
      permission: 'members.manage',
      params: memberParams,
      body: changeMemberRoleRequestSchema,
      status: 200,
      response: memberSchema,
      errors: ['last_admin'],
      // The member may be the signed-in user, whose own membership then changes too. The
      // change is recorded in the audit records (activity).
      invalidates: ['members', 'workspace', 'workspaces', 'activity'],
    }),
  },
  roles: {
    list: endpoint({
      id: 'roles.list',
      method: 'GET',
      path: WORKSPACE_ROUTES.roles(':workspaceId'),
      tag: 'team',
      summary: "The workspace's roles and their permissions.",
      access: 'workspace',
      permission: 'members.read',
      params: workspaceParams,
      status: 200,
      response: roleListResponseSchema,
      cache: 'roles',
    }),
  },
  invitations: {
    list: endpoint({
      id: 'invitations.list',
      method: 'GET',
      path: WORKSPACE_ROUTES.invitations(':workspaceId'),
      tag: 'team',
      summary: 'Open invitations, newest first, one page at a time.',
      access: 'workspace',
      permission: 'members.read',
      params: workspaceParams,
      query: pageQuerySchema,
      status: 200,
      response: invitationPageSchema,
      cache: 'invitations',
    }),
    create: endpoint({
      id: 'invitations.create',
      method: 'POST',
      path: WORKSPACE_ROUTES.invitations(':workspaceId'),
      tag: 'team',
      summary:
        'Invites an address with a role and emails the link (never returned).',
      access: 'workspace',
      permission: 'members.manage',
      params: workspaceParams,
      body: createInvitationRequestSchema,
      status: 201,
      response: invitationSchema,
      errors: ['already_member'],
      invalidates: ['invitations', 'activity'],
    }),
    revoke: endpoint({
      id: 'invitations.revoke',
      method: 'DELETE',
      path: WORKSPACE_ROUTES.invitation(':workspaceId', ':invitationId'),
      tag: 'team',
      summary: 'Revokes an open invitation.',
      access: 'workspace',
      permission: 'members.manage',
      params: invitationParams,
      status: 204,
      response: null,
      invalidates: ['invitations', 'activity'],
    }),
    preview: endpoint({
      id: 'invitations.preview',
      method: 'POST',
      path: WORKSPACE_ROUTES.previewInvitation,
      tag: 'invitations',
      summary: 'What the invited, signed-in user is about to accept.',
      access: 'session',
      body: invitationTokenRequestSchema,
      status: 200,
      response: invitationPreviewSchema,
      errors: [
        'invalid_or_expired_invitation',
        'invitation_for_another_account',
      ],
    }),
    accept: endpoint({
      id: 'invitations.accept',
      method: 'POST',
      path: WORKSPACE_ROUTES.acceptInvitation,
      tag: 'invitations',
      summary: 'Joins the workspace the user confirmed.',
      access: 'session',
      body: acceptInvitationRequestSchema,
      status: 200,
      response: userWorkspaceSchema,
      errors: [
        'invalid_or_expired_invitation',
        'invitation_for_another_workspace',
        'invitation_for_another_account',
        'already_member',
      ],
      invalidates: ['workspaces'],
    }),
  },
  campaigns: {
    list: endpoint({
      id: 'campaigns.list',
      method: 'GET',
      path: CAMPAIGN_ROUTES.campaigns(':workspaceId'),
      tag: 'campaigns',
      summary:
        "The workspace's campaigns, newest first, with what each still needs.",
      access: 'workspace',
      permission: 'campaigns.read',
      params: workspaceParams,
      query: pageQuerySchema,
      status: 200,
      response: campaignPageSchema,
      cache: 'campaigns',
    }),
    create: endpoint({
      id: 'campaigns.create',
      method: 'POST',
      path: CAMPAIGN_ROUTES.campaigns(':workspaceId'),
      tag: 'campaigns',
      summary:
        'Creates a draft campaign: inactive, with human approval and the workspace time zone.',
      access: 'workspace',
      permission: 'campaigns.write',
      params: workspaceParams,
      body: createCampaignRequestSchema,
      status: 201,
      response: campaignSchema,
      errors: ['campaign_name_taken'],
      invalidates: ['campaigns', 'campaignSummary', 'activity'],
    }),
    options: endpoint({
      id: 'campaigns.options',
      method: 'GET',
      path: CAMPAIGN_ROUTES.options(':workspaceId'),
      tag: 'campaigns',
      summary:
        "The ICPs, lead lists, mailboxes and templates a campaign may use (the workspace's usable ones).",
      access: 'workspace',
      permission: 'campaigns.read',
      params: workspaceParams,
      status: 200,
      response: campaignOptionsSchema,
      cache: 'campaignOptions',
    }),
    get: endpoint({
      id: 'campaigns.get',
      method: 'GET',
      path: CAMPAIGN_ROUTES.campaign(':workspaceId', ':campaignId'),
      tag: 'campaigns',
      summary: "A campaign's configuration, version and readiness.",
      access: 'workspace',
      permission: 'campaigns.read',
      params: campaignParams,
      status: 200,
      response: campaignSchema,
      cache: 'campaign',
    }),
    update: endpoint({
      id: 'campaigns.update',
      method: 'PATCH',
      path: CAMPAIGN_ROUTES.campaign(':workspaceId', ':campaignId'),
      tag: 'campaigns',
      summary:
        'Saves the sections sent (each replaces its section) if the version is current; drafts only.',
      access: 'workspace',
      permission: 'campaigns.write',
      params: campaignParams,
      body: updateCampaignRequestSchema,
      status: 200,
      response: campaignSchema,
      errors: [
        'version_conflict',
        'campaign_not_editable',
        'campaign_name_taken',
      ],
      invalidates: ['campaigns', 'campaign', 'campaignReadiness', 'activity'],
    }),
    readiness: endpoint({
      id: 'campaigns.readiness',
      method: 'GET',
      path: CAMPAIGN_ROUTES.readiness(':workspaceId', ':campaignId'),
      tag: 'campaigns',
      summary:
        'Every check that must pass before the campaign can start, each with its reasons.',
      access: 'workspace',
      permission: 'campaigns.read',
      params: campaignParams,
      status: 200,
      response: activationReportSchema,
      cache: 'campaignReadiness',
    }),
    activate: endpoint({
      id: 'campaigns.activate',
      method: 'POST',
      path: CAMPAIGN_ROUTES.activate(':workspaceId', ':campaignId'),
      tag: 'campaigns',
      summary:
        'Starts a draft campaign if the version is current and every check passes; repeating it changes nothing.',
      access: 'workspace',
      permission: 'campaigns.write',
      params: campaignParams,
      body: activateCampaignRequestSchema,
      status: 200,
      response: campaignSchema,
      errors: [
        'version_conflict',
        'campaign_not_editable',
        'campaign_not_ready',
      ],
      invalidates: [
        'campaigns',
        'campaign',
        'campaignReadiness',
        'campaignSummary',
        'activity',
      ],
    }),
    duplicate: endpoint({
      id: 'campaigns.duplicate',
      method: 'POST',
      path: CAMPAIGN_ROUTES.duplicate(':workspaceId', ':campaignId'),
      tag: 'campaigns',
      summary:
        'Copies the configuration and sequences into a new draft; never leads, drafts, approvals or sends.',
      access: 'workspace',
      permission: 'campaigns.write',
      params: campaignParams,
      body: duplicateCampaignRequestSchema,
      status: 201,
      response: campaignSchema,
      errors: ['campaign_name_taken'],
      invalidates: ['campaigns', 'campaignSummary', 'activity'],
    }),
  },
  discovery: {
    request: endpoint({
      id: 'discovery.request',
      method: 'POST',
      path: DISCOVERY_ROUTES.request(':workspaceId'),
      tag: 'imports',
      summary:
        'Queues an organization search from an ICP of the workspace; answers with the run id and where to follow it. Finds companies only, never contacts.',
      access: 'workspace',
      permission: 'imports.create',
      params: workspaceParams,
      body: discoveryRequestSchema,
      status: 202,
      response: discoveryAcceptedSchema,
      invalidates: ['importRun', 'importRuns', 'activity'],
    }),
    get: endpoint({
      id: 'discovery.get',
      method: 'GET',
      path: DISCOVERY_ROUTES.run(':workspaceId', ':importId'),
      tag: 'imports',
      summary:
        'A run of the workspace: its status, what was searched, the source and the counts so far.',
      access: 'workspace',
      permission: 'imports.create',
      params: importParams,
      status: 200,
      response: importRunSchema,
      cache: 'importRun',
    }),
  },
  imports: {
    list: endpoint({
      id: 'imports.list',
      method: 'GET',
      path: IMPORT_ROUTES.imports(':workspaceId'),
      tag: 'imports',
      summary:
        "The workspace's imports and searches, newest first, with their status and counts.",
      access: 'workspace',
      permission: 'imports.create',
      params: workspaceParams,
      query: pageQuerySchema,
      status: 200,
      response: importRunPageSchema,
      cache: 'importRuns',
    }),
    options: endpoint({
      id: 'imports.options',
      method: 'GET',
      path: IMPORT_ROUTES.options(':workspaceId'),
      tag: 'imports',
      summary:
        'What the import screens offer: the ICPs a search can use, the search provider and its limits, and the CSV limits.',
      access: 'workspace',
      permission: 'imports.create',
      params: workspaceParams,
      status: 200,
      response: importOptionsSchema,
      cache: 'importOptions',
    }),
    csv: endpoint({
      id: 'imports.csv',
      method: 'POST',
      path: IMPORT_ROUTES.csv(':workspaceId'),
      tag: 'imports',
      summary:
        'Imports companies from a CSV file with a column mapping: each row is saved, matched to a company already in the workspace, excluded or reported as failed.',
      access: 'workspace',
      permission: 'imports.create',
      params: workspaceParams,
      body: csvImportRequestSchema,
      status: 201,
      response: importRunSchema,
      invalidates: ['importRuns', 'leadSummary', 'activity'],
    }),
    results: endpoint({
      id: 'imports.results',
      method: 'GET',
      path: IMPORT_ROUTES.results(':workspaceId', ':importId'),
      tag: 'imports',
      summary:
        'What happened to each record of a run, in order: created, matched, excluded or failed, with the reasons.',
      access: 'workspace',
      permission: 'imports.create',
      params: importParams,
      query: importResultsQuerySchema,
      status: 200,
      response: importResultPageSchema,
      cache: 'importResults',
    }),
    cancel: endpoint({
      id: 'imports.cancel',
      method: 'POST',
      path: IMPORT_ROUTES.cancel(':workspaceId', ':importId'),
      tag: 'imports',
      summary:
        'Stops a queued or running search; what was saved stays. Repeating it changes nothing.',
      access: 'workspace',
      permission: 'imports.create',
      params: importParams,
      body: cancelImportRequestSchema,
      status: 200,
      response: importRunSchema,
      errors: ['import_not_cancellable'],
      invalidates: ['importRun', 'importRuns', 'importResults', 'activity'],
    }),
  },
  leads: {
    search: endpoint({
      id: 'leads.search',
      method: 'GET',
      path: LEAD_ROUTES.search(':workspaceId'),
      tag: 'leads',
      summary:
        "Searches the workspace's people with allowlisted filters (text, company, contact, title, country, industry, source, campaign and its status, score, verification, eligibility, activity) and sorts (created, activity, name, company, score), one page at a time (at most 100). A cursor works only with the filters and sort it came from.",
      access: 'workspace',
      permission: 'contacts.read',
      params: workspaceParams,
      query: leadSearchQuerySchema,
      status: 200,
      response: leadSearchPageSchema,
      cache: 'leads',
    }),
    lead: endpoint({
      id: 'leads.lead',
      method: 'GET',
      path: LEAD_ROUTES.lead(':workspaceId', ':contactId'),
      tag: 'leads',
      summary:
        'One person: their company, data quality, sources, address checks, campaigns (with score and qualification) and lead lists, each list capped.',
      access: 'workspace',
      permission: 'contacts.read',
      params: contactParams,
      status: 200,
      response: leadDetailSchema,
      cache: 'lead',
    }),
    evidence: endpoint({
      id: 'leads.evidence',
      method: 'GET',
      path: LEAD_ROUTES.evidence(':workspaceId', ':contactId'),
      tag: 'leads',
      summary:
        'The evidence about a person and their company (page excerpts, provider fields, extractions, notes), newest first, one page at a time.',
      access: 'workspace',
      permission: 'contacts.read',
      params: contactParams,
      query: leadEvidenceQuerySchema,
      status: 200,
      response: leadEvidencePageSchema,
      cache: 'leadEvidence',
    }),
    correct: endpoint({
      id: 'leads.correct',
      method: 'PATCH',
      path: LEAD_PROFILE_ROUTES.lead(':workspaceId', ':contactId'),
      tag: 'leads',
      summary:
        "Corrects a person's data if `version` is the current one (409 otherwise), with a reason kept as a note. A material change (name, title, address, country) invalidates the person's drafts, cancels their scheduled sends and sends every campaign's decision back to Review with eligibility decided again. Audited without the values.",
      access: 'workspace',
      permission: 'contacts.write',
      params: contactParams,
      body: leadCorrectionRequestSchema,
      status: 200,
      response: leadDetailSchema,
      errors: ['version_conflict', 'email_taken'],
      invalidates: [
        'lead',
        'leads',
        'leadEvidence',
        'campaignLead',
        'campaignLeads',
        'activity',
      ],
    }),
    tags: endpoint({
      id: 'leads.tags',
      method: 'PATCH',
      path: LEAD_PROFILE_ROUTES.tags(':workspaceId', ':contactId'),
      tag: 'leads',
      summary:
        "Replaces a person's tags (at most 20) if `version` is the current one (409 otherwise). Audited.",
      access: 'workspace',
      permission: 'contacts.write',
      params: contactParams,
      body: leadTagsRequestSchema,
      status: 200,
      response: leadDetailSchema,
      errors: ['version_conflict'],
      invalidates: ['lead', 'leads', 'activity'],
    }),
    note: endpoint({
      id: 'leads.note',
      method: 'POST',
      path: LEAD_PROFILE_ROUTES.notes(':workspaceId', ':contactId'),
      tag: 'leads',
      summary:
        'Adds a note to a person; notes never change. Audited without the text.',
      access: 'workspace',
      permission: 'contacts.write',
      params: contactParams,
      body: leadNoteRequestSchema,
      status: 201,
      response: leadDetailSchema,
      invalidates: ['lead', 'activity'],
    }),
    assign: endpoint({
      id: 'leads.assign',
      method: 'POST',
      path: LEAD_PROFILE_ROUTES.campaigns(':workspaceId', ':contactId'),
      tag: 'leads',
      summary:
        "Adds a person to a campaign's lead list if `version` is the current one (409 otherwise). Refused (409 assignment_not_possible) for a campaign that has ended or has no lead list, and for a person who is archived, on the do-not-contact list or excluded by the campaign. Audited.",
      access: 'workspace',
      permission: 'campaigns.write',
      params: contactParams,
      body: leadAssignmentRequestSchema,
      status: 200,
      response: leadDetailSchema,
      errors: ['version_conflict', 'assignment_not_possible'],
      invalidates: [
        'lead',
        'leads',
        'campaignLead',
        'campaignLeads',
        'activity',
      ],
    }),
  },
  enrichment: {
    request: endpoint({
      id: 'enrichment.request',
      method: 'POST',
      path: ENRICHMENT_ROUTES.request(':workspaceId', ':importId'),
      tag: 'imports',
      summary:
        "Queues a contact enrichment run for the companies a completed run saved (at most 25), with the ICP's titles, seniorities and countries and the campaign's exclusions; answers with the run id. Needs contacts.write too.",
      access: 'workspace',
      permission: 'imports.create',
      params: importParams,
      body: enrichmentRequestSchema,
      status: 202,
      response: enrichmentAcceptedSchema,
      invalidates: ['importRun', 'importRuns', 'activity'],
    }),
    contacts: endpoint({
      id: 'enrichment.contacts',
      method: 'GET',
      path: ENRICHMENT_ROUTES.contacts(':workspaceId', ':importId'),
      tag: 'imports',
      summary:
        'What each person an enrichment run found became, in order (created, matched, excluded or failed, with the reasons, the role match and the check), and the companies it skipped.',
      access: 'workspace',
      permission: 'imports.create',
      params: importParams,
      query: enrichmentResultsQuerySchema,
      status: 200,
      response: enrichmentResultPageSchema,
      cache: 'enrichmentResults',
    }),
    recheck: endpoint({
      id: 'enrichment.recheck',
      method: 'POST',
      path: ENRICHMENT_ROUTES.recheck(':workspaceId', ':contactId'),
      tag: 'contacts',
      summary:
        "Queues a new check of a contact's address: once a contact in 24 hours and 50 a workspace in 24 hours (429 with Retry-After otherwise). Repeating it while queued changes nothing. Audited.",
      access: 'workspace',
      permission: 'verifications.run',
      params: contactParams,
      body: recheckRequestSchema,
      status: 202,
      response: recheckAcceptedSchema,
      errors: [
        'verification_unavailable',
        'no_email_address',
        'too_many_requests',
      ],
      invalidates: ['campaignLead', 'campaignLeads', 'activity'],
    }),
  },
  research: {
    organization: endpoint({
      id: 'research.organization',
      method: 'GET',
      path: RESEARCH_ROUTES.organization(':workspaceId', ':organizationId'),
      tag: 'research',
      summary:
        "A company's website research: the current version with its facts and dated evidence, a queued or running run, and the earlier versions.",
      access: 'workspace',
      permission: 'contacts.read',
      params: organizationParams,
      status: 200,
      response: organizationResearchSchema,
      cache: 'organizationResearch',
    }),
    version: endpoint({
      id: 'research.version',
      method: 'GET',
      path: RESEARCH_ROUTES.version(
        ':workspaceId',
        ':organizationId',
        ':researchId',
      ),
      tag: 'research',
      summary:
        "One version of a company's research, as it was completed, with its evidence.",
      access: 'workspace',
      permission: 'contacts.read',
      params: researchVersionParams,
      status: 200,
      response: researchVersionSchema,
      cache: 'researchVersion',
    }),
    request: endpoint({
      id: 'research.request',
      method: 'POST',
      path: RESEARCH_ROUTES.organization(':workspaceId', ':organizationId'),
      tag: 'research',
      summary:
        'Queues website research of a company, or answers with a run already queued or research completed in the last 30 days (unless refresh). Reads public pages only, through the safe fetcher.',
      access: 'workspace',
      permission: 'research.run',
      params: organizationParams,
      body: researchRequestSchema,
      status: 202,
      response: researchAcceptedSchema,
      errors: ['research_not_possible'],
      invalidates: ['organizationResearch', 'activity'],
    }),
    correct: endpoint({
      id: 'research.correct',
      method: 'POST',
      path: RESEARCH_ROUTES.corrections(':workspaceId', ':organizationId'),
      tag: 'research',
      summary:
        "Corrects one field of the current version (set, reject or restore), with a note: a new version, audited; earlier versions don't change.",
      access: 'workspace',
      permission: 'research.run',
      params: organizationParams,
      body: researchCorrectionRequestSchema,
      status: 201,
      response: researchVersionSchema,
      errors: ['version_conflict'],
      invalidates: ['organizationResearch', 'researchVersion', 'activity'],
    }),
  },
  qualification: {
    leads: endpoint({
      id: 'qualification.leads',
      method: 'GET',
      path: QUALIFICATION_ROUTES.leads(':workspaceId', ':campaignId'),
      tag: 'campaigns',
      summary:
        "The campaign's leads (its lead list), one page at a time, with each lead's current score and qualification.",
      access: 'workspace',
      permission: 'campaigns.read',
      params: campaignParams,
      query: pageQuerySchema,
      status: 200,
      response: leadPageSchema,
      cache: 'campaignLeads',
    }),
    lead: endpoint({
      id: 'qualification.lead',
      method: 'GET',
      path: QUALIFICATION_ROUTES.lead(
        ':workspaceId',
        ':campaignId',
        ':contactId',
      ),
      tag: 'campaigns',
      summary:
        "One lead of a campaign: its fit (the score's factors with explanations and evidence), its eligibility decided now and apart from the score, and its qualification with the history of decisions.",
      access: 'workspace',
      permission: 'campaigns.read',
      params: leadParams,
      status: 200,
      response: leadQualificationViewSchema,
      cache: 'campaignLead',
    }),
    qualify: endpoint({
      id: 'qualification.qualify',
      method: 'POST',
      path: QUALIFICATION_ROUTES.qualify(
        ':workspaceId',
        ':campaignId',
        ':contactId',
      ),
      tag: 'campaigns',
      summary:
        'Queues a qualification run (the agent proposes supported need and timing; application code scores and decides), or answers with the run already queued. Audited.',
      access: 'workspace',
      permission: 'research.run',
      params: leadParams,
      body: qualifyRequestSchema,
      status: 202,
      response: qualifyAcceptedSchema,
      invalidates: ['campaignLead', 'activity'],
    }),
    decide: endpoint({
      id: 'qualification.decide',
      method: 'POST',
      path: QUALIFICATION_ROUTES.decisions(
        ':workspaceId',
        ':campaignId',
        ':contactId',
      ),
      tag: 'campaigns',
      summary:
        "A person's decision (qualified, review or rejected) with a note, if `version` is the current one; audited. It never lifts a block: a blocked lead can't be qualified. Accepting the eligibility checks that need a person also needs drafts.approve.",
      access: 'workspace',
      permission: 'campaigns.write',
      params: leadParams,
      body: qualificationDecisionRequestSchema,
      status: 201,
      response: leadQualificationViewSchema,
      errors: ['version_conflict', 'qualification_blocked'],
      // The lead's profile shows the decisions too (task 11B).
      invalidates: [
        'campaignLead',
        'campaignLeads',
        'lead',
        'leads',
        'activity',
      ],
    }),
  },
  settings: {
    sendPolicy: endpoint({
      id: 'settings.sendPolicy',
      method: 'GET',
      path: SEND_POLICY_ROUTES.sendPolicy(':workspaceId'),
      tag: 'settings',
      summary:
        "The workspace's send policy and its version; null until it is set, and then nobody is allowed.",
      access: 'workspace',
      permission: 'settings.manage',
      params: workspaceParams,
      status: 200,
      response: sendPolicyStateSchema,
      cache: 'sendPolicy',
    }),
    updateSendPolicy: endpoint({
      id: 'settings.updateSendPolicy',
      method: 'PATCH',
      path: SEND_POLICY_ROUTES.sendPolicy(':workspaceId'),
      tag: 'settings',
      summary:
        'Replaces the send policy if `version` is the stored one (409 otherwise); null clears it. Audited.',
      access: 'workspace',
      permission: 'settings.manage',
      params: workspaceParams,
      body: updateSendPolicyRequestSchema,
      status: 200,
      response: sendPolicyStateSchema,
      errors: ['version_conflict'],
      invalidates: ['sendPolicy', 'activity'],
    }),
  },
  dashboard: {
    leadSummary: endpoint({
      id: 'dashboard.leadSummary',
      method: 'GET',
      path: DASHBOARD_ROUTES.leadSummary(':workspaceId'),
      tag: 'dashboard',
      summary: 'Counts of the contacts and companies in the workspace.',
      access: 'workspace',
      permission: 'contacts.read',
      params: workspaceParams,
      status: 200,
      response: leadSummarySchema,
      cache: 'leadSummary',
    }),
    campaignSummary: endpoint({
      id: 'dashboard.campaignSummary',
      method: 'GET',
      path: DASHBOARD_ROUTES.campaignSummary(':workspaceId'),
      tag: 'dashboard',
      summary: 'Counts of the campaigns and their leads, by status.',
      access: 'workspace',
      permission: 'campaigns.read',
      params: workspaceParams,
      status: 200,
      response: campaignSummarySchema,
      cache: 'campaignSummary',
    }),
    activity: endpoint({
      id: 'dashboard.activity',
      method: 'GET',
      path: DASHBOARD_ROUTES.activity(':workspaceId'),
      tag: 'dashboard',
      summary:
        'The latest audit records, newest first, with counts for the last 24 hours, 7 and 30 days.',
      access: 'workspace',
      permission: 'audit.read',
      params: workspaceParams,
      query: activityQuerySchema,
      status: 200,
      response: activityResponseSchema,
      cache: 'activity',
    }),
    integrationHealth: endpoint({
      id: 'dashboard.integrationHealth',
      method: 'GET',
      path: DASHBOARD_ROUTES.integrationHealth(':workspaceId'),
      tag: 'dashboard',
      summary:
        'Mailboxes, syncs and failed provider notifications of each integration, with its health.',
      access: 'workspace',
      permission: 'settings.manage',
      params: workspaceParams,
      status: 200,
      response: integrationHealthResponseSchema,
      cache: 'integrationHealth',
    }),
  },
  platform: {
    listWorkspaces: endpoint({
      id: 'platform.listWorkspaces',
      method: 'GET',
      path: WORKSPACE_ROUTES.platformWorkspaces,
      tag: 'platform',
      summary: 'Every workspace, newest first; audited with the stated reason.',
      access: 'platform_admin',
      headers: reasonHeaders,
      query: pageQuerySchema,
      status: 200,
      response: platformWorkspacePageSchema,
    }),
    openAccess: endpoint({
      id: 'platform.openAccess',
      method: 'POST',
      path: WORKSPACE_ROUTES.platformWorkspaceAccess(':workspaceId'),
      tag: 'platform',
      summary:
        'Opens audited, read-only access to a workspace and returns its summary.',
      access: 'platform_admin',
      params: workspaceParams,
      body: platformAccessRequestSchema,
      status: 200,
      response: platformWorkspaceDetailSchema,
    }),
    setWorkspaceStatus: endpoint({
      id: 'platform.setWorkspaceStatus',
      method: 'POST',
      path: WORKSPACE_ROUTES.platformWorkspaceStatus(':workspaceId'),
      tag: 'platform',
      summary: 'Suspends or reactivates a workspace; audited with the reason.',
      access: 'platform_admin',
      params: workspaceParams,
      body: setWorkspaceStatusRequestSchema,
      status: 200,
      response: workspaceSchema,
    }),
  },
} as const;

/** Every endpoint, in the order of `API`. */
export const ALL_ENDPOINTS: readonly EndpointSpec[] = Object.values(
  API,
).flatMap((group: Readonly<Record<string, EndpointSpec>>) =>
  Object.values(group),
);

/** HTTP status of every error code (the error envelope's `code`). */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  validation_failed: 400,
  invalid_credentials: 401,
  email_not_verified: 403,
  invalid_or_expired_token: 400,
  unauthenticated: 401,
  session_expired: 401,
  csrf_failed: 403,
  forbidden_origin: 403,
  too_many_requests: 429,
  not_found: 404,
  forbidden: 403,
  already_member: 409,
  last_admin: 409,
  slug_taken: 409,
  invalid_or_expired_invitation: 400,
  invitation_for_another_account: 403,
  invitation_for_another_workspace: 400,
  version_conflict: 409,
  campaign_not_editable: 409,
  campaign_name_taken: 409,
  campaign_not_ready: 409,
  import_not_cancellable: 409,
  research_not_possible: 409,
  qualification_blocked: 409,
  verification_unavailable: 409,
  no_email_address: 409,
  email_taken: 409,
  assignment_not_possible: 409,
};

/** Mutations need the session's CSRF token (and every non-GET route checks the origin). */
export function needsCsrfToken(spec: EndpointSpec): boolean {
  return spec.method !== 'GET' && spec.access !== 'public';
}

/** Every error code the endpoint can answer with, generic ones included. */
export function endpointErrorCodes(spec: EndpointSpec): ApiErrorCode[] {
  const codes = new Set<ApiErrorCode>();
  if (
    spec.body !== undefined ||
    spec.query !== undefined ||
    spec.headers !== undefined
  ) {
    codes.add('validation_failed');
  }
  if (spec.access !== 'public') {
    codes.add('unauthenticated');
    codes.add('session_expired');
  }
  if (spec.method !== 'GET') {
    codes.add('forbidden_origin');
    // Reads skip the per-address request limit (docs/security/authorization-review.md).
    codes.add('too_many_requests');
    if (needsCsrfToken(spec)) {
      codes.add('csrf_failed');
    }
  }
  if (spec.access === 'workspace' || spec.params !== undefined) {
    codes.add('not_found');
  }
  if (
    spec.access === 'platform_admin' ||
    (spec.access === 'workspace' && spec.permission !== undefined)
  ) {
    codes.add('forbidden');
  }
  for (const code of spec.errors ?? []) {
    codes.add(code);
  }
  return [...codes];
}

/** The `:name` parameters of a path, in order. */
export function pathParamNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z]\w*)/g)].map((match) => match[1] ?? '');
}

/** A request that doesn't match the endpoint's schemas; `issues` never echo the input. */
export class EndpointInputError extends Error {
  constructor(
    readonly part: 'params' | 'query' | 'headers' | 'body',
    readonly issues: readonly { path: string; message: string }[],
  ) {
    super(`The request's ${part} do not match the endpoint.`);
    this.name = 'EndpointInputError';
  }
}

function parsePart<S extends z.ZodType>(
  part: EndpointInputError['part'],
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new EndpointInputError(
      part,
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || `(${part})`,
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/**
 * The validated request: path with encoded parameters, the parameters, query string (sorted
 * keys, empty values left out), headers and body. Throws EndpointInputError.
 */
export function buildEndpointRequest(
  spec: EndpointSpec,
  input: {
    readonly params?: unknown;
    readonly query?: unknown;
    readonly headers?: unknown;
    readonly body?: unknown;
  },
): {
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
} {
  const params =
    spec.params === undefined
      ? {}
      : (parsePart('params', spec.params, input.params) as Record<
          string,
          string
        >);
  let path = spec.path.replace(/:([A-Za-z]\w*)/g, (_, name: string) =>
    encodeURIComponent(params[name] ?? ''),
  );
  if (spec.query !== undefined && input.query !== undefined) {
    const query: Record<string, unknown> = parsePart(
      'query',
      spec.query,
      input.query,
    );
    const search = new URLSearchParams();
    for (const key of Object.keys(query).sort()) {
      const value = query[key];
      if (value !== undefined && value !== null && value !== '') {
        search.set(
          key,
          typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
            ? String(value)
            : JSON.stringify(value),
        );
      }
    }
    const text = search.toString();
    if (text !== '') {
      path = `${path}?${text}`;
    }
  }
  const headers =
    spec.headers === undefined
      ? {}
      : (parsePart('headers', spec.headers, input.headers) as Record<
          string,
          string
        >);
  const body =
    spec.body === undefined
      ? undefined
      : parsePart('body', spec.body, input.body);
  return { path, params, headers, body };
}

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** What a call of `E` takes: params, query, headers and body, as its schemas accept them. */
export type EndpointInput<E extends EndpointSpec> = Simplify<
  (E extends { readonly params: infer P extends z.ZodType }
    ? { readonly params: z.input<P> }
    : unknown) &
    (E extends { readonly query: infer Q extends z.ZodType }
      ? { readonly query?: z.input<Q> }
      : unknown) &
    (E extends { readonly headers: infer H extends z.ZodType }
      ? { readonly headers: z.input<H> }
      : unknown) &
    (E extends { readonly body: infer B extends z.ZodType }
      ? { readonly body: z.input<B> }
      : unknown)
>;

/** What a call of `E` resolves to: the validated response, or undefined for 204. */
export type EndpointResponse<E extends EndpointSpec> =
  // Indexed, so it stays deferred inside generic code instead of collapsing to undefined.
  E['response'] extends z.ZodType ? z.output<E['response']> : undefined;

/** GET endpoints the web app may cache. */
export type CacheableEndpoint = EndpointSpec & {
  readonly method: 'GET';
  readonly cache: CacheResource;
};

/** Endpoints that change something (everything but GET). */
export type MutationEndpoint = EndpointSpec & {
  readonly method: 'POST' | 'PATCH' | 'DELETE';
};
