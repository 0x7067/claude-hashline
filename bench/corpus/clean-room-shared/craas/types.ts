import { z } from 'zod';
import type { Brand } from '../types/index.js';
import { RUN_STATUS, TERMINAL_STATUSES, type RunStatus } from './constants.js';

export function isInProgress(status: RunStatus): boolean {
  return !TERMINAL_STATUSES.includes(status);
}

export type RunId = Brand<string, 'RunId'>;

export const runStatusEnum = z.enum(Object.values(RUN_STATUS) as [string, ...string[]]);

export const targetSchema = z.object({
  platform: z.enum(['npm', 'github']),
  packageName: z.string().optional(),
  owner: z.string().optional(),
  repo: z.string().optional(),
  rawInput: z.string(),
  resolvedVersion: z.string().optional(),
  tarballUrl: z.url().optional(),
  integrity: z.string().optional(),
});
export type Target = z.infer<typeof targetSchema>;

export const sourceSnapshotSchema = z.object({
  runId: z.string(),
  rootPath: z.string(),
  files: z.array(z.string()),
  byteSize: z.number().int().nonnegative(),
});
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;

export const packageTraitsSchema = z.object({
  fileCount: z.number().int().nonnegative(),
  unpackedKb: z.number().nonnegative(),
  runtimeDepCount: z.number().int().nonnegative(),
  hasNativeBindings: z.boolean(),
  hasInstallScripts: z.boolean(),
  hasPostinstall: z.boolean(),
  usesNetwork: z.boolean(),
  usesFs: z.boolean(),
  usesChildProcess: z.boolean(),
  hasTypes: z.boolean(),
  hasTests: z.boolean(),
});
export type PackageTraits = z.infer<typeof packageTraitsSchema>;

export const tierClassificationSchema = z.object({
  tier: z.enum(['tier_0', 'tier_1', 'tier_2', 'tier_2_network', 'tier_3', 'out_of_scope']),
  recommendedMode: z.enum(['smoke_test', 'standard', 'extended', 'reject']),
  proceedToBuild: z.boolean(),
  blockingRisks: z.array(z.string()),
  rationale: z.string(),
});
export type TierClassification = z.infer<typeof tierClassificationSchema>;

export const feasibilityReportSchema = z.object({
  traits: packageTraitsSchema,
  classification: tierClassificationSchema,
  generatedAt: z.string(),
});
export type FeasibilityReport = z.infer<typeof feasibilityReportSchema>;

export const apiSurfaceSchema = z.object({
  packageName: z.string(),
  moduleType: z.enum(['cjs', 'esm', 'dual']),
  defaultExport: z
    .object({
      kind: z.enum(['function', 'object', 'class', 'value']),
      arity: z.number().int().nonnegative().optional(),
    })
    .optional(),
  namedExports: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(['function', 'object', 'class', 'value', 'unknown']),
      arity: z.number().int().nonnegative().optional(),
    }),
  ),
  hasTypes: z.boolean(),
});
export type ApiSurface = z.infer<typeof apiSurfaceSchema>;

export const cleanRoomSpecSchema = z.object({
  rawSpecPath: z.string(),
  sanitizedSpecPath: z.string().optional(),
  generatedAt: z.string(),
  sanitized: z.boolean(),
});
export type CleanRoomSpec = z.infer<typeof cleanRoomSpecSchema>;

export const buildArtifactSchema = z.object({
  workspacePath: z.string(),
  files: z.array(z.string()),
  packageName: z.string(),
  iterations: z.number().int().nonnegative(),
});
export type BuildArtifact = z.infer<typeof buildArtifactSchema>;

export const verificationReportSchema = z.object({
  installPassed: z.boolean(),
  apiShapePassed: z.boolean(),
  contractTestsPassed: z.boolean(),
  differentialTestsApplicable: z.boolean(),
  differentialTestsPassed: z.boolean().optional(),
  details: z.string(),
});
export type VerificationReport = z.infer<typeof verificationReportSchema>;

export const similarityFindingSchema = z.object({
  generatedFile: z.string(),
  metric: z.enum(['file_score', 'token_overlap', 'comment_overlap', 'identifier_overlap']),
  score: z.number(),
  threshold: z.number(),
  passed: z.boolean(),
});
export type SimilarityFinding = z.infer<typeof similarityFindingSchema>;

export const similarityReportSchema = z.object({
  findings: z.array(similarityFindingSchema),
  passed: z.boolean(),
});
export type SimilarityReport = z.infer<typeof similarityReportSchema>;

export const evidenceRoleEnum = z.enum(['api-surface', 'behavioral', 'edge-cases', 'test-suite']);
export type EvidenceRole = z.infer<typeof evidenceRoleEnum>;

export const evidenceSchema = z.object({
  role: evidenceRoleEnum,
  body: z.string(),
  artifactPath: z.string().optional(),
  generatedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const judgeRoleEnum = z.enum([
  'mechanical',
  'structural-leakage',
  'content-contamination',
  'behavioral-completeness',
  'fidelity-validator',
]);
export type JudgeRole = z.infer<typeof judgeRoleEnum>;

export const auditFindingSeverityEnum = z.enum(['low', 'high', 'critical']);
export type AuditFindingSeverity = z.infer<typeof auditFindingSeverityEnum>;

export const auditFindingSchema = z.object({
  judge: judgeRoleEnum,
  category: z.string(),
  severity: auditFindingSeverityEnum,
  detail: z.string(),
  evidence: z.string().optional(),
});
export type AuditFinding = z.infer<typeof auditFindingSchema>;

export const judgeVerdictSchema = z.object({
  judge: judgeRoleEnum,
  passed: z.boolean(),
  findings: z.array(auditFindingSchema),
  ranAt: z.string(),
  durationMs: z.number().int().nonnegative(),
});
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;

export const auditOutcomeSchema = z.object({
  passed: z.boolean(),
  verdicts: z.array(judgeVerdictSchema),
  findings: z.array(auditFindingSchema),
  shippableSimilarityScore: z.number().min(0).max(1).optional(),
});
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

export const auditEventSchema = z.object({
  runId: z.string(),
  name: z.string(),
  occurredAt: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const createRunInputSchema = z.object({
  input: z.string().min(1).max(2000),
  outputPackageName: z.string().min(1).max(200).optional(),
});
export type CreateRunInput = z.infer<typeof createRunInputSchema>;

export const runSchema = z.object({
  id: z.string(),
  status: runStatusEnum,
  input: z.string(),
  outputPackageName: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  rejectionCode: z.string().optional(),
  rejectionMessage: z.string().optional(),
  artifactZipPath: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  currentIteration: z.number().int().nonnegative().optional(),
  progress: z
    .object({
      phase: z.string(),
      message: z.string().optional(),
      iteration: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type Run = z.infer<typeof runSchema>;

export const listRunsQuerySchema = z.object({
  status: z.union([runStatusEnum, z.literal('in_progress'), z.literal('terminal')]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;
