/**
 * Render the aggregated benchmark cells (R15) as a markdown comparison report,
 * stratified by difficulty class, with the format-vs-familiarity confound
 * caveat stated explicitly when the familiarity-control arm did not run (adv-02).
 */
import type { Cell } from "./score.ts";

export interface ReportMeta {
  formatterId: string;
  corpusPin: string;
  models: string[];
  ranFamiliarityArm: boolean;
}

export function renderReport(cells: Cell[], meta: ReportMeta): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const num = (x: number) => x.toFixed(1);
  const header = "| model | arm | difficulty | n | pass | edit-fail/task | search/task | out-tokens | turns | masked |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|";
  const rows = cells
    .slice()
    .sort((a, b) => a.model.localeCompare(b.model) || a.arm.localeCompare(b.arm) || String(a.difficulty).localeCompare(String(b.difficulty)))
    .map(c => `| ${c.model} | ${c.arm} | ${c.difficulty} | ${c.n} | ${pct(c.passRate)} | ${num(c.editFailureRate)} | ${num(c.meanSearchCalls)} | ${num(c.meanOutputTokens)} | ${num(c.meanTurns)} | ${c.maskedPasses} |`);

  const caveat = meta.ranFamiliarityArm
    ? "_Familiarity-control arm ran: the format effect is separated from tool-name unfamiliarity._"
    : "_Confound: the hashline and control arms differ on two variables at once — edit format AND Claude's training familiarity with the tool names. A control-favoring result cannot, without the familiarity-control arm, distinguish \"hash format is worse\" from \"Claude never saw these tool names\" (adv-02)._";

  return [
    "# Hashline benchmark report",
    "",
    `- Formatter (pinned): \`${meta.formatterId}\``,
    `- Corpus pin: \`${meta.corpusPin}\``,
    `- Models: ${meta.models.join(", ")}`,
    "",
    "`masked` = passes that only held after formatting (a raw whitespace/indent deviation the oracle hid; watch this for the hashline arm — adv-05).",
    "",
    header,
    sep,
    ...rows,
    "",
    caveat,
    "",
  ].join("\n");
}
