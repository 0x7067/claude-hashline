import { DEFAULT_THRESHOLDS } from './constants.js';
import type { PackageTraits, TierClassification } from './types.js';

export function classifyTier(traits: PackageTraits): TierClassification {
  const blocking: string[] = [];

  if (traits.hasNativeBindings) blocking.push('Has native bindings (.node / binding.gyp)');
  if (traits.hasInstallScripts) blocking.push('Has install/postinstall scripts');
  if (traits.usesChildProcess) blocking.push('Spawns child processes');

  if (blocking.length > 0) {
    return {
      tier: 'out_of_scope',
      recommendedMode: 'reject',
      proceedToBuild: false,
      blockingRisks: blocking,
      rationale:
        'Package uses APIs or install behaviors that are out of scope for the MVP clean-room pipeline.',
    };
  }

  const small =
    traits.fileCount <= DEFAULT_THRESHOLDS.tier1MaxFiles &&
    traits.unpackedKb <= DEFAULT_THRESHOLDS.tier1MaxUnpackedKb &&
    traits.runtimeDepCount <= DEFAULT_THRESHOLDS.tier1MaxRuntimeDeps;

  if (!traits.usesNetwork && small && traits.runtimeDepCount === 0 && traits.fileCount <= 5) {
    return {
      tier: 'tier_0',
      recommendedMode: 'smoke_test',
      proceedToBuild: true,
      blockingRisks: [],
      rationale: 'Tiny self-contained module suitable for smoke-test pipeline.',
    };
  }

  if (!traits.usesNetwork && small) {
    return {
      tier: 'tier_1',
      recommendedMode: 'standard',
      proceedToBuild: true,
      blockingRisks: [],
      rationale: 'Small utility package suitable for standard clean-room pipeline.',
    };
  }

  if (
    traits.usesNetwork &&
    traits.fileCount <= DEFAULT_THRESHOLDS.tier2NetworkMaxFiles &&
    traits.unpackedKb <= DEFAULT_THRESHOLDS.tier2NetworkMaxUnpackedKb &&
    traits.runtimeDepCount <= DEFAULT_THRESHOLDS.tier2NetworkMaxRuntimeDeps
  ) {
    return {
      tier: 'tier_2_network',
      recommendedMode: 'extended',
      proceedToBuild: true,
      blockingRisks: [],
      rationale:
        'Network-capable package within tier_2_network envelope; will be reimplemented using node:http/node:https with loopback-only test fixtures.',
    };
  }

  if (traits.usesNetwork) {
    return {
      tier: 'out_of_scope',
      recommendedMode: 'reject',
      proceedToBuild: false,
      blockingRisks: ['Network-using package exceeds tier_2_network size envelope'],
      rationale:
        'Network-capable package exceeds tier_2_network size/dep ceiling; outside MVP scope.',
    };
  }

  if (traits.fileCount <= 200 && traits.unpackedKb <= 2048 && traits.runtimeDepCount <= 10) {
    return {
      tier: 'tier_2',
      recommendedMode: 'extended',
      proceedToBuild: true,
      blockingRisks: [],
      rationale:
        'Mid-sized non-network package; routed through the layered Spec Agent (gather → synthesize → multi-judge audit).',
    };
  }

  return {
    tier: 'tier_3',
    recommendedMode: 'reject',
    proceedToBuild: false,
    blockingRisks: ['Package exceeds size/complexity thresholds for MVP'],
    rationale: 'Large or complex package outside MVP scope.',
  };
}
