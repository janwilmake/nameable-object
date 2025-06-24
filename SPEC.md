I need a name registry for my DOs. I want to just pass `@Nameable({doBindingKey:string})` to my DO (decorator) which should:

- create sqlite storage table `_do_registry: { id, name, database_size, created_at, updated_at }`
- if key `_name` not found in state.storage, and this.ctx.id.name is found, set this value to `_name` in the storage
- add `this.ctx.waitUntil` to the start of fetch that connects with this.env[doBindingKey].get(id) (id is taken using DONamespace.idFromName(`_registry`) on the same namespace) and makes a RPC request to it which should create or update { id, name, database_size, created_at, updated_at } into the `_do_registry` table in the `_registry` instance of the same DO.
- for database_size, just use state.storage.sql.databaseSize
- ensure we only do the thing in waitUntil if the DO name is not `_registry` to prevent an infinite loop

Implement this in a similar way to clearable-object: https://pastebin.contextarea.com/CqNMWIW.md but only use @Nameable as main exported thing, the handler can be defined fully inside of it
