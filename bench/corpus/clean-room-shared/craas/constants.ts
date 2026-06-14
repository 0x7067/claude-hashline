export const RUN_STATUS = {
  CREATED: 'created',
  TARGET_RESOLVING: 'target_resolving',
  SOURCE_FETCHED: 'source_fetched',
  FEASIBILITY_COMPLETE: 'feasibility_complete',
  REJECTED_BY_FEASIBILITY: 'rejected_by_feasibility',
  API_EXTRACTED: 'api_extracted',
  RAW_SPEC_GENERATED: 'raw_spec_generated',
  SPEC_SANITIZED: 'spec_sanitized',
  SPEC_SANITIZATION_FAILED: 'spec_sanitization_failed',
  BUILD_GENERATED: 'build_generated',
  VERIFICATION_PASSED: 'verification_passed',
  VERIFICATION_FAILED: 'verification_failed',
  SIMILARITY_PASSED: 'similarity_passed',
  SIMILARITY_FAILED: 'similarity_failed',
  COMPLETE: 'complete',
  FAILED: 'failed',
} as const;

export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

export const TERMINAL_STATUSES: readonly RunStatus[] = [
  RUN_STATUS.COMPLETE,
  RUN_STATUS.REJECTED_BY_FEASIBILITY,
  RUN_STATUS.SPEC_SANITIZATION_FAILED,
  RUN_STATUS.FAILED,
];

export const STATUS_LABELS: Record<RunStatus, string> = {
  created: 'Run created',
  target_resolving: 'Resolving target package',
  source_fetched: 'Source snapshot fetched',
  feasibility_complete: 'Feasibility evaluated',
  rejected_by_feasibility: 'Rejected (out of scope for clean-room)',
  api_extracted: 'API surface extracted',
  raw_spec_generated: 'Behavioral spec drafted',
  spec_sanitized: 'Spec sanitized for builder hand-off',
  spec_sanitization_failed: 'Spec could not be sanitized',
  build_generated: 'Clean-room implementation built',
  verification_passed: 'Verification passed',
  verification_failed: 'Verification failed',
  similarity_passed: 'Similarity scan passed',
  similarity_failed: 'Similarity scan failed',
  complete: 'Complete',
  failed: 'Failed',
};

export const AUDIT_EVENT = {
  RUN_CREATED: 'RUN_CREATED',
  TARGET_RESOLVED: 'TARGET_RESOLVED',
  SOURCE_FETCHED: 'SOURCE_FETCHED',
  FEASIBILITY_EVALUATED: 'FEASIBILITY_EVALUATED',
  FEASIBILITY_REJECTED: 'FEASIBILITY_REJECTED',
  API_SURFACE_EXTRACTED: 'API_SURFACE_EXTRACTED',
  RAW_SPEC_GENERATED: 'RAW_SPEC_GENERATED',
  SPEC_SANITIZED: 'SPEC_SANITIZED',
  SPEC_SANITIZATION_FAILED: 'SPEC_SANITIZATION_FAILED',
  BUILDER_INVOKED: 'BUILDER_INVOKED',
  BUILD_GENERATED: 'BUILD_GENERATED',
  VERIFICATION_RAN: 'VERIFICATION_RAN',
  SIMILARITY_SCANNED: 'SIMILARITY_SCANNED',
  ARTIFACTS_PACKAGED: 'ARTIFACTS_PACKAGED',
  RUN_FAILED: 'RUN_FAILED',
  RUN_INTERRUPTED: 'RUN_INTERRUPTED',
} as const;

export type AuditEventName = (typeof AUDIT_EVENT)[keyof typeof AUDIT_EVENT];

export const DEFAULT_THRESHOLDS = {
  maxFileSimilarityScore: 0.35,
  maxContiguousTokenOverlap: 20,
  maxCommentOverlap: 0.1,
  maxIdentifierOverlap: 0.5,
  maxSpecSanitizationAttempts: 3,
  tier1MaxFiles: 30,
  tier1MaxUnpackedKb: 256,
  tier1MaxRuntimeDeps: 2,
  tier2NetworkMaxFiles: 500,
  tier2NetworkMaxUnpackedKb: 5120,
  tier2NetworkMaxRuntimeDeps: 10,
} as const;

// Trivial packages (tier_0) have a tiny vocabulary, so any correct clean-room
// implementation will inevitably overlap heavily with the original on tokens.
// Loosen the similarity gate at this tier to avoid impossible-to-pass thresholds.
export const SIMILARITY_THRESHOLDS_BY_TIER = {
  tier_0: {
    maxFileSimilarityScore: 0.7,
    maxContiguousTokenOverlap: 50,
    maxCommentOverlap: 0.1,
    maxIdentifierOverlap: 0.85,
  },
  tier_1: {
    maxFileSimilarityScore: 0.35,
    maxContiguousTokenOverlap: 20,
    maxCommentOverlap: 0.1,
    maxIdentifierOverlap: 0.5,
  },
  tier_2: {
    maxFileSimilarityScore: 0.35,
    maxContiguousTokenOverlap: 20,
    maxCommentOverlap: 0.1,
    maxIdentifierOverlap: 0.45,
  },
  tier_2_network: {
    maxFileSimilarityScore: 0.4,
    maxContiguousTokenOverlap: 25,
    maxCommentOverlap: 0.1,
    maxIdentifierOverlap: 0.6,
  },
  tier_3: {
    maxFileSimilarityScore: 0.35,
    maxContiguousTokenOverlap: 20,
    maxCommentOverlap: 0.1,
    maxIdentifierOverlap: 0.4,
  },
  out_of_scope: {
    maxFileSimilarityScore: 0.35,
    maxContiguousTokenOverlap: 20,
    maxCommentOverlap: 0.1,
    maxIdentifierOverlap: 0.4,
  },
} as const;

// Builder iteration budget by tier. Larger / more complex packages get more
// retry budget because the agent typically needs several feedback cycles to
// converge on a passing implementation; trivial packages converge fast and
// extra iterations just burn wall clock.
export const MAX_BUILD_ITERATIONS_BY_TIER = {
  tier_0: 3,
  tier_1: 5,
  tier_2: 8,
  tier_2_network: 8,
  tier_3: 10,
  out_of_scope: 1,
} as const;

export type PackageTier = keyof typeof MAX_BUILD_ITERATIONS_BY_TIER;

export function maxBuildIterationsForTier(tier: PackageTier): number {
  return MAX_BUILD_ITERATIONS_BY_TIER[tier];
}

export interface SimilarityThresholds {
  maxFileSimilarityScore: number;
  maxContiguousTokenOverlap: number;
  maxCommentOverlap: number;
  maxIdentifierOverlap: number;
}

export const RUN_REJECTION_CODE = {
  UNSUPPORTED_URL: 'UNSUPPORTED_URL',
  UNSUPPORTED_PLATFORM: 'UNSUPPORTED_PLATFORM',
  EMPTY_INPUT: 'EMPTY_INPUT',
  INVALID_PACKAGE_NAME: 'INVALID_PACKAGE_NAME',
  TIER_OUT_OF_SCOPE: 'TIER_OUT_OF_SCOPE',
  HAS_NATIVE_BINDINGS: 'HAS_NATIVE_BINDINGS',
  HAS_INSTALL_SCRIPTS: 'HAS_INSTALL_SCRIPTS',
  TOO_LARGE: 'TOO_LARGE',
  NETWORK_DEPENDENT: 'NETWORK_DEPENDENT',
  NO_PACKAGE_JSON: 'NO_PACKAGE_JSON',
  INTERRUPTED: 'INTERRUPTED',
  INTERNAL: 'INTERNAL',
} as const;

export type RunRejectionCode = (typeof RUN_REJECTION_CODE)[keyof typeof RUN_REJECTION_CODE];

export const DISCLAIMER = `This artifact was produced by an automated clean-room reimplementation pipeline.
It is provided AS-IS with no warranty and no legal-compliance guarantee. The user
is responsible for reviewing the output, performing their own legal review, and
deciding whether the artifact is fit for their intended use. The original package
referenced is the property of its respective owners.`;
