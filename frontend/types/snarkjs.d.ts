declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, string>,
      wasmFile: string | Uint8Array,
      zkeyFile: string | Uint8Array
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
    verify(
      verificationKey: unknown,
      publicSignals: string[],
      proof: unknown
    ): Promise<boolean>;
  };
}
