Usage:

1. `npm i nameable-object`
2. Add `@Nameable({ doBindingKey: "MY_DO" })` to your SQLite DO (SQLite only!)

Then, access registry directly:

```ts
if (url.pathname === "/registry") {
  const doObject = env.MY_DO.get(env.MY_DO.idFromName(REGISTRY_INSTANCE));
  return doObject.fetch(request);
}
```

Or access it in any other instance of your DO:

```ts
@Nameable({ doBindingKey: "MY_DO" })
export class MyDurableObject extends DurableObject {
  // Add this for in-DO access
  name = new NameableHandler(this, { doBindingKey: "MY_DO" });

  async fetch(request: Request) {
    // You can get the registry from any DO. It will always look in the registry instance of your DO.
    const registry = await this.name.getRegistry();
    const name = this.ctx.id.name;
    const storedName = await this.name.getName();
    return new Response(
      `Name: ${name}, stored name: ${storedName}) and id ${this.ctx.id.toString()}. 
      
REGISTRY:
--------
${JSON.stringify(registry, undefined, 2)}`,
    );
  }
}
```

See [example.ts](example.ts) for the demonstrations of both!

Please note that this works by doing a call to an added `_registry` instance on your DO where it maintains a registry table in SQLite. Therefore, this can become a bottleneck and may start failing on high amount of requests. Please use at your own risk. [Feedback appreciated](https://x.com/janwilmake/status/1937482288226271484)!

TODO:

- Wait for https://github.com/janwilmake/test-do-name to work in prod
- May never be needed (if CF may keep a list WITH names)
- Let's see!
