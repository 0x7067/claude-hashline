function tokenize(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .split(/[^a-zA-Z0-9_$]+/u)
    .filter((t) => t.length > 0);
}

function ngrams(tokens: readonly string[], n: number): string[] {
  if (tokens.length < n) return [];
  const out: string[] = [];
  for (let i = 0; i <= tokens.length - n; i += 1) {
    out.push(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

export function tokenNgramOverlap(a: string, b: string, n = 5): number {
  const aN = new Set(ngrams(tokenize(a), n));
  const bN = new Set(ngrams(tokenize(b), n));
  if (aN.size === 0 || bN.size === 0) return 0;
  let inter = 0;
  for (const g of aN) if (bN.has(g)) inter += 1;
  const union = aN.size + bN.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function maxContiguousTokenOverlap(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  // dp on suffixes; O(n*m) — fine for small files in MVP
  const dp: number[] = new Array<number>(tb.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= ta.length; i += 1) {
    let prev = 0;
    for (let j = 1; j <= tb.length; j += 1) {
      const tmp = dp[j] ?? 0;
      if (ta[i - 1] === tb[j - 1]) {
        dp[j] = prev + 1;
        if ((dp[j] ?? 0) > best) best = dp[j] ?? 0;
      } else {
        dp[j] = 0;
      }
      prev = tmp;
    }
  }
  return best;
}

function extractComments(source: string): string[] {
  const comments: string[] = [];
  const block = source.matchAll(/\/\*[\s\S]*?\*\//g);
  for (const m of block) comments.push(m[0]);
  const line = source.matchAll(/\/\/[^\n]*/g);
  for (const m of line) comments.push(m[0]);
  return comments
    .map((c) => c.replace(/[/*]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((c) => c.length > 0);
}

export function commentOverlap(a: string, b: string): number {
  const ca = new Set(extractComments(a));
  const cb = new Set(extractComments(b));
  if (ca.size === 0 || cb.size === 0) return 0;
  let inter = 0;
  for (const c of ca) if (cb.has(c)) inter += 1;
  const denom = Math.max(ca.size, cb.size);
  return denom === 0 ? 0 : inter / denom;
}

export function identifierOverlap(a: string, b: string, ignore: ReadonlySet<string>): number {
  const ia = new Set(tokenize(a).filter((t) => !ignore.has(t)));
  const ib = new Set(tokenize(b).filter((t) => !ignore.has(t)));
  if (ia.size === 0 || ib.size === 0) return 0;
  let inter = 0;
  for (const t of ia) if (ib.has(t)) inter += 1;
  return inter / Math.max(ia.size, ib.size);
}

export interface FileSimilarityScores {
  ngramJaccard: number;
  maxContiguous: number;
  commentJaccard: number;
  identifierJaccard: number;
}

export function fileSimilarity(
  a: string,
  b: string,
  identifierIgnore: ReadonlySet<string> = new Set(),
): FileSimilarityScores {
  return {
    ngramJaccard: tokenNgramOverlap(a, b, 5),
    maxContiguous: maxContiguousTokenOverlap(a, b),
    commentJaccard: commentOverlap(a, b),
    identifierJaccard: identifierOverlap(a, b, identifierIgnore),
  };
}

export interface SimilarityFailureBreach {
  generatedFile: string;
  metric: string;
  score: number;
  threshold: number;
}

export function summarizeSimilarityFailure(breaches: readonly SimilarityFailureBreach[]): string {
  if (breaches.length === 0) return '';
  const byFile = new Map<string, SimilarityFailureBreach[]>();
  for (const b of breaches) {
    const list = byFile.get(b.generatedFile) ?? [];
    list.push(b);
    byFile.set(b.generatedFile, list);
  }
  const lines: string[] = [
    'Similarity gate breached. Rewrite the listed files using a structurally different approach:',
  ];
  for (const [file, items] of byFile) {
    const parts = items
      .map((i) => `${i.metric}=${i.score.toFixed(3)} (max ${i.threshold.toFixed(3)})`)
      .join(', ');
    lines.push(`  - ${file}: ${parts}`);
  }
  lines.push(
    'Guidance: change variable names, control-flow shape, helper decomposition, and comments. ' +
      'Do not paraphrase the original; re-derive the behavior from SPEC.yaml. Avoid reusing identifiers ' +
      'beyond the public API surface.',
  );
  return lines.join('\n');
}
