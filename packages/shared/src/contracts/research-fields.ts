// What website research can report about a company (task 09B). Kept apart from the agent's
// contract so modules that only name a field (lead scoring, task 10A) don't import the campaign
// contract through it.

/** What research can report about a company. Application code picks the fields to ask. */
export const WEBSITE_RESEARCH_FIELDS = [
  'company_summary',
  'products_services',
  'industry',
  'target_customers',
  'headquarters',
  'founded_year',
  'employee_count',
  'markets_served',
  'notable_customers',
  'recent_news',
  'technologies',
  'hiring',
] as const;

export type WebsiteResearchField = (typeof WEBSITE_RESEARCH_FIELDS)[number];
