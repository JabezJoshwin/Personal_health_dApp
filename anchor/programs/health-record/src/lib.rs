use anchor_lang::prelude::*;

declare_id!("9zqRNZ6jg9wZKJQkvHJJdn9fc6NDScURh6DH4i4jL1Er");

/// Maximum UTF-8 bytes stored for IPFS CID (v0/v1 typical lengths fit).
pub const MAX_CID_LEN: usize = 128;

/// Length of the Poseidon commitment (a BN254 field element, big-endian).
pub const COMMITMENT_LEN: usize = 32;

#[program]
pub mod health_record {
    use super::*;

    /// Creates one record account per upload.
    ///
    /// `commitment` is Poseidon(vaccinationCount, salt), computed by the
    /// owner's client. The program stores it without interpreting it; a
    /// verifier later compares it with the commitment output of a
    /// zero-knowledge proof to check that the proof refers to this record.
    pub fn init_record(
        ctx: Context<InitRecord>,
        timestamp: i64,
        ipfs_cid: String,
        commitment: [u8; COMMITMENT_LEN],
    ) -> Result<()> {
        require!(ipfs_cid.len() <= MAX_CID_LEN, HealthRecordError::CidTooLong);
        let rec = &mut ctx.accounts.health_record;
        rec.owner = ctx.accounts.owner.key();
        rec.ipfs_cid = ipfs_cid;
        // Timestamp is provided by the client and used in the PDA seeds to ensure
        // a unique account per upload (avoid overwriting).
        rec.timestamp = timestamp;
        rec.commitment = commitment;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(timestamp: i64)]
pub struct InitRecord<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + HealthRecord::INIT_SPACE,
        seeds = [b"record", owner.key().as_ref(), &timestamp.to_le_bytes()],
        bump
    )]
    pub health_record: Account<'info, HealthRecord>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct HealthRecord {
    pub owner: Pubkey,
    pub ipfs_cid: String,
    pub timestamp: i64,
    pub commitment: [u8; COMMITMENT_LEN],
}

impl HealthRecord {
    /// owner + String (4-byte length + max bytes) + timestamp + commitment.
    /// The 8-byte account discriminator is added where the account is created.
    pub const INIT_SPACE: usize = 32 + (4 + MAX_CID_LEN) + 8 + COMMITMENT_LEN;
}

#[error_code]
pub enum HealthRecordError {
    #[msg("IPFS CID exceeds maximum length")]
    CidTooLong,
}
