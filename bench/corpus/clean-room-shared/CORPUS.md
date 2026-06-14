# Vendored benchmark corpus: clean-room `shared` package

A bounded, self-contained slice used to generate benchmark fixtures, vendored so
runs are reproducible (no dependence on a live, changing work tree).

- **Source:** `github:0x7067/clean-room` — `packages/shared/src`
- **Commit:** `90c8835`
- **License:** MIT, Copyright (c) 2026 Ravn (see source repo's `LICENSE`)
- **Selection:** all `*.ts` under `packages/shared/src` except `*.test.ts` / `*.spec.ts`.

The fixture generator (`bench/generate.ts`) mutates these files with reversible
mechanical bugs. Scoring should use this project's own formatter config
(`.prettierrc`, copied alongside) once the placeholder formatter is replaced
(see `bench/score.ts`).
