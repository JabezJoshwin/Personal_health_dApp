export type EncryptedPayload = {
  v: 1;
  alg: string;
  kdf: string;
  salt: string;
  iv: string;
  ciphertext: string;
};
