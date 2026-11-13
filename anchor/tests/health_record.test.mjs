import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  fundedKeypair,
  initRecordBuilder,
  programFor,
  recordPda,
  startValidator,
} from "./localnet.mjs";

const CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
const COMMITMENT = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

let validator;
let owner;
let program;

before(async () => {
  validator = await startValidator();
  owner = await fundedKeypair(validator.connection);
  program = programFor(validator.connection, owner);
});

after(async () => {
  await validator?.stop();
});

test("init_record stores owner, CID, timestamp and commitment", async () => {
  const timestamp = 1_800_000_000n;
  await initRecordBuilder(program, owner.publicKey, timestamp, CID, COMMITMENT).rpc();

  const rec = await program.account.healthRecord.fetch(recordPda(owner.publicKey, timestamp));
  assert.equal(rec.owner.toBase58(), owner.publicKey.toBase58());
  assert.equal(rec.ipfsCid, CID);
  assert.equal(rec.timestamp.toString(), timestamp.toString());
  assert.deepEqual(Uint8Array.from(rec.commitment), COMMITMENT);
});

test("the record account is exactly 212 bytes", async () => {
  const timestamp = 1_800_000_001n;
  await initRecordBuilder(program, owner.publicKey, timestamp, CID, COMMITMENT).rpc();
  const info = await validator.connection.getAccountInfo(recordPda(owner.publicKey, timestamp));
  // 8 discriminator + 32 owner + (4 + 128) CID + 8 timestamp + 32 commitment
  assert.equal(info.data.length, 212);
});

test("a CID of exactly 128 bytes is accepted", async () => {
  const timestamp = 1_800_000_002n;
  await initRecordBuilder(program, owner.publicKey, timestamp, "a".repeat(128), COMMITMENT).rpc();
  const rec = await program.account.healthRecord.fetch(recordPda(owner.publicKey, timestamp));
  assert.equal(rec.ipfsCid.length, 128);
});

test("a CID of 129 bytes is rejected with CidTooLong", async () => {
  const timestamp = 1_800_000_003n;
  await assert.rejects(
    () => initRecordBuilder(program, owner.publicKey, timestamp, "a".repeat(129), COMMITMENT).rpc(),
    (err) => err?.error?.errorCode?.code === "CidTooLong"
  );
});

test("the same owner and timestamp cannot create a second record", async () => {
  const timestamp = 1_800_000_004n;
  await initRecordBuilder(program, owner.publicKey, timestamp, CID, COMMITMENT).rpc();
  await assert.rejects(() =>
    initRecordBuilder(program, owner.publicKey, timestamp, CID, COMMITMENT).rpc()
  );
});

test("a record cannot be created for an owner who did not sign", async () => {
  const stranger = await fundedKeypair(validator.connection);
  const timestamp = 1_800_000_005n;
  // `program` signs as `owner`; naming `stranger` as the owner must fail.
  await assert.rejects(() =>
    initRecordBuilder(program, stranger.publicKey, timestamp, CID, COMMITMENT).rpc()
  );
});
