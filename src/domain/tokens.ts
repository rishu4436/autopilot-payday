export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_DECIMALS = 9;
export const USDC_DECIMALS = 6;
export const SOLANA_X402_NETWORK = "solana";
export const CHAIN_KEY = "sol";

/** Protocol base fee per signature. This is not a market price. */
export const REFERENCE_SIGNATURE_FEE_LAMPORTS = 5_000n;

/**
 * Long-standing rent-exempt minimum for a 165-byte SPL token account.
 * Live mode overwrites this with getMinimumBalanceForRentExemption.
 */
export const REFERENCE_TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;
