import { Connection, PublicKey } from "@solana/web3.js";
import { Command } from "commander";
import {
  RPC_ENDPOINT,
  MAX_DIE_RETRIES,
  confirmTransactionInitialTimeout,
  providerOptions,
  DIE_SLEEP_TIME,
  DEFAULT_SLIPPAGE_BPS,
  createCommonTokenAccounts,
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

const program = new Command();

program
  .command("create-token-accounts")
  .requiredOption("-k, --keypair <keypair>")
  .addHelpText(
    "beforeAll",
    "Create common token accounts based to reduce setup when running other commands"
  )
  .action(async ({ keypair }) => {
    await createCommonTokenAccounts(CONNECTION, loadKeypair(keypair));
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
