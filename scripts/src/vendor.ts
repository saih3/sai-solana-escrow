import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
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
} from "./utils";

const bob = async () => {
  const bobKeypair = getKeypair("vendor");
  const bobXTokenAccountPubkey = getPublicKey("vendor_x");
  const bobYTokenAccountPubkey = getPublicKey("vendor_y");
  const escrowStateAccountPubkey = getPublicKey("escrow");
  const escrowProgramId = getProgramId();

  const XTokenMintPubkey = getPublicKey("mint_x");
  const donorKeypair = getKeypair("donor");
  const terms = getTerms();

  const tempXTokenAccountKeypair = new Keypair();
  const initTempAccountIx = Token.createInitAccountInstruction(
    TOKEN_PROGRAM_ID,
    XTokenMintPubkey,
    tempXTokenAccountKeypair.publicKey,
    donorKeypair.publicKey
  );

  const connection = new Connection("http://localhost:8899", "confirmed");
  const escrowAccount = await connection.getAccountInfo(
    escrowStateAccountPubkey
  );
  if (escrowAccount === null) {
    logError("Could not find escrow at given address!");
    process.exit(1);
  }

  const encodedEscrowState = escrowAccount.data;
  const decodedEscrowLayout = ESCROW_ACCOUNT_DATA_LAYOUT.decode(
    encodedEscrowState
  ) as EscrowLayout;
  const escrowState = {
    escrowAccountPubkey: escrowStateAccountPubkey,
    isInitialized: !!decodedEscrowLayout.isInitialized,
    initializerAccountPubkey: new PublicKey(
      decodedEscrowLayout.initializerPubkey
    ),
    XTokenTempAccountPubkey: new PublicKey(
      decodedEscrowLayout.initializerTempTokenAccountPubkey
    ),
    initializerYTokenAccount: new PublicKey(
      decodedEscrowLayout.initializerReceivingTokenAccountPubkey
    ),
    expectedAmount: new BN(decodedEscrowLayout.expectedAmount, 10, "le"),
  };

  const PDA = await PublicKey.findProgramAddress(
    [Buffer.from("escrow")],
    escrowProgramId
  );

  const exchangeInstruction = new TransactionInstruction({
    programId: escrowProgramId,
    data: Buffer.from(
      Uint8Array.of(1, ...new BN(terms.vendorExpectedAmount).toArray("le", 8))
    ),
    keys: [
      { pubkey: bobKeypair.publicKey, isSigner: true, isWritable: false },
      { pubkey: bobYTokenAccountPubkey, isSigner: false, isWritable: true },
      { pubkey: bobXTokenAccountPubkey, isSigner: false, isWritable: true },
      {
        pubkey: escrowState.XTokenTempAccountPubkey,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: escrowState.initializerAccountPubkey,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: escrowState.initializerYTokenAccount,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: escrowStateAccountPubkey, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PDA[0], isSigner: false, isWritable: false },
    ],
  });

  const aliceYTokenAccountPubkey = getPublicKey("donor_y");
  const [aliceYbalance, bobXbalance] = await Promise.all([
    getTokenBalance(aliceYTokenAccountPubkey, connection),
    getTokenBalance(bobXTokenAccountPubkey, connection),
  ]);

  console.log(
    "🤑🤑🤑Sending donation held by temporary account to vendors account...💰"
  );
  await connection.sendTransaction(
    new Transaction().add(exchangeInstruction),
    [bobKeypair],
    { skipPreflight: false, preflightCommitment: "confirmed" }
  );

  // sleep to allow time to update
  await new Promise((resolve) => setTimeout(resolve, 1000));

  if ((await connection.getAccountInfo(escrowStateAccountPubkey)) !== null) {
    logError("Escrow account has not been closed");
    process.exit(1);
  }

  if (
    (await connection.getAccountInfo(escrowState.XTokenTempAccountPubkey)) !==
    null
  ) {
    logError("Temporary X token account has not been closed");
    process.exit(1);
  }

  const newAliceYbalance = await getTokenBalance(
    aliceYTokenAccountPubkey,
    connection
  );

  const newBobXbalance = await getTokenBalance(
    bobXTokenAccountPubkey,
    connection
  );

  console.log(
    "✨Trade successfully executed. All temporary accounts closed✨\n"
  );
  console.table([
    {
      "Donor USDC Account": await getTokenBalance(
        getPublicKey("donor_x"),
        connection
      ),
      "Vendor USDC Account": newBobXbalance,
    },
  ]);

  console.log("");
};

bob();
