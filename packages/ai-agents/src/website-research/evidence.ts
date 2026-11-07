// Evidence checks for the WebsiteResearchAgent (task 09B, docs/decisions.md D-09B-04). These run
// in application code on every answer: the model's word that a page says something counts for
// nothing until its quote is found in the extract it cites.

// Typographic quotes and apostrophes, built from code points (no literal invisible characters).
const SMART_SINGLE = new RegExp(
  `[${String.fromCharCode(0x2018, 0x2019, 0x201b, 0x2032)}]`,
  'g',
);
const SMART_DOUBLE = new RegExp(
  `[${String.fromCharCode(0x201c, 0x201d, 0x201f, 0x2033)}]`,
  'g',
);
const DASHES = new RegExp(
  `[${String.fromCharCode(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212)}]`,
  'g',
);

/** For comparing text: NFKC, lower case, plain quotes and dashes, single spaces. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(SMART_SINGLE, "'")
    .replace(SMART_DOUBLE, '"')
    .replace(DASHES, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether the quote appears in the text (after normalization). Very short quotes don't count. */
export function quoteFound(quote: string, text: string): boolean {
  const needle = normalizeForMatch(quote);
  return needle.length >= 3 && normalizeForMatch(text).includes(needle);
}

const numbersOf = (text: string) =>
  (text.match(/\d[\d,.]*\d|\d/g) ?? []).map((number) =>
    number.replace(/[,.](?=\d{3}\b)/g, ''),
  );

const wordsOf = (text: string) =>
  normalizeForMatch(text).match(/[\p{L}\p{N}]{3,}/gu) ?? [];

/**
 * Whether the value draws on its quotes: every number in the value appears in them, and so does
 * at least one of its words. A real quote cited for an unrelated (or invented) value fails.
 */
export function valueSupported(
  value: string,
  quotes: readonly string[],
): boolean {
  const joined = normalizeForMatch(quotes.join(' '));
  const quoteNumbers = new Set(numbersOf(joined));
  if (!numbersOf(value).every((number) => quoteNumbers.has(number))) {
    return false;
  }
  const words = wordsOf(value);
  if (words.length === 0) {
    const plain = normalizeForMatch(value);
    return plain.length > 0 && joined.includes(plain);
  }
  return words.some((word) => joined.includes(word));
}

/** Whether the value is written out in one of its quotes. */
export function valueVerbatim(
  value: string,
  quotes: readonly string[],
): boolean {
  const plain = normalizeForMatch(value);
  return quotes.some((quote) => normalizeForMatch(quote).includes(plain));
}

/**
 * Page text that tries to instruct a model. A page may say anything; these patterns only flag
 * it for a person and keep facts quoted from it out of the verified list (D-09B-04). The model
 * has no tools and its answer has no policy fields, so the flag is defence in depth.
 */
export const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.!?\n]{0,60}\b(instructions?|rules|prompts?|guidelines)\b/i,
  /\b(system|developer)\s+(prompt|message|instructions?)\b/i,
  /\byou are now\b/i,
  /\bact as\b[^.!?\n]{0,40}\b(assistant|ai|model|agent)\b/i,
  /\b(call|invoke|execute)\b[^.!?\n]{0,30}\b(tool|function)\b/i,
  /\b(new|updated|additional)\s+instructions?\b/i,
  /<\/?\s*(system|assistant|developer|instructions?)\s*>/i,
  /\bmark\b[^.!?\n]{0,40}\bas\s+(verified|eligible|approved|qualified)\b/i,
  /\b(reveal|print|repeat)\b[^.!?\n]{0,30}\b(prompt|instructions)\b/i,
];

const sentencesOf = (text: string) =>
  (text.match(/[^.!?\n]+[.!?]?/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

/** The sentences of a text that look like instructions to a model. */
export function instructionLikeSentences(text: string): string[] {
  return sentencesOf(text).filter((sentence) =>
    INSTRUCTION_PATTERNS.some((pattern) => pattern.test(sentence)),
  );
}

/** Whether a quote overlaps one of the given suspicious sentences. */
export function overlapsAny(
  quote: string,
  sentences: readonly string[],
): boolean {
  const needle = normalizeForMatch(quote);
  return sentences.some((sentence) => {
    const hay = normalizeForMatch(sentence);
    return hay.includes(needle) || needle.includes(hay);
  });
}
