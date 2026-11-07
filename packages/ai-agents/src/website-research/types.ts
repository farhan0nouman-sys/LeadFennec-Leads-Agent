// What the WebsiteResearchAgent returns (task 09B, docs/decisions.md D-09B-04). Every verified
// fact traces to quotes found in dated extracts; nothing here decides eligibility or sending.

import type {
  ModelCostEvent,
  ModelProviderName,
} from '@lead-fennec-ai/integrations';
import {
  RESEARCH_REVIEW_REASONS,
  type ResearchConfidence,
  type ResearchReviewReason,
  type WebsiteResearchField,
} from '@lead-fennec-ai/shared';

export interface ResearchEvidence {
  readonly extractId: string;
  /** Found in the extract's text by application code. */
  readonly quote: string;
  readonly url: string;
  readonly retrievedAt: Date;
  readonly contentSha256: string;
}

/** "Verified" means: application code found every cited quote in its extract. */
export interface VerifiedFact {
  readonly field: WebsiteResearchField;
  readonly value: string;
  readonly evidence: readonly ResearchEvidence[];
  readonly confidence: ResearchConfidence;
}

/** An inference, never a fact: at most medium confidence. */
export interface ResearchHypothesis {
  readonly statement: string;
  readonly evidenceIds: readonly string[];
  readonly confidence: 'low' | 'medium';
}

/** The reasons, kept in @lead-fennec-ai/shared (they are stored with research, task 09C). */
export const REVIEW_REASONS = RESEARCH_REVIEW_REASONS;

export type ReviewReason = ResearchReviewReason;

/** Something a person should look at; never used as a fact. */
export interface ReviewItem {
  readonly reason: ReviewReason;
  readonly kind: 'fact' | 'hypothesis' | 'answer';
  readonly field: WebsiteResearchField | null;
  /** The claim as the model made it (untrusted text), or null. */
  readonly value: string | null;
  readonly extractIds: readonly string[];
}

export interface ResearchWarning {
  /** An extract contains text that tries to instruct a model. */
  readonly code: 'instructions_in_page';
  readonly extractId: string;
}

export interface ResearchUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Null when any attempt's cost is unknown. */
  readonly costMicroUsd: number | null;
  readonly events: readonly ModelCostEvent[];
}

export interface WebsiteResearchResult {
  /**
   * "completed": every claim checked out. "review_required": something was refused or flagged
   * (see reviewItems and warnings). "no_content": no extract had text; the model wasn't called.
   */
  readonly status: 'completed' | 'review_required' | 'no_content';
  readonly versions: {
    readonly prompt: string;
    readonly promptSha256: string;
    readonly schema: string;
    readonly provider: ModelProviderName;
    /** The model that answered (or the configured one, when none did). */
    readonly model: string;
  };
  readonly fields: readonly WebsiteResearchField[];
  readonly verifiedFacts: readonly VerifiedFact[];
  readonly hypotheses: readonly ResearchHypothesis[];
  /** Requested fields with no verified fact. */
  readonly unknownFields: readonly WebsiteResearchField[];
  readonly reviewItems: readonly ReviewItem[];
  /** The extracts the kept facts and hypotheses cite. */
  readonly evidenceIds: readonly string[];
  /** Set by application code from what checked out, not taken from the model. */
  readonly confidence: ResearchConfidence;
  readonly warnings: readonly ResearchWarning[];
  /** Page text the model reported ignoring, when found in its extract. */
  readonly ignoredInstructions: readonly {
    readonly extractId: string;
    readonly quote: string;
  }[];
  readonly usage: ResearchUsage;
  readonly generatedAt: Date;
}
