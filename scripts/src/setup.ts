import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  Signer,
} from "@solana/web3.js";

import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  getKeypair,
  getPublicKey,
  getTokenBalance,
  writePublicKey,
} from "./utils";

const createMint = (
  connection: Connection,
  { publicKey, secretKey }: Signer
) => {
  return Token.createMint(
    connection,
    {
      publicKey,
      secretKey,
    },
    publicKey,
    null,
    0,
    TOKEN_PROGRAM_ID
  );
};

const setupMint = async (
  name: string,
  connection: Connection,
  alicePublicKey: PublicKey,
  bobPublicKey: PublicKey,
  clientKeypair: Signer
): Promise<[Token, PublicKey, PublicKey]> => {

  const mint = await createMint(connection, clientKeypair);
  writePublicKey(mint.publicKey, `mint_${name.toLowerCase()}`);

  console.log(`Creating Donor Token Account for USDC...`);
  const aliceTokenAccount = await mint.createAccount(alicePublicKey);
  writePublicKey(aliceTokenAccount, `donor_${name.toLowerCase()}`);

  console.log(`Creating Vendor Token Account for USDC...`);
  const bobTokenAccount = await mint.createAccount(bobPublicKey);
  writePublicKey(bobTokenAccount, `vendor_${name.toLowerCase()}`);

  return [mint, aliceTokenAccount, bobTokenAccount];
};

const setup = async () => {
  const alicePublicKey = getPublicKey("donor");
  const bobPublicKey = getPublicKey("vendor");
  const clientKeypair = getKeypair("id");

  const connection = new Connection("http://localhost:8899", "confirmed");
  console.log("Requesting SOL for Donor...");
  await connection.requestAirdrop(alicePublicKey, LAMPORTS_PER_SOL * 10);
  console.log("Requesting SOL for Vendor...");
  await connection.requestAirdrop(bobPublicKey, LAMPORTS_PER_SOL * 10);
  await connection.requestAirdrop(
    clientKeypair.publicKey,
    LAMPORTS_PER_SOL * 10
  );

  const [mintX, aliceTokenAccountForX, bobTokenAccountForX] = await setupMint(
    "X",
    connection,
    alicePublicKey,
    bobPublicKey,
    clientKeypair
  );
  console.log("Sending 50 USDC to Donor's USDC TokenAccount...");
  await mintX.mintTo(aliceTokenAccountForX, clientKeypair.publicKey, [], 50);

  console.log("Sending 50 USDC to Vendor's USDC TokenAccount...");
  await mintX.mintTo(bobTokenAccountForX, clientKeypair.publicKey, [], 50);

  const [mintY, aliceTokenAccountForY, bobTokenAccountForY] = await setupMint(
    "Y",
    connection,
    alicePublicKey,
    bobPublicKey,
    clientKeypair
  );
  await mintY.mintTo(bobTokenAccountForY, clientKeypair.publicKey, [], 50);

  console.log("✨Setup complete✨\n");
  console.table([
    {
      "Donor USDC Account": await getTokenBalance(
        aliceTokenAccountForX,
        connection
      ),
      "Vendor USDC Account": await getTokenBalance(
        bobTokenAccountForX,
        connection
      ),
    },
  ]);
  console.log("");
};

setup();
