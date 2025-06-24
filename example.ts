import { DurableObject } from "cloudflare:workers";
import { Nameable, NameableHandler } from "./nameable-object";

@Nameable({ doBindingKey: "TEST_DO" })
export class Test123 extends DurableObject {
  name = new NameableHandler(this, { doBindingKey: "TEST_DO" });

  async fetch(request: Request) {
    // You can get the registry from any DO. It will always look in the _registry instance of your DO.
    const registry = await this.name.getRegistry();
    return new Response(
      `Hello from DO name: ${
        this.ctx.id.name
      } and id ${this.ctx.id.toString()}. 
      
The registry is here:


${JSON.stringify(registry, undefined, 2)}`,
    );
  }
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response(`Welcome to the nameable-object example. This demo shows you can track all your DO instances by name/id by just adding @Nameable({ doBindingKey: "TEST_DO" }) to your DO!
        
- visit GET /registry for direct access to _registry GET /registry
- visit GET /{name} for accessing DO by its name
- visit GET /random for accessing a random DO without name
- visit GET /id/{id} for accessing a DO by its id`);
    }
    if (url.pathname === "/registry") {
      const doObject = env.TEST_DO.get(env.TEST_DO.idFromName("_registry"));
      return doObject.fetch(request);
    }

    if (url.pathname === "/random") {
      const doId = env.TEST_DO.newUniqueId();
      const doObject = env.TEST_DO.get(doId);
      return doObject.fetch(request);
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const type = parts[0];
    const name = parts.pop() || "default-name";
    const doId =
      type === "id"
        ? env.TEST_DO.idFromString(name)
        : env.TEST_DO.idFromName(name);

    const doObject = env.TEST_DO.get(doId);
    return doObject.fetch(request);
  },
};
