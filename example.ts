import { DurableObject } from "cloudflare:workers";
import { Nameable, NameableHandler } from "./nameable-object";

@Nameable({ doBindingKey: "MY_DO" })
export class MyDurableObject extends DurableObject {
  name = new NameableHandler(this, { doBindingKey: "MY_DO" });

  async fetch(request: Request) {
    // Your DO logic here
    const registry = await this.name.getRegistry();
    return new Response(
      `Hello from DO. The registry is: \n\n${JSON.stringify(
        registry,
        undefined,
        2,
      )}`,
    );
  }
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/registry") {
      const doObject = env.MY_DO.get(env.MY_DO.idFromName("_registry"));
      return doObject.fetch(request);
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const type = parts[0];
    const name = parts.pop() || "default-name";
    const doId =
      type === "name"
        ? env.MY_DO.idFromName(name)
        : env.MY_DO.idFromString(name);

    const doObject = env.MY_DO.get(doId);
    return doObject.fetch(request);
  },
};
