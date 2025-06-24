I need a name registry for my DOs. I want to just pass `@Nameable({doBindingKey:string})` to my DO (decorator) which should:

- Hardcoded variable `const DO_REGISTRY_INSTANCE = "_registry";` is used everywhere
- Create sqlite storage table `_do_registry: { id, name, created_at }` if name is DO_REGISTRY_INSTANCE
- If key `_name` not found in state.storage, and this.ctx.id.name is found, set this value to `_name` in the storage
- Add `this.ctx.waitUntil` to the start of fetch that:
  - If do name is DO_REGISTRY_INSTANCE, skip to prevent infinite loop
  - Checks storage for `_initialized_registry`. If present, skip
  - Connects with `this.env[doBindingKey].get(id)` (id is taken using DONamespace.idFromName(DO_REGISTRY_INSTANCE) on the same namespace)
  - makes a RPC request to it to create/update
  - Sets storage `_initialized_registry` to true.
- methods on `NameableHandler`:
  - `getRegistry`: promises type safe the array of the registry table from the `DO_REGISTRY_INSTANCE` DO instance
  - `safeDeleteAll()` runs `ctx.storage.deleteAll()` but also deletes the id from the `DO_REGISTRY_INSTANCE` instance.
  - `updateRegistry()` should create or update { id, name, created_at } into the `_do_registry` table of the DO_REGISTRY_INSTANCE instance.
  - `deleteFromRegistry(id)`
- only `getRegistry` and `safeDeleteAll` should be public, the others go through fetch to be invisible.

Implement this in a similar way to clearable-object: https://pastebin.contextarea.com/CqNMWIW.md
https://uithub.com/janwilmake/gists/blob/main/durable-object-types.ts
