import { LiteMCP } from "litemcp";
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, desc, asc } from "drizzle-orm";
import { pgTable, timestamp } from "drizzle-orm/pg-core";
import { jsonb, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  type IIdentityServer,
  ZMessageLifecycle,
  type IMessageLifecycle,
  type ITool,
  type Character,
  type ILog,
  ZCharacter,
  checkApproval,
} from "@spacemangaming/daemon";

/**
* Identity Server manages
*  - Character Files
*  - Channel Conversation Logs
*/
export class IdentityServerPostgres implements IIdentityServer {
  private db: PostgresJsDatabase<typeof ContextServerSchema> | undefined;
  private server: LiteMCP;
  
  private initialized: boolean = false;
  
  constructor(
    serverOpts?: { name?: string }
  ) {
    this.server = new LiteMCP(serverOpts?.name || "context-server", "1.0.0");
  }
  
  async init(pgOpts: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
  }): Promise<void> {
    // First connect to default postgres database to create the target database if it doesn't exist
    if (pgOpts.database) {
      const tempDb = drizzle({
        connection: {
          ...pgOpts,
          database: 'postgres' // Connect to default database first
        },
        schema: ContextServerSchema,
        casing: "snake_case",
      });

      try {
        await tempDb.execute(sql`CREATE DATABASE ${sql.identifier(pgOpts.database)}`);
      } catch (error: any) {
        // Ignore error if database already exists
        if (!error.message.includes('already exists')) {
          throw error;
        }
      } finally {
        // Close the temporary connection
        await (tempDb as any).connection?.end?.();
      }
    }

    this.db = drizzle({
      connection: pgOpts,
      schema: ContextServerSchema,
      casing: "snake_case",
    });
    
    // Enable pgvector extension
    await this.db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    
    // Daemons
    await this.db.execute(
      sql`CREATE TABLE IF NOT EXISTS daemons (pubkey text PRIMARY KEY, character jsonb)`
    );
    
    // Logs
    await this.db.execute(
      sql`CREATE TABLE IF NOT EXISTS logs (id text PRIMARY KEY, daemon_pubkey text NOT NULL, channel_id text, created_at timestamp NOT NULL, lifecycle jsonb)`
    );
    
    this.initialized = true;
  }
  
  async start(port?: number): Promise<void> {
    if (!this.initialized) {
      throw new Error("Identity Server not initialized");
    }
    
    // Server Info
    this.server.addTool({
      name: "getServerInfo",
      description: "Get server info",
      parameters: z.object({}),
      execute: async () => {
        return await this.getServerInfo();
      },
    });
    
    // List Tools
    this.server.addTool({
      name: "listServerTools",
      description: "List server tools",
      parameters: z.object({}),
      execute: async () => {
        return await this.listServerTools();
      },
    });
    
    this.server.addTool({
      name: "listContextTools",
      description: "List context tools",
      parameters: z.object({}),
      execute: async () => {
        return await this.listContextTools();
      },
    });
    
    this.server.addTool({
      name: "listActionTools",
      description: "List action tools",
      parameters: z.object({}),
      execute: async () => {
        return await this.listActionTools();
      },
    });
    
    this.server.addTool({
      name: "listPostProcessTools",
      description: "List post process tools",
      parameters: z.object({}),
      execute: async () => {
        return await this.listPostProcessTools();
      },
    });
    
    // Server Tools
    this.server.addTool({
      name: "registerCharacter",
      description: "Register a new character",
      parameters: ZCharacter,
      execute: async (character: Character) => {
        return JSON.stringify(await this.registerCharacter(character));
      },
    });
    
    this.server.addTool({
      name: "fetchCharacter",
      description: "Fetch a character",
      parameters: z.object({
        daemonId: z.string(),
      }),
      execute: async (args: { daemonId: string }) => {
        return JSON.stringify((await this.fetchCharacter(args.daemonId)) || {});
      },
    });
    
    this.server.addTool({
      name: "fetchLogs",
      description: "Fetch logs",
      parameters: z.object({
        daemonPubkey: z.string(),
        channelId: z.string().optional(),
        limit: z.number().optional(),
        orderBy: z.enum(["asc", "desc"]).optional(),
      }),
      execute: async (args) => {
        return JSON.stringify(await this.fetchLogs(args));
      },
    });
    
    // Action Tools
    // Post Process Tools
    this.server.addTool({
      name: "pp_createLog",
      description: "Insert a log",
      parameters: z.object({
        lifecycle: ZMessageLifecycle,
        args: z.any().optional(),
      }),
      execute: async (args: { lifecycle: IMessageLifecycle; args?: any }) => {
        return JSON.stringify(await this.pp_createLog(args.lifecycle));
      },
    });
    
    // Start the Server
    this.server.start({
      transportType: "sse",
      sse: {
        endpoint: `/sse`,
        port: port || 8080,
      },
    });
  }
  
  async stop(): Promise<void> {
    // TODO: Placeholder to do things here;
  }
  
  // Server Info
  async getServerInfo(): Promise<{ name: string; description: string }> {
    return {
      name: "Daemon Identity Server",
      description: "Identity Server for Daemon Framework that manages logs",
    };
  }
  
  // List Tools
  async listServerTools(): Promise<ITool[]> {
    return [
      {
        name: "registerCharacter",
        description: "Register a new character",
        type: "Server",
        zIndex: 0,
      },
      {
        name: "fetchCharacter",
        description: "Fetch a character",
        type: "Server",
        zIndex: 0,
      },
      {
        name: "fetchLogs",
        description: "Fetch logs",
        type: "Server",
        zIndex: 0,
      },
    ];
  }
  
  async listContextTools(): Promise<ITool[]> {
    return [];
  }
  
  async listActionTools(): Promise<ITool[]> {
    return [];
  }
  
  async listPostProcessTools(): Promise<ITool[]> {
    return [
      {
        name: "pp_createLog",
        description: "Create a log",
        type: "PostProcess",
        zIndex: 99999,
      },
    ];
  }
  
  // Server Tools
  async registerCharacter(character: Character): Promise<{ pubkey: string }> {
    if (!this.initialized) {
      throw new Error("Context Server not initialized");
    }
    
    const existingCharacter = await this.fetchCharacter(character.pubkey);
    if (existingCharacter) {
      return { pubkey: character.pubkey };
    }
    
    await this.db?.insert(ContextServerSchema.daemons).values({
      pubkey: character.pubkey,
      character,
    });
    
    return { pubkey: character.pubkey };
  }
  
  async fetchCharacter(pubkey: string): Promise<Character | undefined> {
    if (!this.initialized) {
      throw new Error("Context Server not initialized");
    }
    
    const character = await this.db!
      .select()
      .from(ContextServerSchema.daemons)
      .where(eq(ContextServerSchema.daemons.pubkey, pubkey))
      .execute();
    return character[0]?.character as Character | undefined;
  }
  
  async fetchLogs(opts: {
    daemonPubkey: string;
    channelId?: string;
    limit?: number;
    orderBy?: "asc" | "desc";
  }): Promise<ILog[]> {
    if (!this.initialized) {
      throw new Error("Context Server not initialized");
    }
    
    const logs = await this.db!
    .select()
    .from(ContextServerSchema.logs)
    .where(eq(ContextServerSchema.logs.daemonPubkey, opts.daemonPubkey))
    .limit(opts.limit || 100)
    .orderBy(
      opts.orderBy === "asc"
      ? asc(ContextServerSchema.logs.createdAt)
      : desc(ContextServerSchema.logs.createdAt)
    )
    .execute();
    
    return logs.map((log) => {
      return {
        ...log,
        lifecycle: log.lifecycle as IMessageLifecycle,
      };
    });
  }
  
  // Context Tools
  // Action Tools
  
  // Post Process Tools
  async pp_createLog(lifecycle: IMessageLifecycle): Promise<IMessageLifecycle> {
    if (!this.initialized) {
      throw new Error("Context Server not initialized");
    }
    
    // Check Approval
    
    if (!checkApproval(lifecycle)) {
      throw new Error("Approval failed");
    }
    
    // Create Log
    const logId = nanoid();
    await this.db!.insert(ContextServerSchema.logs).values({
      id: logId,
      daemonPubkey: lifecycle.daemonPubkey,
      channelId: lifecycle.channelId,
      createdAt: new Date(),
      lifecycle: lifecycle,
    });
    
    lifecycle.postProcessLog.push(
      JSON.stringify({
        server: this.server.name,
        tool: "pp_createLog",
        args: {
          logId,
        },
      })
    );
    return lifecycle;
  }
}

const daemons = {
  pubkey: text("pubkey").primaryKey(),
  character: jsonb("character"),
};

const logs = {
  id: text("id").primaryKey(),
  daemonPubkey: text("daemon_pubkey").notNull(),
  channelId: text("channel_id"),
  createdAt: timestamp("created_at").notNull(),
  lifecycle: jsonb("lifecycle").notNull(),
};

let ContextServerSchema = {
  daemons: pgTable("daemons", daemons),
  logs: pgTable("logs", logs),
};
