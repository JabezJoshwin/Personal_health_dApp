pragma circom 2.0.0;

include "circomlib/circuits/comparators.circom";

// Proves: vaccinationCount >= threshold (non-negative integers, bit-limited).
// Public: threshold, valid — verifier learns threshold and that claim holds (valid=1).
// Private: vaccinationCount — not revealed in the proof statement beyond the relation.
template VaccinationThreshold(n) {
    signal input vaccinationCount;
    signal input threshold;
    signal output valid;

    // LessThan: out = 1 iff in[0] < in[1]
    // Set in[0] = threshold, in[1] = vaccinationCount + 1
    // Then threshold < vaccinationCount + 1  <=>  vaccinationCount >= threshold
    signal countPlusOne;
    countPlusOne <== vaccinationCount + 1;

    component cmp = LessThan(n);
    cmp.in[0] <== threshold;
    cmp.in[1] <== countPlusOne;

    valid <== cmp.out;
}

// Only *inputs* may appear in `public [...]`; `valid` is a public *output* automatically.
component main { public [threshold] } = VaccinationThreshold(32);
