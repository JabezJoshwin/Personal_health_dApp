export type HealthRecordPayload = {
  name: string;
  age: number;
  bloodGroup: string;
  vaccinationCount: number;
  vaccines: string[];
  testReports: string[];
};

export type ProofApiResponse = {
  proof: unknown;
  publicSignals: string[];
  verified: boolean;
  note?: string;
  error?: string;
  message?: string;
};
