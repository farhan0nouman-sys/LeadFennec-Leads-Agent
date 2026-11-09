// An in-memory stand-in for a paginated API list (task 05B), for the component demo only. It
// pages by cursor like the API, searches and filters, waits a little to show loading states,
// and can be told to fail the next request to show retry states. Nothing leaves the browser.
import type { DemoLead, DemoLeadStatus } from './demo-leads';

export interface FixtureQuery {
  readonly q: string;
  readonly status: DemoLeadStatus | '';
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface FixturePage {
  readonly items: readonly DemoLead[];
  readonly nextCursor: string | null;
  readonly total: number;
}

export class FixtureFailure extends Error {
  constructor() {
    super('The demo was told to fail this request.');
    this.name = 'FixtureFailure';
  }
}

export class FixtureSource {
  #rows: DemoLead[];
  #failNext = false;

  constructor(
    rows: readonly DemoLead[],
    private readonly delayMs = 250,
  ) {
    this.#rows = [...rows];
  }

  /** The next list() or add() fails once (shows the retry state). */
  failNextRequest(): void {
    this.#failNext = true;
  }

  #wait<T>(work: () => T): Promise<T> {
    const fail = this.#failNext;
    this.#failNext = false;
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (fail) {
          reject(new FixtureFailure());
        } else {
          resolve(work());
        }
      }, this.delayMs);
    });
  }

  list(query: FixtureQuery): Promise<FixturePage> {
    return this.#wait(() => {
      const text = query.q.toLowerCase();
      const matching = this.#rows.filter(
        (row) =>
          (query.status === '' || row.status === query.status) &&
          (text === '' ||
            row.name.toLowerCase().includes(text) ||
            row.company.toLowerCase().includes(text) ||
            row.email.includes(text)),
      );
      // Keyset paging on id, as the API does: the cursor is the last id of the page before.
      const start =
        query.cursor === undefined
          ? 0
          : matching.findIndex((row) => row.id > (query.cursor ?? ''));
      const from = start === -1 ? matching.length : start;
      const items = matching.slice(from, from + query.limit);
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          last !== undefined && from + query.limit < matching.length
            ? last.id
            : null,
        total: matching.length,
      };
    });
  }

  add(row: Omit<DemoLead, 'id' | 'score'>): Promise<DemoLead> {
    return this.#wait(() => {
      const lead: DemoLead = {
        ...row,
        id: `demo-${String(this.#rows.length + 1000)}`,
        score: 50,
      };
      this.#rows = [...this.#rows, lead];
      return lead;
    });
  }

  remove(id: string): Promise<void> {
    return this.#wait(() => {
      this.#rows = this.#rows.filter((row) => row.id !== id);
    });
  }

  /** Puts the original rows back (no delay: a local reset). */
  reset(rows: readonly DemoLead[]): void {
    this.#rows = [...rows];
  }

  has(email: string): boolean {
    return this.#rows.some((row) => row.email === email.toLowerCase());
  }
}
