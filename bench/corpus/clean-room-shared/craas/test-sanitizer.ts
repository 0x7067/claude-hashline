// Pure utilities for sanitizing a target package's own test source before
// running it against a clean-room reproduction. Goal: keep behavior intact
// (assertions, control flow, public-API references) while stripping signals
// that would leak originality into the builder workspace.
//
// Strategy:
//   1. Strip comments (block + line).
//   2. Replace identifiers NOT in the allow list (public API names + a small
//      set of test-runtime keywords) with positional placeholders `_aN`.
//   3. Rewrite require/import specifiers that point at internal paths to
//      reference the public entry only.

const TEST_RUNTIME_ALLOWLIST: readonly string[] = [
  'require',
  'module',
  'exports',
  'console',
  'process',
  'Buffer',
  'global',
  'globalThis',
  'undefined',
  'null',
  'true',
  'false',
  'test',
  'it',
  'describe',
  'expect',
  'assert',
  'before',
  'after',
  'beforeEach',
  'afterEach',
  'suite',
  'context',
  'String',
  'Number',
  'Boolean',
  'Array',
  'Object',
  'Symbol',
  'Map',
  'Set',
  'Date',
  'Math',
  'JSON',
  'Error',
  'TypeError',
  'RangeError',
  'Promise',
  'function',
  'const',
  'let',
  'var',
  'return',
  'if',
  'else',
  'for',
  'of',
  'in',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'throw',
  'try',
  'catch',
  'finally',
  'new',
  'this',
  'typeof',
  'instanceof',
  'void',
  'delete',
  'async',
  'await',
  'yield',
  'class',
  'extends',
  'super',
  'static',
  'export',
  'default',
  'import',
  'from',
  'as',
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// Match identifiers that are NOT preceded by `.` (property access) or by a
// word character (mid-token). This keeps `assert.strictEqual` and similar
// member-access chains intact while still mangling top-level identifiers.
const IDENTIFIER_RE = /(?<![.\w$])[A-Za-z_$][A-Za-z0-9_$]*/g;

export interface TestSanitizerOptions {
  publicApiNames: ReadonlySet<string>;
  // Specifier of the package's public entry — replaces relative imports.
  publicEntrySpecifier: string;
}

export interface TestSanitizerResult {
  sanitized: string;
  identifierMap: ReadonlyMap<string, string>;
}

export function sanitizeTargetTest(
  source: string,
  options: TestSanitizerOptions,
): TestSanitizerResult {
  const allow = new Set<string>([...TEST_RUNTIME_ALLOWLIST, ...options.publicApiNames]);
  let withoutComments = stripComments(source);
  // Rewrite relative require/import targets (e.g. '../src/internal') to the
  // public entry specifier — the reproduction only exposes that surface.
  withoutComments = withoutComments
    .replace(/(require\(\s*['"])(\.[^'"]+)(['"]\s*\))/g, `$1${options.publicEntrySpecifier}$3`)
    .replace(/(from\s*['"])(\.[^'"]+)(['"])/g, `$1${options.publicEntrySpecifier}$3`);

  const map = new Map<string, string>();
  let counter = 0;
  const mangle = (segment: string): string =>
    segment.replace(IDENTIFIER_RE, (id) => {
      if (allow.has(id)) return id;
      const existing = map.get(id);
      if (existing !== undefined) return existing;
      const placeholder = `_a${String(counter)}`;
      counter += 1;
      map.set(id, placeholder);
      return placeholder;
    });

  // Split into alternating non-string / string segments and mangle only the
  // non-string parts, so that rewritten require/import specifiers and string
  // literal content survive identifier replacement intact.
  const STRING_RE = /(['"`])(?:\\.|(?!\1)[^\\])*\1/g;
  let cursor = 0;
  const out: string[] = [];
  for (const m of withoutComments.matchAll(STRING_RE)) {
    const idx = m.index;
    out.push(mangle(withoutComments.slice(cursor, idx)));
    out.push(m[0]);
    cursor = idx + m[0].length;
  }
  out.push(mangle(withoutComments.slice(cursor)));
  return { sanitized: out.join(''), identifierMap: map };
}
