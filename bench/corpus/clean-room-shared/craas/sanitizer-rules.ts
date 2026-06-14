import {
  commentOverlap,
  maxContiguousTokenOverlap,
  tokenNgramOverlap,
} from './similarity-metrics.js';

export interface SanitizerFinding {
  rule: 'token_ngram' | 'contiguous_tokens' | 'comment_overlap' | 'path_leak';
  detail: string;
  score?: number;
}

export interface SanitizerInput {
  rawSpec: string;
  originalSources: readonly { path: string; content: string }[];
}

const SUSPICIOUS_PATH_RE =
  /(?:^|[\s'"`(])(?:\.\/|\.\.\/|\/)[A-Za-z0-9_./-]+\.(?:js|ts|mjs|cjs|jsx|tsx)\b/g;

export function detectLeakage(input: SanitizerInput): SanitizerFinding[] {
  const findings: SanitizerFinding[] = [];
  const { rawSpec, originalSources } = input;

  for (const src of originalSources) {
    const ngram = tokenNgramOverlap(rawSpec, src.content, 8);
    if (ngram > 0.15) {
      findings.push({
        rule: 'token_ngram',
        detail: `Spec shares ${(ngram * 100).toFixed(1)}% of 8-grams with ${src.path}`,
        score: ngram,
      });
    }
    const contiguous = maxContiguousTokenOverlap(rawSpec, src.content);
    if (contiguous > 12) {
      findings.push({
        rule: 'contiguous_tokens',
        detail: `Spec contains ${String(contiguous)}-token contiguous run from ${src.path}`,
        score: contiguous,
      });
    }
    const co = commentOverlap(rawSpec, src.content);
    if (co > 0.1) {
      findings.push({
        rule: 'comment_overlap',
        detail: `Spec shares ${(co * 100).toFixed(1)}% of comments with ${src.path}`,
        score: co,
      });
    }
  }

  const pathMatches = rawSpec.match(SUSPICIOUS_PATH_RE);
  if (pathMatches) {
    findings.push({
      rule: 'path_leak',
      detail: `Spec mentions internal source paths: ${[...new Set(pathMatches)].slice(0, 5).join(', ')}`,
    });
  }

  return findings;
}

export function isSpecSafe(findings: readonly SanitizerFinding[]): boolean {
  return findings.length === 0;
}
