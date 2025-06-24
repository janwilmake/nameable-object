// @ts-check
/// <reference lib="esnext" />
/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from "cloudflare:workers";

const DO_REGISTRY_INSTANCE = "_registry";

export interface RegistryEntry {
  id: string;
  name: string;
  created_at: number;
}

export interface NameableConfig {
  doBindingKey: string;
}

export interface NameableResult {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}

// NameableHandler class
export class NameableHandler {
  private storage: DurableObjectStorage;
  private sql: SqlStorage;
  private config: NameableConfig;
  private env: any;
  private ctx: any;
  private id: DurableObjectId;
  private isRegistry: boolean;

  constructor(private durableObject: DurableObject, config: NameableConfig) {
    //@ts-ignore
    this.ctx = durableObject.ctx;
    this.storage = this.ctx.storage;
    this.sql = this.storage.sql;
    //@ts-ignore
    this.env = durableObject.env;
    this.config = config;
    this.id = this.ctx.id;
    this.isRegistry = this.id.name === DO_REGISTRY_INSTANCE;

    // Initialize registry table if this is the registry instance
    if (this.isRegistry) {
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS _do_registry (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
      );
    }
  }

  // Private method - exposed via internal fetch
  private async updateRegistry(): Promise<NameableResult> {
    try {
      const registryId =
        this.env[this.config.doBindingKey].idFromName(DO_REGISTRY_INSTANCE);
      const registryStub = this.env[this.config.doBindingKey].get(registryId);

      const name =
        (await this.storage.get<string>("_name")) ||
        this.id.name ||
        this.id.toString();

      const response = await registryStub.fetch(
        new Request("http://internal/_nameable/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: this.id.toString(),
            name: name,
            created_at: Date.now(),
          }),
        }),
      );

      const result = (await response.json()) as NameableResult;
      return result;
    } catch (error) {
      return {
        success: false,
        error: `Failed to update registry: ${String(error)}`,
      };
    }
  }

  // Private method - exposed via internal fetch
  private async deleteFromRegistry(id: string): Promise<NameableResult> {
    if (!this.isRegistry) {
      return {
        success: false,
        error: "This method can only be called on the registry instance",
      };
    }

    try {
      this.sql.exec("DELETE FROM _do_registry WHERE id = ?", id);
      return {
        success: true,
        message: `Deleted ${id} from registry`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete from registry: ${String(error)}`,
      };
    }
  }

  // Private method for registry instance to handle updates
  async handleRegistryUpdate(data: RegistryEntry): Promise<NameableResult> {
    if (!this.isRegistry) {
      return {
        success: false,
        error: "This method can only be called on the registry instance",
      };
    }

    console.log("inserting", data);

    try {
      this.sql
        .exec(
          `INSERT OR REPLACE INTO _do_registry (id, name, created_at) VALUES (?, ?, ?)`,
          data.id,
          data.name,
          data.created_at,
        )
        .toArray();
      return {
        success: true,
        message: `Updated registry for ${data.id}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update registry: ${String(error)}`,
      };
    }
  }

  // Public method
  async getRegistry(): Promise<RegistryEntry[]> {
    try {
      const registryId =
        this.env[this.config.doBindingKey].idFromName(DO_REGISTRY_INSTANCE);
      const registryStub = this.env[this.config.doBindingKey].get(registryId);

      const response = await registryStub.fetch(
        new Request("http://internal/_nameable/list", {
          method: "GET",
        }),
      );

      const result = (await response.json()) as NameableResult;
      if (result.success && result.data) {
        return result.data as RegistryEntry[];
      }

      throw new Error(result.error || "Failed to get registry");
    } catch (error) {
      console.error("Failed to get registry:", error);
      return [];
    }
  }

  // Public method
  async safeDeleteAll(): Promise<NameableResult> {
    try {
      // First, remove from registry
      const registryId =
        this.env[this.config.doBindingKey].idFromName(DO_REGISTRY_INSTANCE);
      const registryStub = this.env[this.config.doBindingKey].get(registryId);

      const response = await registryStub.fetch(
        new Request("http://internal/_nameable/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: this.id.toString() }),
        }),
      );

      const registryResult = (await response.json()) as NameableResult;

      // Then delete all local storage
      await this.storage.deleteAll();

      return {
        success: registryResult.success,
        message: "Deleted all storage and removed from registry",
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to safe delete all: ${String(error)}`,
      };
    }
  }

  // Initialize name and registry
  async initializeNameAndRegistry(): Promise<void> {
    console.log("waituntil call", this.isRegistry);
    // Skip if this is the registry instance
    if (this.isRegistry) {
      return;
    }

    console.log("ok");

    // Check if already initialized
    const initialized = await this.storage.get<boolean>(
      "_initialized_registry",
    );
    if (initialized) {
      return;
    }

    // Check and set name
    let name = await this.storage.get<string>("_name");
    if (!name && this.id.name) {
      name = this.id.name;
      await this.storage.put("_name", name);
    }

    // Update registry
    await this.updateRegistry();

    // Mark as initialized
    await this.storage.put("_initialized_registry", true);
  }
}

// Decorator function
export function Nameable(config: NameableConfig) {
  return function <T extends new (...args: any[]) => DurableObject>(
    constructor: T,
  ) {
    return class extends constructor {
      public nameable: NameableHandler;

      constructor(...args: any[]) {
        super(...args);
        this.nameable = new NameableHandler(this, config);
      }

      // Override fetch to handle registry initialization and internal endpoints
      async fetch(request: Request) {
        const url = new URL(request.url);

        // Initialize registry on first fetch
        //@ts-ignore
        this.ctx.waitUntil(this.nameable.initializeNameAndRegistry());

        // Handle internal nameable endpoints
        if (url.pathname.startsWith("/_nameable/")) {
          try {
            const path = url.pathname.substring("/_nameable/".length);

            switch (path) {
              case "list": {
                // Only registry instance can list
                //@ts-ignore
                if (this.ctx.id.name !== DO_REGISTRY_INSTANCE) {
                  return new Response(
                    JSON.stringify({
                      success: false,
                      error: "Only registry instance can list entries",
                    }),
                    {
                      status: 403,
                      headers: { "Content-Type": "application/json" },
                    },
                  );
                }

                //@ts-ignore
                const entries = this.ctx.storage.sql
                  .exec<RegistryEntry>(
                    "SELECT id, name, created_at FROM _do_registry",
                  )
                  .toArray();

                return new Response(
                  JSON.stringify({
                    success: true,
                    data: entries,
                  }),
                  { headers: { "Content-Type": "application/json" } },
                );
              }

              case "update": {
                // Only registry instance can handle updates
                console.log("UPDATE", this.ctx.id.name);
                //@ts-ignore
                if (this.ctx.id.name !== DO_REGISTRY_INSTANCE) {
                  return new Response(
                    JSON.stringify({
                      success: false,
                      error: "Only registry instance can handle updates",
                    }),
                    {
                      status: 403,
                      headers: { "Content-Type": "application/json" },
                    },
                  );
                }

                const data = (await request.json()) as RegistryEntry;
                //@ts-ignore
                console.log("UPDATE", data);

                const result = await this.nameable.handleRegistryUpdate(data);

                return new Response(JSON.stringify(result), {
                  status: result.success ? 200 : 500,
                  headers: { "Content-Type": "application/json" },
                });
              }

              case "delete": {
                // Only registry instance can handle deletes
                //@ts-ignore
                if (this.ctx.id.name !== DO_REGISTRY_INSTANCE) {
                  return new Response(
                    JSON.stringify({
                      success: false,
                      error: "Only registry instance can handle deletes",
                    }),
                    {
                      status: 403,
                      headers: { "Content-Type": "application/json" },
                    },
                  );
                }

                const { id } = (await request.json()) as { id: string };
                //@ts-ignore
                const result = await this.nameable.deleteFromRegistry(id);

                return new Response(JSON.stringify(result), {
                  status: result.success ? 200 : 500,
                  headers: { "Content-Type": "application/json" },
                });
              }

              default:
                return new Response("Not found", { status: 404 });
            }
          } catch (error) {
            return new Response(
              JSON.stringify({
                success: false,
                error: `Nameable endpoint error: ${String(error)}`,
              }),
              {
                status: 500,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        }

        // Call original fetch if it exists
        if (super.fetch !== DurableObject.prototype.fetch) {
          return super.fetch(request);
        }

        return new Response("Not found", { status: 404 });
      }
    } as any;
  };
}
