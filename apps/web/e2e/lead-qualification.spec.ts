// Lead qualification (task 10C) against the real API, database and worker jobs (run-task, no
// Redis). The fake fetcher serves synthetic pages and the fake model reads them, so nothing
// leaves the machine. A campaign's leads are listed; a lead is qualified by the worker (the agent
// proposes, application code scores and decides); its page shows fit with explanations and
// evidence, eligibility and qualification apart; a person's decision is kept and audited; a
// suppression blocks the lead whatever its score or decision. Accessibility is checked with axe.
// One account signs in once (the API limits sign-ins).
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  apiMutation,
  person,
  registerVerified,
  signIn,
} from './support/accounts';
import { E2eDatabase } from './support/db';
import { SKIP_REASON, WEB_URL, e2eEnabled } from './support/env';
import { runSearchTask as runTask } from './support/worker';

test.skip(!e2eEnabled, SKIP_REASON);
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const run = `qlf${Date.now().toString(36)}`;
const PASSWORD = 'correct horse battery staple qualify';
const quinnsCoach = person('ria', 'Ria Reviewer', run);

let db: E2eDatabase;
let workspaceId = '';
let campaignId = '';
let lead: Awaited<ReturnType<E2eDatabase['seedQualificationLead']>>;
let context: BrowserContext;
let page: Page;

async function expectAccessible() {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

const section = (name: string) =>
  page.getByRole('region', { name, exact: true });

test.beforeAll(async ({ browser, playwright }) => {
  db = await E2eDatabase.connect();
  const request = await playwright.request.newContext({ baseURL: WEB_URL });
  await registerVerified(request, db, quinnsCoach, PASSWORD);
  await request.dispose();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  page = await context.newPage();
  await signIn(page, quinnsCoach, PASSWORD);
  const created = await apiMutation(page, 'POST', '/workspaces', {
    name: `Qualify ${run}`,
  });
  expect(created.status()).toBe(201);
  workspaceId = ((await created.json()) as { workspace: { id: string } })
    .workspace.id;
  lead = await db.seedQualificationLead(workspaceId, run);
  const icpId = await db.seedIcp(workspaceId, 'Software sales leaders', {
    industries: ['software'],
    employees: { min: 50, max: 500 },
    titles: ['VP Sales'],
  });
  const campaign = await apiMutation(
    page,
    'POST',
    `/workspaces/${workspaceId}/campaigns`,
    { name: 'Quill outreach' },
  );
  expect(campaign.status()).toBe(201);
  const body = (await campaign.json()) as { id: string; version: number };
  campaignId = body.id;
  const saved = await apiMutation(
    page,
    'PATCH',
    `/workspaces/${workspaceId}/campaigns/${campaignId}`,
    { version: body.version, audience: { icpId, leadListId: lead.listId } },
  );
  expect(saved.status()).toBe(200);
  // The company's research first (09C): the agent reads its facts.
  const research = await apiMutation(
    page,
    'POST',
    `/workspaces/${workspaceId}/organizations/${lead.organizationId}/research`,
    {},
  );
  expect(research.status()).toBe(202);
  const researchId = await db.latestResearchId(
    workspaceId,
    lead.organizationId,
  );
  expect(await runTask(await db.researchTaskId(workspaceId, researchId))).toBe(
    'completed',
  );
});

test.afterAll(async () => {
  await context.close();
  await db.close();
});

test("the campaign's leads are listed, and a lead's page keeps fit, eligibility and qualification apart", async () => {
  await page.goto(`/workspaces/${workspaceId}/campaigns/${campaignId}`);
  // The campaign page's own link (the navigation has a Leads link too, since 11B).
  await page
    .getByRole('main')
    .getByRole('link', { name: 'Leads', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Leads of Quill outreach' }),
  ).toBeVisible();
  const table = page.getByRole('table', { name: 'Leads' });
  await expect(
    table.getByRole('rowheader', { name: 'Quinn Park' }),
  ).toBeVisible();
  await expect(table).toContainText('Not scored');
  await expect(table).toContainText('Not qualified yet');
  await expectAccessible();

  await table.getByRole('link', { name: 'Quinn Park' }).click();
  await expect(
    page.getByRole('heading', { name: 'Quinn Park', level: 1 }),
  ).toBeVisible();
  await expect(section('Fit')).toContainText('Not scored yet');
  await expect(section('Eligibility')).toContainText(
    'Decided now, from the facts, without the score.',
  );
  await expect(section('Qualification')).toContainText('Not qualified yet.');
  await expectAccessible();
});

test('the worker qualifies the lead: the agent proposes, application code scores and decides, with reasons', async () => {
  await page.getByRole('button', { name: 'Qualify this lead' }).click();
  await expect(
    page.getByText('Qualification is queued.', { exact: true }),
  ).toBeVisible();
  expect(await runTask(await db.qualificationTaskId(workspaceId))).toBe(
    'qualified',
  );

  // The page follows the run and shows the score when it is done.
  const fit = section('Fit');
  await expect(fit.getByText('High Priority')).toBeVisible({ timeout: 30_000 });
  const need = fit.getByRole('region', { name: /^Supported need/ });
  await expect(need).toContainText('Qualification agent');
  await expect(need.getByRole('list', { name: 'Evidence' })).toContainText(
    'Research version 1',
  );
  const industry = fit.getByRole('region', { name: /^Industry/ });
  await expect(industry).toContainText('Rules');
  await expect(industry).toContainText('Company record: industry');
  // Timing: no hiring or news on the pages, so no evidence and no points.
  await expect(fit.getByRole('region', { name: /^Timing/ })).toContainText(
    '0 of 10 points',
  );

  // Eligibility is its own decision: the campaign isn't running and no send policy is set.
  const eligibility = section('Eligibility');
  await expect(eligibility).toContainText('May not be emailed');
  await expect(eligibility).toContainText(
    "The campaign may not email this person now. A score can't change that.",
  );
  await expect(eligibility).toContainText('For every lead of the campaign');

  // The automatic state, explained.
  const qualification = section('Qualification');
  await expect(
    qualification.getByText('Review', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    qualification.getByRole('list', { name: 'Reasons' }),
  ).toContainText(
    'Some eligibility checks need a person before this lead may be emailed.',
  );
  await expectAccessible();
});

test("a person's decision is kept with a note and audited, and a suppression blocks whatever was decided", async () => {
  const qualification = section('Qualification');
  await qualification
    .getByLabel('Qualification', { exact: true })
    .selectOption('QUALIFIED');
  await qualification
    .getByLabel('Why (kept with the decision)')
    .fill('Spoke at the synthetic meetup; wants a demo.');
  await qualification.getByRole('checkbox').check();
  await qualification.getByRole('button', { name: 'Save decision' }).click();
  await expect(qualification.getByText('Saved: Qualified.')).toBeVisible();
  const history = qualification.getByRole('table', { name: 'Decisions' });
  await expect(
    history.getByRole('rowheader', { name: 'Decision 2' }),
  ).toBeVisible();
  await expect(history).toContainText('Ria Reviewer');
  await expect(history).toContainText('Spoke at the synthetic meetup');
  const actions = await db.workspaceAuditActions(workspaceId);
  expect(actions).toContain('lead.qualification_requested');
  expect(actions).toContain('lead.qualification_decided');

  // The person opts out: the lead is blocked, whatever its score or the decision.
  await db.seedSuppressedEmail(workspaceId, lead.email);
  await page.reload();
  const eligibility = section('Eligibility');
  await expect(eligibility).toContainText(
    'The address is on the do-not-contact list.',
  );
  await expect(eligibility).toContainText('Nobody can override this.');
  await expect(section('Fit').getByText('High Priority')).toBeVisible();
  await expect(section('Qualification')).toContainText(
    'Qualified, but blocked since',
  );
  await expect(
    section('Qualification')
      .getByLabel('Qualification', { exact: true })
      .locator('option'),
  ).toHaveText(['Review', 'Rejected']);
  await expectAccessible();
});
