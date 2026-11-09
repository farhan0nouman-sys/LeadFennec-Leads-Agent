// Fixture data for the component demo (task 05B, docs/decisions.md D-05B-05). Made-up people at
// made-up companies on reserved example domains (RFC 2606): never real prospects. Only the demo
// pages (app/dev) may import this folder; ESLint refuses it anywhere else, and this folder may
// not import the API client or its cache.

export const DEMO_LEAD_STATUSES = [
  { value: 'new', label: 'New', tone: 'info' },
  { value: 'qualified', label: 'Qualified', tone: 'success' },
  { value: 'contacted', label: 'Contacted', tone: 'neutral' },
  { value: 'replied', label: 'Replied', tone: 'success' },
  { value: 'do_not_contact', label: 'Do not contact', tone: 'danger' },
  { value: 'bounced', label: 'Bounced', tone: 'warning' },
] as const;

export type DemoLeadStatus = (typeof DEMO_LEAD_STATUSES)[number]['value'];

export interface DemoLead {
  readonly id: string;
  readonly name: string;
  readonly company: string;
  readonly email: string;
  readonly status: DemoLeadStatus;
  readonly score: number;
}

const FIRST = [
  'Avery',
  'Blake',
  'Casey',
  'Devon',
  'Emery',
  'Finley',
  'Gray',
  'Harper',
];
const LAST = [
  'Stone',
  'Rivers',
  'Hale',
  'Marsh',
  'Vale',
  'Brook',
  'Fenn',
  'Lark',
];
const COMPANIES = [
  'Northwind Example Co',
  'Contoso Fixtures',
  'Tailspin Demo Ltd',
  'Fabrikam Sample Inc',
  'Adventure Placeholder',
];
const DOMAINS = ['example.com', 'example.org', 'example.net'];

/** 42 leads, the same every time (no randomness), so tests can rely on them. */
export function demoLeads(): DemoLead[] {
  return Array.from({ length: 42 }, (_, index) => {
    const first = FIRST[index % FIRST.length] ?? 'Avery';
    const last =
      LAST[Math.floor(index / FIRST.length) % LAST.length] ?? 'Stone';
    const status = DEMO_LEAD_STATUSES[index % DEMO_LEAD_STATUSES.length];
    return {
      id: `demo-${String(index + 1).padStart(3, '0')}`,
      name: `${first} ${last}`,
      company: COMPANIES[index % COMPANIES.length] ?? 'Northwind Example Co',
      email:
        `${first}.${last}.${String(index + 1)}@${DOMAINS[index % DOMAINS.length] ?? 'example.com'}`.toLowerCase(),
      status: status?.value ?? 'new',
      score: (index * 37) % 100,
    };
  });
}
