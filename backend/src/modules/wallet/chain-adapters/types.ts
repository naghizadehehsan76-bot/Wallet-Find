import type { Address } from "viem";

export type AdapterAsset = {
  id: string;
  assetType: "NATIVE" | "TOKEN";
  contractAddress: string | null;
  decimals: number;
};

export type AdapterAddress = {
  id: string;
  address: string;
  walletAccountId: string;
  userId: string;
};

export type IncomingChainTransfer = {
  transactionReference: string;
  eventIndex: number;
  position: string;
  blockHash: string | null;
  fromAddress: string | null;
  toAddress: string;
  rawAmount: string;
  amountAtomic: string;
};

export interface WalletChainAdapter {
  readonly networkId: string;
  readonly family: "EVM" | "BITCOIN" | "SOLANA";
  getLatestPosition(): Promise<string>;
  getSafePosition(finalityDepth: number): Promise<string>;
  getPositionHash(position: string): Promise<string | null>;
  getIncomingTransfers(input: {
    asset: AdapterAsset;
    addresses: readonly AdapterAddress[];
    fromPosition: string;
    toPosition: string;
  }): Promise<IncomingChainTransfer[]>;
}
