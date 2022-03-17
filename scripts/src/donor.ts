import { AccountLayout, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import BN = require("bn.js");
import {
  EscrowLayout,
  ESCROW_ACCOUNT_DATA_LAYOUT,
  getKeypair,
  getProgramId,
  getPublicKey,
  getTerms,
  getTokenBalance,
  logError,
  writePublicKey,
} from "./utils";

const donor = async () => {
  const escrowProgramId = getProgramId();
  const terms = getTerms();

  const donorXTokenAccountPubkey = getPublicKey("donor_x");
  const donorYTokenAccountPubkey = getPublicKey("donor_y");
  const XTokenMintPubkey = getPublicKey("mint_x");
  const donorKeypair = getKeypair("donor");

  const tempXTokenAccountKeypair = new Keypair();
  const connection = new Connection("http://localhost:8899", "confirmed");
  const createTempTokenAccountIx = SystemProgram.createAccount({
    programId: TOKEN_PROGRAM_ID,
    space: AccountLayout.span,
    lamports: await connection.getMinimumBalanceForRentExemption(
      AccountLayout.span
    ),
    fromPubkey: donorKeypair.publicKey,
    newAccountPubkey: tempXTokenAccountKeypair.publicKey,
  });
  const initTempAccountIx = Token.createInitAccountInstruction(
    TOKEN_PROGRAM_ID,
    XTokenMintPubkey,
    tempXTokenAccountKeypair.publicKey,
    donorKeypair.publicKey
  );
  const transferXTokensToTempAccIx = Token.createTransferInstruction(
    TOKEN_PROGRAM_ID,
    donorXTokenAccountPubkey,
    tempXTokenAccountKeypair.publicKey,
    donorKeypair.publicKey,
    [],
    terms.vendorExpectedAmount
  );
  const escrowKeypair = new Keypair();
  const createEscrowAccountIx = SystemProgram.createAccount({
    space: ESCROW_ACCOUNT_DATA_LAYOUT.span,
    lamports: await connection.getMinimumBalanceForRentExemption(
      ESCROW_ACCOUNT_DATA_LAYOUT.span
    ),
    fromPubkey: donorKeypair.publicKey,
    newAccountPubkey: escrowKeypair.publicKey,
    programId: escrowProgramId,
  });
  const initEscrowIx = new TransactionInstruction({
    programId: escrowProgramId,
    keys: [
      { pubkey: donorKeypair.publicKey, isSigner: true, isWritable: false },
      {
        pubkey: tempXTokenAccountKeypair.publicKey,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: donorYTokenAccountPubkey,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: escrowKeypair.publicKey, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(
      Uint8Array.of(0, ...new BN(terms.vendorExpectedAmount).toArray("le", 8))
    ),
  });

  const tx = new Transaction().add(
    createTempTokenAccountIx,
    initTempAccountIx,
    transferXTokensToTempAccIx,
    createEscrowAccountIx,
    initEscrowIx
  );
  console.log("Sending Donor's transaction...✅");
  await connection.sendTransaction(
    tx,
    [donorKeypair, tempXTokenAccountKeypair, escrowKeypair],
    { skipPreflight: false, preflightCommitment: "confirmed" }
  );

  // sleep to allow time to update
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const escrowAccount = await connection.getAccountInfo(
    escrowKeypair.publicKey
  );

  if (escrowAccount === null || escrowAccount.data.length === 0) {
    logError("Escrow state account has not been initialized properly");
    process.exit(1);
  }

  const encodedEscrowState = escrowAccount.data;
  const decodedEscrowState = ESCROW_ACCOUNT_DATA_LAYOUT.decode(
    encodedEscrowState
  ) as EscrowLayout;

  if (!decodedEscrowState.isInitialized) {
    logError("Escrow state initialization flag has not been set");
    process.exit(1);
  } else if (
    !new PublicKey(decodedEscrowState.initializerPubkey).equals(
      donorKeypair.publicKey
    )
  ) {
    logError(
      "InitializerPubkey has not been set correctly / not been set to Donor's public key"
    );
    process.exit(1);
  } else if (
    !new PublicKey(
      decodedEscrowState.initializerReceivingTokenAccountPubkey
    ).equals(donorYTokenAccountPubkey)
  ) {
    logError(
      "initializerReceivingTokenAccountPubkey has not been set correctly / not been set to Donor's Y public key"
    );
    process.exit(1);
  } else if (
    !new PublicKey(decodedEscrowState.initializerTempTokenAccountPubkey).equals(
      tempXTokenAccountKeypair.publicKey
    )
  ) {
    logError(
      "initializerTempTokenAccountPubkey has not been set correctly / not been set to temp X token account public key"
    );
    process.exit(1);
  }
  console.log(
    `✨Temporary account successfully initialized. Donor is donating ${terms.vendorExpectedAmount} USDC✨\n`
  );
  writePublicKey(escrowKeypair.publicKey, "escrow");
  console.table([
    {
      "Donor USDC Account": await getTokenBalance(
        donorXTokenAccountPubkey,
        connection
      ),
      "Temporary Account": await getTokenBalance(
        tempXTokenAccountKeypair.publicKey,
        connection
      ),
      "Vendor USDC Account": await getTokenBalance(
        getPublicKey("vendor_x"),
        connection
      ),
    },
  ]);

  // Getting fee from blockhash
  const blockhash = await connection.getRecentBlockhash();
  const fee = await (
    await connection.getFeeCalculatorForBlockhash(blockhash.blockhash)
  ).value;

  console.log("Donor's fees in lamports:", fee?.lamportsPerSignature);
  const lamptosol = 5000 * 0.000000001;
  console.log("Donor's fees in SOL:", lamptosol);
  console.log(
    "With 1 SOL = $100 USD, the fees would be: 💸" +
      (lamptosol * 100).toString()
  );

  console.log("");
};

donor();
