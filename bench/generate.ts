/**
 * Fixture generator CLI (R10). Walks a source corpus, applies reversible
 * mechanical mutations, and writes one fixture dir per mutation with the buggy
 * file, the expected (original) file, a task description, and a difficulty tag.
 *
 * Usage: bun run bench/generate.ts <corpus-dir> <out-dir> [--per-file N]
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { type Difficulty, mutationsFor } from "./mutate.ts";

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (SOURCE_EXT.has(path.extname(full))) out.push(full);
  }
  return out;
}

function corpusPin(corpusDir: string): string {
  // A vendored corpus declares its true provenance in CORPUS.md, since the
  // directory now lives inside this repo and `git rev-parse` here would
  // misleadingly report the hashline repo's HEAD, not the source's.
  try {
    const md = readFileSync(path.join(corpusDir, "CORPUS.md"), "utf8");
    const source = md.match(/\*\*Source:\*\*\s*`([^`]+)`/)?.[1];
    const commit = md.match(/\*\*Commit:\*\*\s*`([^`]+)`/)?.[1];
    if (source) return commit ? `${source}@${commit}` : source;
  } catch {
    // no CORPUS.md — fall through to git
  }
  try {
    const rev = Bun.spawnSync(["git", "-C", corpusDir, "rev-parse", "--short", "HEAD"]).stdout.toString().trim();
    return rev ? `${path.basename(corpusDir)}@${rev}` : path.basename(corpusDir);
  } catch {
    return path.basename(corpusDir);
  }
}

function main() {
  const [corpusDir, outDir] = Bun.argv.slice(2);
  if (!corpusDir || !outDir) {
    console.error("usage: bun run bench/generate.ts <corpus-dir> <out-dir> [--per-file N]");
    process.exit(2);
  }
  const perFileIdx = Bun.argv.indexOf("--per-file");
  const perFile = perFileIdx > -1 ? Number(Bun.argv[perFileIdx + 1]) : 2;

  mkdirSync(outDir, { recursive: true });
  const files = walk(corpusDir);
  let count = 0;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const muts = mutationsFor(source);
    // Prefer coverage of both difficulty classes.
    const picked: typeof muts = [];
    for (const d of ["simple", "hard-anchor"] as Difficulty[]) {
      const m = muts.find(x => x.difficulty === d);
      if (m) picked.push(m);
    }
    for (const m of muts) {
      if (picked.length >= perFile) break;
      if (!picked.includes(m)) picked.push(m);
    }

    for (const m of picked.slice(0, perFile)) {
      const id = `${count.toString().padStart(4, "0")}-${m.kind}-${m.difficulty}`;
      const dir = path.join(outDir, id);
      mkdirSync(dir, { recursive: true });
      const targetName = path.basename(file);
      writeFileSync(path.join(dir, targetName), m.buggy);
      writeFileSync(path.join(dir, `${targetName}.expected`), source);
      writeFileSync(path.join(dir, "task.md"), m.description);
      writeFileSync(
        path.join(dir, "meta.json"),
        JSON.stringify({ id, targetName, kind: m.kind, difficulty: m.difficulty, line: m.line, sourceFile: path.relative(corpusDir, file) }, null, 2),
      );
      count++;
    }
  }

  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ corpusPin: corpusPin(corpusDir), fixtures: count, generatedFrom: corpusDir }, null, 2));
  console.log(`Generated ${count} fixtures into ${outDir} (corpus ${corpusPin(corpusDir)})`);
}

main();
