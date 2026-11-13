import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  existingWalletKeys,
  generateWallet,
  parseEnv,
  setEnvValues,
} from "../../scripts/create-wallets";

describe("generateWallet", () => {
  it("returns a 64-byte base58 secret whose public key is the address", async () => {
    const wallet = await generateWallet();
    const bytes = getBase58Encoder().encode(wallet.secret);
    expect(bytes.length).toBe(64);
    const signer = await createKeyPairSignerFromBytes(new Uint8Array(bytes));
    expect(signer.address).toBe(wallet.address);
  });

  it("creates a different wallet each time", async () => {
    const [a, b] = await Promise.all([generateWallet(), generateWallet()]);
    expect(a.address).not.toBe(b.address);
  });
});

describe("env file helpers", () => {
  const template = "GATEWAY_WALLET_SECRET=\nGATEWAY_WALLET_ADDRESS=\n# comment\nUSDC_MINT=abc\n";

  it("fills empty keys in place and appends new ones, keeping other lines", () => {
    const out = setEnvValues(template, { GATEWAY_WALLET_ADDRESS: "Addr1", NEW_KEY: "x" });
    expect(out).toBe(
      "GATEWAY_WALLET_SECRET=\nGATEWAY_WALLET_ADDRESS=Addr1\n# comment\nUSDC_MINT=abc\nNEW_KEY=x\n",
    );
  });

  it("parses values and ignores comments", () => {
    const env = parseEnv(template);
    expect(env.get("USDC_MINT")).toBe("abc");
    expect(env.has("# comment")).toBe(false);
  });

  it("reports wallet keys that already have values (so they are never overwritten)", () => {
    expect(existingWalletKeys(parseEnv(template))).toEqual([]);
    expect(existingWalletKeys(parseEnv("GATEWAY_WALLET_SECRET=abc\nATTACKER_WALLET_ADDRESS=\n"))).toEqual([
      "GATEWAY_WALLET_SECRET",
    ]);
  });
});
