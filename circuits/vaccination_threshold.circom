pragma circom 2.0.0;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Statement proved:
//   "I know (vaccinationCount, salt) such that
//      commitment = Poseidon(vaccinationCount, salt)  and
//      valid      = 1 iff vaccinationCount >= threshold,
//    and this proof was made for the given challenge."
//
// Private inputs : vaccinationCount, salt
// Public inputs  : threshold, challenge
// Public outputs : valid, commitment
// Public signal order seen by a verifier: valid, commitment, threshold, challenge
template VaccinationThreshold(n) {
    signal input vaccinationCount;
    signal input salt;
    signal input threshold;
    signal input challenge;

    signal output valid;
    signal output commitment;

    // Range checks. LessThan is only sound when both operands fit in the
    // stated number of bits, so the bounds are enforced here rather than
    // assumed.
    component countBits = Num2Bits(n);
    countBits.in <== vaccinationCount;
    component thresholdBits = Num2Bits(n);
    thresholdBits.in <== threshold;

    // vaccinationCount >= threshold  <=>  threshold < vaccinationCount + 1.
    // vaccinationCount + 1 can reach 2^n, so the comparison uses n + 1 bits.
    component cmp = LessThan(n + 1);
    cmp.in[0] <== threshold;
    cmp.in[1] <== vaccinationCount + 1;
    valid <== cmp.out;

    // Salted commitment to the private value. The same value is stored
    // on-chain with the record, which ties a proof to that record.
    component hash = Poseidon(2);
    hash.inputs[0] <== vaccinationCount;
    hash.inputs[1] <== salt;
    commitment <== hash.out;

    // Bind the verifier's challenge into the proof. A public input that
    // appears in no constraint could be changed without invalidating the
    // proof, so it is used in one multiplication.
    signal challengeSquared;
    challengeSquared <== challenge * challenge;
}

component main { public [threshold, challenge] } = VaccinationThreshold(32);
