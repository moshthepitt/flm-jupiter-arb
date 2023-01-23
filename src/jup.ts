import { AnchorProvider, BN } from "@project-serum/anchor";
import JSBI from "jsbi";
import {
  AccountMeta,
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Jupiter } from "@jup-ag/core";
import { uniqWith } from "lodash";
import {
  setUp,
  getFlashLoanInstructions,
  loadCache,
  sleep,
  DEVNET,
  MAINNET,
  RPC_ENDPOINT,
  DEFAULT_KEYS_CACHE,
  DEFAULT_SLIPPAGE_BPS,
  SLEEP_TIME,
  LookupTableKeysCache,
} from "flash-loan-mastery-cli/build/main/out";

const getJupKeysCacheName = (mint1: PublicKey, mint2: PublicKey) => {
  const env = RPC_ENDPOINT.includes(DEVNET) ? DEVNET : MAINNET;
  return `${env}-jupKeyCache-${mint1.toBase58()}-${mint2.toBase58()}.json`;
};

export function arrayDeepEquals<T, U>(
  array1: Readonly<T[]>,
  array2: Readonly<U[]>,
  eq: (a: T, b: U) => boolean
): boolean {
  if (array1.length !== array2.length) {
    return false;
  }
  return array1.reduce((prev, current, index) => {
    const other = array2[index];
    if (other == null) {
      return false;
    }
    return prev && eq(current, other);
  }, true);
}

const instructionEquals = (
  ix1: TransactionInstruction,
  ix2: TransactionInstruction
) => {
  return (
    ix1.programId.equals(ix2.programId) &&
    arrayDeepEquals(
      ix1.keys,
      ix2.keys,
      (a, b) =>
        a.isSigner === b.isSigner &&
        a.isWritable === b.isWritable &&
        a.pubkey.equals(b.pubkey)
    ) &&
    arrayDeepEquals(
      Array.from(ix1.data),
      Array.from(ix2.data),
      (a, b) => a === b
    )
  );
};

async function sendTransactionV0WithLookupTable(
  provider: AnchorProvider,
  payer: Keypair,
  lookupTables: AddressLookupTableAccount[],
  instructions: TransactionInstruction[]
): Promise<string> {
  let blockhash = await provider.connection
    .getLatestBlockhash()
    .then((res) => res.blockhash);

  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);

  const tx = new VersionedTransaction(messageV0);
  tx.sign([payer]);
  return await provider.connection.sendTransaction(tx);
}

const getMintDecimals = async (connection: Connection, mint: PublicKey) => {
  const mint1ParsedAccount = await connection.getParsedAccountInfo(
    mint,
    "confirmed"
  );
  const mintAccountData = mint1ParsedAccount.value?.data;
  if (!mintAccountData) {
    throw new Error("Could not find mint account");
  }
  const mintDecimals = (mintAccountData as any).parsed.info.decimals as number;
  return mintDecimals;
};

export const jupiterSimpleArbWithCache = async (
  connection: Connection,
  wallet: Keypair,
  mint1: PublicKey,
  mint2: PublicKey,
  amount: number,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  computeUnitPriceMicroLamports: number | undefined = undefined
) => {
  const { provider } = setUp(connection, wallet);
  let lookupTableAccount: AddressLookupTableAccount | null = null;

  const keysCacheName = getJupKeysCacheName(mint1, mint2);
  const cachedKeys = loadCache<LookupTableKeysCache>(
    keysCacheName,
    DEFAULT_KEYS_CACHE
  );
  if (cachedKeys && cachedKeys.addressLookupTable) {
    const addressLookupTableKey = new PublicKey(cachedKeys.addressLookupTable);
    lookupTableAccount = await provider.connection
      .getAddressLookupTable(addressLookupTableKey)
      .then((res) => res.value);
  }

  const jupiter = await Jupiter.load({
    connection,
    cluster: "mainnet-beta",
    user: wallet,
    restrictIntermediateTokens: false, // We after absolute best price
    wrapUnwrapSOL: false,
  });

  const mintDecimals = await getMintDecimals(connection, mint1);
  const initialAmount = amount * 10 ** mintDecimals;

  const flashLoanResult = await getFlashLoanInstructions(
    connection,
    wallet,
    mint1,
    amount
  );
  const loanRepayAmount = flashLoanResult.repaymentAmount;

  while (true) {
    const _routeMap = jupiter.getRouteMap();
    const { routesInfos: buyRoutesInfos } = await jupiter.computeRoutes({
      inputMint: mint1,
      outputMint: mint2,
      amount: JSBI.BigInt(initialAmount),
      slippageBps,
      forceFetch: true,
    });
    const bestBuy = buyRoutesInfos[0];
    const buySideOutAmount = bestBuy?.outAmount || JSBI.BigInt(0);
    const { routesInfos: sellRoutesInfos } = await jupiter.computeRoutes({
      inputMint: mint2,
      outputMint: mint1,
      amount: buySideOutAmount,
      slippageBps,
      forceFetch: true,
    });
    const bestSell = sellRoutesInfos[0];
    const sellSideOutAmount = bestSell?.outAmount || JSBI.BigInt(0);

    if (
      new BN(JSBI.toNumber(sellSideOutAmount)).gt(loanRepayAmount) &&
      bestBuy &&
      bestSell
    ) {
      const buySide = await jupiter.exchange({
        routeInfo: bestBuy,
        computeUnitPriceMicroLamports,
        asLegacyTransaction: true,
      });
      const sellSide = await jupiter.exchange({
        routeInfo: bestSell,
        computeUnitPriceMicroLamports,
        asLegacyTransaction: true,
      });

      const buyTransaction = buySide.swapTransaction as Transaction;
      const sellTransaction = sellSide.swapTransaction as Transaction;
      const computeIxs: TransactionInstruction[] = [];

      const ixs: TransactionInstruction[] = [];
      const lookupTables = [
        ...buySide.addressLookupTableAccounts,
        ...sellSide.addressLookupTableAccounts,
      ];
      if (lookupTableAccount) {
        lookupTables.push(lookupTableAccount);
      }

      // setup flash loan
      if (flashLoanResult.setUpInstruction) {
        ixs.push(flashLoanResult.setUpInstruction);
      }
      // flash loan borrow
      ixs.push(flashLoanResult.borrow);
      // jupiter buy
      for (let index = 0; index < buyTransaction.instructions.length; index++) {
        const element = buyTransaction.instructions[index];
        if (element) {
          if (element.programId.equals(ComputeBudgetProgram.programId)) {
            computeIxs.push(element);
          } else {
            ixs.push(element);
          }
        }
      }
      // jupiter sell
      for (
        let index = 0;
        index < sellTransaction.instructions.length;
        index++
      ) {
        const element = sellTransaction.instructions[index];
        if (element) {
          if (element.programId.equals(ComputeBudgetProgram.programId)) {
            computeIxs.push(element);
          } else {
            ixs.push(element);
          }
        }
      }
      // repay flash loan
      ixs.push(flashLoanResult.repay);

      // deduplicate
      const uniqComputeIxs = uniqWith(computeIxs, instructionEquals);
      const uniqIxs = uniqWith(ixs, instructionEquals);
      const finalIxs = uniqComputeIxs.concat(uniqIxs);

      // send transaction
      try {
        const txId = await sendTransactionV0WithLookupTable(
          provider,
          wallet,
          lookupTables,
          finalIxs
        );
        console.log("Transaction signature", txId);
      } catch (err) {
        console.log("Transaction failed");
        console.log(err);
      }
    }
    sleep(SLEEP_TIME);
  }
};
