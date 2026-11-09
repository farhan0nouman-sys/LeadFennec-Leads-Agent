import { describe, expect, it } from 'vitest';
import { findWorkspaceSection } from '../navigation.js';
import {
  activityItemSchema,
  activityLabel,
  ACTIVITY_LABELS,
  campaignSummarySchema,
  DASHBOARD_METRICS,
  HEALTH_PROVIDERS,
  integrationHealthState,
  leadSummarySchema,
} from './dashboard.js';
import { API } from './endpoints.js';

const NO_MAILBOXES = {
  PENDING: 0,
  ACTIVE: 0,
  PAUSED: 0,
  DISCONNECTED: 0,
  ERROR: 0,
};
const quiet = {
  syncs: 0,
  failingSyncs: 0,
  failedEventsLast24Hours: 0,
  lastEventAt: null,
};

describe('dashboard metrics (task 05C)', () => {
  const summaries = {
    leads: leadSummarySchema,
    campaigns: campaignSummarySchema,
  } as const;

  it('reads every available metric from its summary, and no unavailable one', () => {
    const keys = DASHBOARD_METRICS.map((metric) => metric.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const metric of DASHBOARD_METRICS) {
      const shape: Record<string, unknown> = summaries[metric.group].shape;
      expect(metric.key in shape, metric.key).toBe(
        metric.status === 'available',
      );
    }
    // Both groups show what's still to come, explicitly.
    for (const group of ['leads', 'campaigns'] as const) {
      const statuses = DASHBOARD_METRICS.filter((m) => m.group === group).map(
        (m) => m.status,
      );
      expect(statuses, group).toContain('available');
      expect(statuses, group).toContain('unavailable');
    }
  });

  it('serves each group from the endpoint of the section that owns its data', () => {
    expect(API.dashboard.leadSummary.permission).toBe(
      findWorkspaceSection('leads')?.permission,
    );
    expect(API.dashboard.campaignSummary.permission).toBe(
      findWorkspaceSection('campaigns')?.permission,
    );
    expect(API.dashboard.activity.permission).toBe(
      findWorkspaceSection('audit')?.permission,
    );
    expect(API.dashboard.integrationHealth.permission).toBe(
      findWorkspaceSection('integrations')?.permission,
    );
  });
});

describe('activity', () => {
  it('describes the actions the application records', () => {
    for (const action of [
      'workspace.created',
      'invitation.created',
      'invitation.revoked',
      'invitation.accepted',
      'membership.role_changed',
      'platform_admin.access_opened',
    ]) {
      expect(ACTIVITY_LABELS[action], action).toBeDefined();
    }
    expect(activityLabel('something.new')).toBe('made a change');
  });

  it('never carries the id of the record changed', () => {
    const item = {
      id: '0b7f4e2a-3c1d-4e5f-8a9b-1c2d3e4f5a6b',
      action: 'invitation.created',
      actor: { kind: 'member', name: 'Alex' },
      targetType: 'invitation',
      reason: null,
      occurredAt: '2026-11-02T09:00:00.000Z',
    };
    expect(activityItemSchema.parse(item)).toEqual(item);
    expect(() =>
      activityItemSchema.parse({
        ...item,
        targetId: '1c2d3e4f-5a6b-4c7d-9e8f-0a1b2c3d4e5f',
      }),
    ).toThrow();
  });
});

describe('integrationHealthState', () => {
  it('lists the integrations a workspace connects itself', () => {
    expect(HEALTH_PROVIDERS.map((p) => p.provider)).toEqual([
      'GMAIL',
      'MICROSOFT_GRAPH',
      'GOHIGHLEVEL',
      'APOLLO',
    ]);
  });

  it('decides mailbox health from the mailboxes, syncs and failed notifications', () => {
    const mailbox = (counts: Partial<typeof NO_MAILBOXES>, rest = {}) =>
      integrationHealthState({
        ...quiet,
        mailboxes: { ...NO_MAILBOXES, ...counts },
        ...rest,
      });
    expect(mailbox({})).toBe('not_connected');
    expect(mailbox({ DISCONNECTED: 2 })).toBe('not_connected');
    expect(mailbox({ PENDING: 1 })).toBe('connecting');
    expect(mailbox({ ACTIVE: 1, PENDING: 1 })).toBe('healthy');
    expect(mailbox({ PAUSED: 1 })).toBe('healthy');
    expect(mailbox({ ACTIVE: 3, ERROR: 1 })).toBe('attention');
    expect(mailbox({ ACTIVE: 1 }, { failingSyncs: 1 })).toBe('attention');
    expect(mailbox({ ACTIVE: 1 }, { failedEventsLast24Hours: 1 })).toBe(
      'attention',
    );
  });

  it('decides other integrations from their syncs and notifications', () => {
    const other = (rest = {}) =>
      integrationHealthState({ ...quiet, mailboxes: null, ...rest });
    expect(other()).toBe('not_connected');
    expect(other({ syncs: 1 })).toBe('healthy');
    expect(other({ lastEventAt: '2026-11-02T09:00:00.000Z' })).toBe('healthy');
    expect(other({ syncs: 1, failingSyncs: 1 })).toBe('attention');
    expect(other({ failedEventsLast24Hours: 2 })).toBe('attention');
  });
});
