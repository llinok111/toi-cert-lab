/**
 * In-repo baseline (G1): the fixed-step scanner a typical engine would ship.
 * It samples at dt and returns the first sampled overlap; it is an UPPER bound
 * only, and it misses any collision that happens between two samples.
 */
export { fixedStepScan as naiveScan } from '../src/core.mjs';
export const BASELINE_DT = 1 / 60;
