use anchor_lang::prelude::*;

declare_id!("9zqRNZ6jg9wZKJQkvHJJdn9fc6NDScURh6DH4i4jL1Er");

/// Maximum UTF-8 bytes stored for IPFS CID (v0/v1 typical lengths fit).
pub const MAX_CID_LEN: usize = 128;

#[program]
pub mod health_record {
    use super::*;

    pub fn init_record(ctx: Context<InitRecord>, timestamp: i64, ipfs_cid: String) -> Result<()> {
        require!(ipfs_cid.len() <= MAX_CID_LEN, HealthRecordError::CidTooLong);
        let rec = &mut ctx.accounts.health_record;
        rec.owner = ctx.accounts.owner.key();
        rec.ipfs_cid = ipfs_cid;
        // Timestamp is provided by the client and used in the PDA seeds to ensure
        // a unique account per upload (avoid overwriting).
        rec.timestamp = timestamp;
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
}

impl HealthRecord {
    /// discriminator + owner + String (4 + max bytes)
    pub const INIT_SPACE: usize = 32 + (4 + MAX_CID_LEN) + 8;
}

#[error_code]
pub enum HealthRecordError {
    #[msg("IPFS CID exceeds maximum length")]
    CidTooLong,
    #[msg("Only the owner may update this record")]
    Unauthorized,
}
