import { LiteMCP } from "litemcp";
import { z } from "zod";
import {
  Connection,
  PublicKey,
  type TransactionSignature,
  VersionedTransaction,
} from "@solana/web3.js";
import { IDaemonMCPServer, ITool } from "@spacemangaming/daemon";

export class SolanaServer implements IDaemonMCPServer {
  private server: LiteMCP;
  private connection: Connection | null = null;
  private isInitialized = false;

  constructor(opts?: { name?: string; port?: number }) {
    this.server = new LiteMCP(opts?.name || "solana-mcp-server", "1.0.0");
  }

  async init(rpcUrl: string) {
    try {
      this.connection = new Connection(rpcUrl, "confirmed");
      this.isInitialized = true;
      console.log("Solana Server initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Solana Server:", error);
      throw error;
    }
  }

  async start(port?: number): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Server not initialized. Call init() first");
    }

    this.server.addTool({
      name: "getTransaction",
      description: "Get transaction details by signature",
      parameters: z.object({
        signature: z.string(),
      }),
      execute: async (args) => {
        try {
          const tx = await this.connection?.getTransaction(args.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          return { success: true, transaction: tx };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    });

    this.server.addTool({
      name: "getAccountInfo",
      description: "Get account information for a public key",
      parameters: z.object({
        publicKey: z.string(),
      }),
      execute: async (args) => {
        try {
          const pubkey = new PublicKey(args.publicKey);
          const info = await this.connection?.getAccountInfo(pubkey);
          return { success: true, accountInfo: info };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    });

    this.server.addTool({
      name: "getBalance",
      description: "Get SOL balance for a public key",
      parameters: z.object({
        publicKey: z.string(),
      }),
      execute: async (args) => {
        try {
          const pubkey = new PublicKey(args.publicKey);
          const balance = await this.connection?.getBalance(pubkey);
          return { success: true, balance };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    });

    this.server.addTool({
      name: "getSlot",
      description: "Get current slot",
      parameters: z.object({}),
      execute: async () => {
        try {
          const slot = await this.connection?.getSlot();
          return { success: true, slot };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    });

    this.server.addTool({
      name: "simulateTransaction",
      description: "Simulate a transaction",
      parameters: z.object({
        transaction: z.string(),
      }),
      execute: async (args) => {
        try {
          const tx = VersionedTransaction.deserialize(
            Buffer.from(args.transaction, "base64")
          );
          const result = await this.connection?.simulateTransaction(tx, {
            commitment: "confirmed",
          });
          return { success: true, simulation: result };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    });

    this.server.addTool({
      name: "sendAndConfirm",
      description: "Send and confirm a transaction",
      parameters: z.object({
        transaction: z.string(),
      }),
      execute: async (args) => {
        try {
          const tx = VersionedTransaction.deserialize(
            Buffer.from(args.transaction, "base64")
          );
          const signature = await this.connection?.sendTransaction(tx);

          let confirmed = false;
          while (!confirmed) {
            const confirmation = await this.connection?.getSignatureStatus(
              signature as TransactionSignature
            );
            if (confirmation?.value?.confirmationStatus === "confirmed") {
              confirmed = true;
            } else {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
          return { success: true, signature };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    });

    this.server.start({
      transportType: "sse",
      sse: {
        endpoint: `/sse`,
        port: port || 8084,
      },
    });
  }

  async getServerInfo(): Promise<{
    name: string;
    description: string;
  }> {
    return {
      name: "Solana Context Server",
      description: "Solana RPC context server for blockchain interactions",
    };
  }

  async listServerTools(): Promise<ITool[]> {
    return [];
  }

  async listContextTools(): Promise<ITool[]> {
    return [];
  }

  async listActionTools(): Promise<ITool[]> {
    return [
      {
        name: "getTransaction",
        description: "Get transaction details by signature",
        type: "Action",
        zIndex: 0,
      },
      {
        name: "getAccountInfo",
        description: "Get account information for a public key",
        type: "Action",
        zIndex: 0,
      },
      {
        name: "getBalance",
        description: "Get SOL balance for a public key",
        type: "Action",
        zIndex: 0,
      },
      {
        name: "getSlot",
        description: "Get current slot",
        type: "Action",
        zIndex: 0,
      },
      {
        name: "simulateTransaction",
        description: "Simulate a transaction",
        type: "Action",
        zIndex: 0,
      },
      {
        name: "sendAndConfirm",
        description: "Send and confirm a transaction",
        type: "Action",
        zIndex: 0,
      },
    ];
  }

  async listPostProcessTools(): Promise<ITool[]> {
    return [];
  }
}
