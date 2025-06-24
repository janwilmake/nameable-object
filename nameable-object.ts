// @ts-check
/// <reference lib="esnext" />
/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from "cloudflare:workers";

export interface RegistryEntry {
  id: string;
  name: string;
  database_size: number;
  created_at: string;
  updated_at: string;
}

export interface NameableConfig {
  doBindingKey: string;
}

// Registry handler class
export class NameableHandler {
  storage: DurableObjectStorage;
  private config: NameableConfig;
  private env: any;

  constructor(private durableObject: DurableObject, config: NameableConfig) {
    //@ts-ignore
    this.storage = durableObject.ctx.storage;
    //@ts-ignore
    this.env = durableObject.env;
    this.config = config;

    // Initialize the registry table
    this.initializeRegistryTable();
  }

  private initializeRegistryTable(): void {
    try {
      this.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS _do_registry (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          database_size INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    } catch (error) {
      console.error("Failed to initialize registry table:", error);
    }
  }

  // Get all registry entries (public method for the registry DO)
  async getRegistry(): Promise<RegistryEntry[]> {
    const name = await this.storage.get("_name");
    if (name === "_registry") {
      try {
        const results = this.storage.sql
          //@ts-ignore
          .exec<RegistryEntry>(
            `
          SELECT id, name, database_size, created_at, updated_at 
          FROM _do_registry 
          ORDER BY created_at DESC
        `,
          )
          .toArray();

        return results;
      } catch (error) {
        console.error("Failed to get registry:", error);
        return [];
      }
    }

    const namespace = this.env[this.config.doBindingKey];
    if (!namespace) {
      console.error(
        `DO namespace ${this.config.doBindingKey} not found in env`,
      );
      return;
    }

    const registryId = namespace.idFromName("_registry");
    const registryStub = namespace.get(registryId);
    return registryStub.getRegistry();
  }

  // Update registry entry (called via RPC from other DOs)
  async updateRegistry(
    entry: Omit<RegistryEntry, "created_at" | "updated_at">,
  ): Promise<void> {
    try {
      const now = new Date().toISOString();

      this.storage.sql.exec(
        `
        INSERT INTO _do_registry (id, name, database_size, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          database_size = excluded.database_size,
          updated_at = excluded.updated_at
      `,
        entry.id,
        entry.name || "",
        entry.database_size,
        now,
        now,
      );
    } catch (error) {
      console.error("Failed to update registry:", error);
      throw error;
    }
  }

  async getName(): Promise<string | null> {
    return this.storage.get<string>("_name");
  }

  // Initialize name if not set and sync with registry
  async initializeAndSyncName(): Promise<void> {
    try {
      //@ts-ignore
      const doId = this.durableObject.ctx.id;
      //@ts-ignore
      const doName = doId.name;

      // Skip if this is the registry DO itself
      if (doName === "_registry") {
        return;
      }

      // Check if _name is already set in storage
      let storedName = await this.storage.get<string>("_name");

      // If no stored name but DO has a name, set it
      if (!storedName && doName) {
        storedName = doName;
        await this.storage.put("_name", storedName);
      }

      // If we have a name (either stored or from DO), sync with registry
      await this.syncWithRegistry(doId.toString(), storedName);
    } catch (error) {
      console.error("Failed to initialize and sync name:", error);
    }
  }

  private async syncWithRegistry(
    id: string,
    name: string | undefined,
  ): Promise<void> {
    try {
      const namespace = this.env[this.config.doBindingKey];
      if (!namespace) {
        console.error(
          `DO namespace ${this.config.doBindingKey} not found in env`,
        );
        return;
      }

      const registryId = namespace.idFromName("_registry");
      const registryStub = namespace.get(registryId);

      const databaseSize = this.storage.sql.databaseSize;

      // Call the updateRegistry RPC method
      await registryStub.updateRegistry({
        id,
        name,
        database_size: databaseSize,
      });
    } catch (error) {
      console.error("Failed to sync with registry:", error);
    }
  }
}

// Decorator function that adds nameable functionality
export function Nameable<T extends new (...args: any[]) => DurableObject>(
  config: NameableConfig,
) {
  return function (constructor: T) {
    return class extends constructor {
      public nameableHandler: NameableHandler;

      constructor(...args: any[]) {
        super(...args);
        this.nameableHandler = new NameableHandler(this, config);
      }

      // Override fetch to add registry sync and handle registry endpoints
      async fetch(request: Request) {
        //@ts-ignore
        const doName = this.ctx.id.name;

        // Add registry sync to waitUntil (skip for registry DO itself)
        if (doName !== "_registry") {
          //@ts-ignore
          this.ctx.waitUntil(this.nameableHandler.initializeAndSyncName());
        }

        try {
          const url = new URL(request.url);

          // Handle registry endpoint (only for the registry DO)
          if (
            doName === "_registry" &&
            url.pathname === "/registry" &&
            request.method === "GET"
          ) {
            const registry = await this.nameableHandler.getRegistry();
            return new Response(JSON.stringify(registry, undefined, 2), {
              headers: { "Content-Type": "application/json" },
              status: 200,
            });
          }

          // Call original fetch if it exists and is overridden
          if (super.fetch !== DurableObject.prototype.fetch) {
            return super.fetch(request);
          }

          return new Response("Not found", { status: 404 });
        } catch (error) {
          console.error("Nameable fetch error:", error);
          return new Response(
            JSON.stringify({
              success: false,
              error: `Nameable operation failed: ${String(error)}`,
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      }

      // Expose updateRegistry as RPC method for the registry DO
      async updateRegistry(
        entry: Omit<RegistryEntry, "created_at" | "updated_at">,
      ): Promise<void> {
        return this.nameableHandler.updateRegistry(entry);
      }

      // Expose getRegistry as RPC method
      async getRegistry(): Promise<RegistryEntry[]> {
        return this.nameableHandler.getRegistry();
      }

      async getName(): Promise<string | null> {
        return this.nameableHandler.getName();
      }
    } as any;
  };
}
