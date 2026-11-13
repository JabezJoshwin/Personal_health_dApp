export type HealthRecordPayload = {
  name: string;
  age: number;
  bloodGroup: string;
  vaccinationCount: number;
  vaccines: string[];
  testReports: string[];
  /**
   * Random salt for the on-chain commitment, as a decimal string. It lives
   * only inside the encrypted record, so the owner can prove again later.
   */
  zkSalt?: string;
};
