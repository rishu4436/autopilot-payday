import { SOLANA_MAINNET_GENESIS_HASH } from "../network";
// TEST ONLY: synthetic Solana state, unfunded deterministic wallet, no network.
import { Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, TransactionMessage, VersionedTransaction, type AccountInfo, type TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { inspectTreasuryTransaction, validateTreasurySimulation, type AccountSnapshot, type TreasuryContext, type TreasuryProposal, type ReviewedRoute } from "../treasury-guard";
import { RAYDIUM_CPMM } from "../raydium-cpmm";
import { USDC_MINT, WSOL_MINT } from "../../domain/tokens";

export const TEST_TREASURY = Keypair.fromSeed(new Uint8Array(32).fill(230));
const RENT = 2039280n;
type Account = { lamports: bigint; mint?: string; authority?: string; amount?: bigint; executable?: boolean; data?: Uint8Array; programOwner?: string };
type Run = { before: Map<string, Account | null>; after: Map<string, Account | null>; inner: { index: number; instructions: TransactionInstruction[]; parsed: unknown[] }[]; logs: string[] };
export class TreasuryTestBank {
  accounts = new Map<string, Account | null>();
  transactions = new Map<string, { tx: VersionedTransaction; run: Run; err: unknown; slot: number }>();
  blockhashes = new Set<string>(); slot = 100; sends = 0;
  outcome: "success" | "timeout-landed" | "timeout-absent" | "failed" = "success";
  constructor(readonly owner = TEST_TREASURY.publicKey.toBase58()) {
    for (const p of [TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, SystemProgram.programId, ComputeBudgetProgram.programId, new PublicKey(RAYDIUM_CPMM)]) this.accounts.set(p.toBase58(), { lamports: 1n, executable: true });
    this.accounts.set(USDC_MINT, { lamports: RENT, data: this.mintData(6), programOwner: TOKEN_PROGRAM_ID.toBase58() });
    this.accounts.set(WSOL_MINT, { lamports: RENT, data: this.mintData(9), programOwner: TOKEN_PROGRAM_ID.toBase58() });
    this.registerWallet(owner, 150_000_000n, true); this.accounts.get(owner)!.lamports = 1_000_000_000n;
  }
  private mintData(decimals: number) { const bytes = Buffer.alloc(82); bytes[44] = decimals; bytes[45] = 1; return bytes; }
  registerWallet(address: string, usdc = 0n, withAta = true) {
    this.accounts.set(address, { lamports: 1n });
    const ata = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(address)).toBase58();
    this.accounts.set(ata, withAta ? { lamports: RENT, mint: USDC_MINT, authority: address, amount: usdc } : null);
  }
  private model(address: string, state = this.accounts): Account | null { return state.has(address) ? state.get(address)! : { lamports: 1n }; }
  info(address: string, state = this.accounts): AccountInfo<Buffer> | null {
    const a = this.model(address, state); if (!a) return null;
    let data = Buffer.from(a.data ?? []);
    if (a.mint) {
      data = Buffer.alloc(165); new PublicKey(a.mint).toBuffer().copy(data); new PublicKey(a.authority!).toBuffer().copy(data, 32); data.writeBigUInt64LE(a.amount ?? 0n, 64); data[108] = 1;
      if (a.mint === WSOL_MINT) { data.writeUInt32LE(1, 109); data.writeBigUInt64LE(RENT, 113); }
    }
    return { data, executable: a.executable ?? false, owner: new PublicKey(a.programOwner ?? (a.mint ? TOKEN_PROGRAM_ID : SystemProgram.programId)), lamports: Number(a.lamports), rentEpoch: 0 };
  }
  private wireAccount(address: string, state = this.accounts) {
    const info = this.info(address, state); return info ? { ...info, owner: info.owner.toBase58(), data: [info.data.toString("base64"), "base64"] } : null;
  }
  latest() { const blockhash = Keypair.generate().publicKey.toBase58(); this.blockhashes.add(blockhash); return { blockhash, lastValidBlockHeight: 1000 }; }
  private snapshots(keys: PublicKey[], state: Map<string, Account | null>): Map<string, AccountSnapshot> {
    return new Map(keys.map((key) => {
      const address = key.toBase58(), a = this.model(address, state);
      return [address, a ? { address, exists: true, lamports: a.lamports, mint: a.mint, authority: a.authority, amount: a.amount, executable: a.executable } : { address, exists: false, lamports: 0n }];
    }));
  }
  inspect = async (_rpc: unknown, base64: string, p: TreasuryProposal, recipients: Set<string>, reviewedRoutes: readonly ReviewedRoute[] = []) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
    const before: TreasuryContext = { genesisHash: SOLANA_MAINNET_GENESIS_HASH, observedAt: Date.now(), accounts: this.snapshots(tx.message.staticAccountKeys, this.accounts), allowlistedRecipients: recipients, networkFeeLamports: 5000n, rentPerAccountLamports: RENT, blockHeight: 50, reviewedRoutes };
    const manifest = inspectTreasuryTransaction(base64, p, before), run = this.run(tx);
    const simulation = { err: null, logs: run.logs, after: this.snapshots(tx.message.staticAccountKeys, run.after), innerInstructions: run.inner.flatMap((group) => group.instructions) };
    validateTreasurySimulation(manifest, before, simulation);
    return { manifest, validation: { before, simulation }, snapshotSlot: this.slot, simulationSlot: this.slot };
  };
  private run(tx: VersionedTransaction): Run {
    const before = structuredClone(this.accounts), after = structuredClone(this.accounts), inner: Run["inner"] = [], logs: string[] = [];
    const payer = tx.message.staticAccountKeys[0]!.toBase58(); after.get(payer)!.lamports -= 5000n;
    const moveTokens = (source: string, target: string, amount: bigint) => {
      const from = after.get(source), to = after.get(target);
      if (!from?.mint || !to?.mint || from.mint !== to.mint || (from.amount ?? 0n) < amount) throw new Error("Synthetic bank token transfer rejected");
      from.amount! -= amount; to.amount! += amount;
      if (from.mint === WSOL_MINT) { from.lamports -= amount; to.lamports += amount; }
    };
    TransactionMessage.decompile(tx.message).instructions.forEach((ix, index) => {
      logs.push(`Program ${ix.programId} invoke [1]`);
      if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        const target = ix.keys[1]!.pubkey.toBase58(), recipient = ix.keys[2]!.pubkey.toBase58(), mint = ix.keys[3]!.pubkey.toBase58();
        if (!after.get(target)) {
          after.get(payer)!.lamports -= RENT; after.set(target, { lamports: RENT, mint, authority: recipient, amount: 0n });
          const create = SystemProgram.createAccount({ fromPubkey: new PublicKey(payer), newAccountPubkey: new PublicKey(target), lamports: Number(RENT), space: 165, programId: TOKEN_PROGRAM_ID });
          const init = new Uint8Array(33); init[0] = 18; init.set(new PublicKey(recipient).toBytes(), 1);
          const ctor = ix.constructor as typeof import("@solana/web3.js").TransactionInstruction;
          const size = new ctor({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: new PublicKey(mint), isSigner: false, isWritable: false }], data: Buffer.from([21, 7, 0]) });
          const immutable = new ctor({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: new PublicKey(target), isSigner: false, isWritable: true }], data: Buffer.from([22]) });
          const initialize = new ctor({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: new PublicKey(target), isSigner: false, isWritable: true }, { pubkey: new PublicKey(mint), isSigner: false, isWritable: false }], data: Buffer.from(init) });
          inner.push({ index, instructions: [size, create, immutable, initialize], parsed: [{ program: "spl-token", programId: TOKEN_PROGRAM_ID.toBase58(), parsed: { type: "getAccountDataSize", info: { mint, extensionTypes: ["immutableOwner"] } } }, { program: "system", programId: SystemProgram.programId.toBase58(), parsed: { type: "createAccount", info: { source: payer, newAccount: target, lamports: Number(RENT), space: 165, owner: TOKEN_PROGRAM_ID.toBase58() } } }, { program: "spl-token", programId: TOKEN_PROGRAM_ID.toBase58(), parsed: { type: "initializeImmutableOwner", info: { account: target } } }, { program: "spl-token", programId: TOKEN_PROGRAM_ID.toBase58(), parsed: { type: "initializeAccount3", info: { account: target, mint, owner: recipient } } }] });
          logs.push(`Program ${SystemProgram.programId} invoke [2]`, `Program ${TOKEN_PROGRAM_ID} invoke [2]`);
        }
      } else if (ix.programId.equals(SystemProgram.programId)) {
        const amount = ix.data.readBigUInt64LE(4); after.get(ix.keys[0]!.pubkey.toBase58())!.lamports -= amount; after.get(ix.keys[1]!.pubkey.toBase58())!.lamports += amount;
      } else if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
        if (ix.data[0] === 12) moveTokens(ix.keys[0]!.pubkey.toBase58(), ix.keys[2]!.pubkey.toBase58(), ix.data.readBigUInt64LE(1));
        else if (ix.data[0] === 17) { const account = after.get(ix.keys[0]!.pubkey.toBase58())!; account.amount = account.lamports - RENT; }
        else if (ix.data[0] === 9) { const account = after.get(ix.keys[0]!.pubkey.toBase58())!; if (account.amount) throw new Error("Nonempty synthetic close"); after.get(ix.keys[1]!.pubkey.toBase58())!.lamports += account.lamports; after.set(ix.keys[0]!.pubkey.toBase58(), null); }
        else throw new Error("Unsupported synthetic token instruction");
      } else if (ix.programId.toBase58() === RAYDIUM_CPMM) {
        const amount = ix.data.readBigUInt64LE(8), output = ix.data.readBigUInt64LE(16);
        const inputIx = createTransferCheckedInstruction(ix.keys[4]!.pubkey, new PublicKey(WSOL_MINT), ix.keys[6]!.pubkey, ix.keys[0]!.pubkey, amount, 9);
        const outputIx = createTransferCheckedInstruction(ix.keys[7]!.pubkey, new PublicKey(USDC_MINT), ix.keys[5]!.pubkey, ix.keys[1]!.pubkey, output, 6);
        moveTokens(ix.keys[4]!.pubkey.toBase58(), ix.keys[6]!.pubkey.toBase58(), amount); moveTokens(ix.keys[7]!.pubkey.toBase58(), ix.keys[5]!.pubkey.toBase58(), output);
        const parsed = [inputIx, outputIx].map((transfer) => ({ program: "spl-token", programId: TOKEN_PROGRAM_ID.toBase58(), parsed: { type: "transferChecked", info: { source: transfer.keys[0]!.pubkey.toBase58(), mint: transfer.keys[1]!.pubkey.toBase58(), destination: transfer.keys[2]!.pubkey.toBase58(), authority: transfer.keys[3]!.pubkey.toBase58(), tokenAmount: { amount: transfer.data.readBigUInt64LE(1).toString(), decimals: transfer.data[9], uiAmount: null } } } }));
        inner.push({ index, instructions: [inputIx, outputIx], parsed }); logs.push(`Program ${TOKEN_PROGRAM_ID} invoke [2]`);
      } else if (!ix.programId.equals(ComputeBudgetProgram.programId)) throw new Error("Unknown synthetic program");
    });
    return { before, after, inner, logs };
  }
  send(base64: string): string {
    this.sends++;
    const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64")), bytes = tx.message.serialize();
    if (tx.message.header.numRequiredSignatures !== 1 || tx.message.staticAccountKeys[0]!.toBase58() !== this.owner || !nacl.sign.detached.verify(bytes, tx.signatures[0]!, new PublicKey(this.owner).toBytes())) throw new Error("Synthetic wallet signature is invalid");
    if (this.outcome === "timeout-absent") throw new Error("Synthetic transport timeout");
    const signature = bs58.encode(tx.signatures[0]!), run = this.run(tx);
    const err = this.outcome === "failed" ? { InstructionError: [1, "Custom"] } : null;
    if (err) { run.after = structuredClone(run.before); run.after.get(this.owner)!.lamports -= 5000n; }
    this.accounts = run.after; this.transactions.set(signature, { tx, run, err, slot: ++this.slot });
    if (this.outcome === "timeout-landed") throw new Error("Synthetic response lost after landing");
    return signature;
  }
  chain(signature: string) {
    const entry = this.transactions.get(signature); if (!entry) return null;
    const { tx, run, err, slot } = entry, keys = tx.message.staticAccountKeys;
    const tokenBalances = (state: Map<string, Account | null>) => keys.flatMap((key, accountIndex) => {
      const account = state.get(key.toBase58()); return account?.mint ? [{ accountIndex, mint: account.mint, owner: account.authority, programId: TOKEN_PROGRAM_ID.toBase58(), uiTokenAmount: { amount: account.amount!.toString(), decimals: account.mint === USDC_MINT ? 6 : 9, uiAmount: null, uiAmountString: "0" } }] : [];
    });
    return { slot, blockTime: Math.floor(Date.now() / 1000), version: tx.message.version, transaction: { signatures: tx.signatures.map((s) => bs58.encode(s)), message: tx.message }, meta: { err, fee: 5000, logMessages: run.logs, preBalances: keys.map((key) => Number(this.model(key.toBase58(), run.before)?.lamports ?? 0n)), postBalances: keys.map((key) => Number(this.model(key.toBase58(), run.after)?.lamports ?? 0n)), preTokenBalances: tokenBalances(run.before), postTokenBalances: tokenBalances(run.after), innerInstructions: run.inner.map((group) => ({ index: group.index, instructions: group.instructions.map((ix) => ({ programIdIndex: keys.findIndex((key) => key.equals(ix.programId)), accounts: ix.keys.map((meta) => keys.findIndex((key) => key.equals(meta.pubkey))), data: bs58.encode(ix.data) })) })), loadedAddresses: { readonly: [], writable: [] } } };
  }
  rpc = {
    getGenesisHash: async () => SOLANA_MAINNET_GENESIS_HASH,
    getLatestBlockhash: async () => this.latest(), getBlockHeight: async () => 50,
    getBlockTime: async () => Math.floor(Date.now() / 1000),
    isBlockhashValid: async () => ({ context: { slot: this.slot }, value: true }),
    getFeeForMessage: async () => ({ context: { slot: this.slot }, value: 5000 }), getMinimumBalanceForRentExemption: async () => Number(RENT),
    getAccountInfo: async (key: PublicKey) => this.info(key.toBase58()),
    getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map((key) => this.info(key.toBase58())),
    getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) => ({ context: { slot: this.slot }, value: keys.map((key) => this.info(key.toBase58())) }),
    simulateTransaction: async (tx: VersionedTransaction, options: { accounts?: { addresses: string[] } }) => {
      const run = this.run(tx); return { context: { slot: this.slot }, value: { err: null, logs: run.logs, accounts: options.accounts!.addresses.map((key) => this.wireAccount(key, run.after)), innerInstructions: run.inner.map((group) => ({ index: group.index, instructions: group.parsed })) } };
    },
    sendRawTransaction: async (bytes: Uint8Array) => this.send(Buffer.from(bytes).toString("base64")),
    getSignatureStatuses: async (signatures: string[]) => ({ context: { slot: this.slot }, value: signatures.map((signature) => { const record = this.transactions.get(signature); return record ? { slot: record.slot, confirmations: null, confirmationStatus: "finalized", err: record.err } : null; }) }),
    getTransaction: async (signature: string) => this.chain(signature),
  };
  async rpcRequest(method: string, params: unknown[]): Promise<unknown> {
    const keys = (params[0] as string[] | undefined) ?? [];
    switch (method) {
      case "getGenesisHash": return this.rpc.getGenesisHash();
      case "getLatestBlockhash": return { context: { slot: this.slot }, value: this.latest() };
      case "getBlockHeight": return 50;
      case "getSlot": return this.slot;
      case "getBlockTime": return this.rpc.getBlockTime();
      case "getMinimumBalanceForRentExemption": return Number(RENT);
      case "getFeeForMessage": return { context: { slot: this.slot }, value: 5000 };
      case "isBlockhashValid": return { context: { slot: this.slot }, value: this.blockhashes.has(String(params[0])) };
      case "getBalance": return { context: { slot: this.slot }, value: Number(this.model(String(params[0]))?.lamports ?? 0n) };
      case "getAccountInfo": return { context: { slot: this.slot }, value: this.wireAccount(String(params[0])) };
      case "getMultipleAccounts": return { context: { slot: this.slot }, value: keys.map((key) => this.wireAccount(key)) };
      case "simulateTransaction": return this.rpc.simulateTransaction(VersionedTransaction.deserialize(Buffer.from(String(params[0]), "base64")), params[1] as { accounts: { addresses: string[] } });
      case "sendTransaction": return this.send(String(params[0]));
      case "getSignatureStatuses": return this.rpc.getSignatureStatuses(keys);
      case "getTransaction": {
        const tx = this.chain(String(params[0])); if (!tx) return null;
        const message = tx.transaction.message, accountKeys = message.staticAccountKeys;
        return { ...tx, transaction: { ...tx.transaction, message: { header: message.header, accountKeys: accountKeys.map((key) => key.toBase58()), recentBlockhash: message.recentBlockhash, addressTableLookups: message.version === 0 ? [] : undefined, instructions: TransactionMessage.decompile(message).instructions.map((ix) => ({ programIdIndex: accountKeys.findIndex((key) => key.equals(ix.programId)), accounts: ix.keys.map((meta) => accountKeys.findIndex((key) => key.equals(meta.pubkey))), data: bs58.encode(ix.data) })) } } };
      }
      default: throw new Error(`Unsupported synthetic RPC method: ${method}`);
    }
  }
}
