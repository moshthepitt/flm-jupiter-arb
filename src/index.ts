import { Connection, PublicKey } from "@solana/web3.js";
import { Command } from "commander";
import {
  RPC_ENDPOINT,
  MAX_DIE_RETRIES,
  confirmTransactionInitialTimeout,
  providerOptions,
  DIE_SLEEP_TIME,
  DEFAULT_SLIPPAGE_BPS,
  createTokenAccounts,
  loadKeypair,
  sleep,
  createExampleFlashLoanAddressLookupTableFromCache,
  seedExampleFlashLoanKeys,
} from "flash-loan-mastery-cli/build/main/out";
import { jupiterSimpleArbWithCache } from "./jup";

const CONNECTION = new Connection(RPC_ENDPOINT, {
  commitment: providerOptions.commitment,
  confirmTransactionInitialTimeout,
});

const COMMON_TOKEN_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", // RAY
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", // stSOL
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", // mSOL
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", // ETH (Wormhole)
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
]);

const program = new Command();

program
  .command("create-token-accounts")
  .requiredOption("-k, --keypair <keypair>")
  .option("-o, --owner <PublicKey>", "The desired owner of the new token accounts")
  .addHelpText(
    "beforeAll",
    "Create common token accounts based to reduce setup when running other commands"
  )
  .action(async ({ keypair, owner }) => {
    const targetOwner = owner == null ? undefined : new PublicKey(owner);
    await createTokenAccounts(CONNECTION, loadKeypair(keypair), COMMON_TOKEN_MINTS, targetOwner);
  });

program
  .command("seed-flash-loan-lookup-table")
  .requiredOption("-k, --keypair <keypair>")
  .requiredOption("-tm, --token-mint <PublicKey>")
  .requiredOption("-a, --amount <number>", "The amount")
  .addHelpText(
    "beforeAll",
    "Create a cache of accounts used for flash loan transactions"
  )
  .action(async ({ keypair, tokenMint, amount }) => {
    let count = 0;
    while (count < MAX_DIE_RETRIES) {
      count += 1;
      try {
        await seedExampleFlashLoanKeys(
          CONNECTION,
          loadKeypair(keypair),
          new PublicKey(tokenMint),
          Number(amount)
        );
        break;
      } catch (err) {
        console.log("retry seed-flash-loan-lookup-table");
        if (count === MAX_DIE_RETRIES) {
          throw err;
        }
        sleep(DIE_SLEEP_TIME * MAX_DIE_RETRIES);
      }
    }
  });

program
  .command("create-flash-loan-lookup-table-from-cache")
  .requiredOption("-k, --keypair <keypair>")
  .requiredOption("-tm, --token-mint <PublicKey>")
  .addHelpText(
    "beforeAll",
    "Create an address lookup table from a cache of accounts used for the flash loans"
  )
  .action(async ({ keypair, tokenMint }) => {
    let count = 0;
    while (count < MAX_DIE_RETRIES) {
      count += 1;
      try {
        await createExampleFlashLoanAddressLookupTableFromCache(
          CONNECTION,
          loadKeypair(keypair),
          new PublicKey(tokenMint)
        );
        break;
      } catch (err) {
        console.log("retry create-flash-loan-lookup-table-from-cache");
        if (count === MAX_DIE_RETRIES) {
          throw err;
        }
        sleep(DIE_SLEEP_TIME * MAX_DIE_RETRIES);
      }
    }
  });

program
  .command("simple-jupiter-arb")
  .requiredOption("-k, --keypair <keypair>")
  .requiredOption("-m1, --token-mint1 <PublicKey>")
  .requiredOption("-m2, --token-mint2 <PublicKey>")
  .requiredOption("-a, --amount <number>", "The amount")
  .option("-s, --slippageBps <number>", "The max slippage Bps")
  .option(
    "-c, --computeUnitPriceMicroLamports <number>",
    "The compute unit price micro lamports"
  )
  .addHelpText("beforeAll", "Perform a simple cached arb using Jupiter")
  .action(
    async ({
      keypair,
      tokenMint1,
      tokenMint2,
      amount,
      slippageBps,
      computeUnitPriceMicroLamports,
    }) => {
      let count = 0;
      while (count < MAX_DIE_RETRIES) {
        count += 1;
        try {
          await jupiterSimpleArbWithCache(
            CONNECTION,
            loadKeypair(keypair),
            new PublicKey(tokenMint1),
            new PublicKey(tokenMint2),
            Number(amount),
            slippageBps == null ? DEFAULT_SLIPPAGE_BPS : Number(slippageBps),
            computeUnitPriceMicroLamports == null
              ? undefined
              : Number(computeUnitPriceMicroLamports)
          );
        } catch (err) {
          console.log("retry cached-jupiter-arb");
          if (count === MAX_DIE_RETRIES) {
            throw err;
          }
          sleep(DIE_SLEEP_TIME * MAX_DIE_RETRIES);
        }
      }
    }
  );

program.parse();
