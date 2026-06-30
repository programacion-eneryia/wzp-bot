/** Inspecciona el formato real de chats y mensajes de Unipile. */
const dsn = process.env.UNIPILE_DSN;
const apiKey = process.env.UNIPILE_API_KEY;
const base = `https://${dsn}/api/v1`;
const h = { "X-API-KEY": apiKey, accept: "application/json" };

const chats = await fetch(`${base}/chats?limit=3`, { headers: h }).then((r) => r.json());
const first = (chats.items ?? [])[0];
console.log("CHAT[0] keys:", Object.keys(first ?? {}));
console.log("CHAT[0]:", JSON.stringify(first, null, 2).slice(0, 600));

if (first?.id) {
  const msgs = await fetch(`${base}/chats/${first.id}/messages?limit=3`, { headers: h }).then((r) => r.json());
  console.log("\nMESSAGES count:", (msgs.items ?? []).length);
  const m = (msgs.items ?? [])[0];
  console.log("MESSAGE[0] keys:", Object.keys(m ?? {}));
  console.log("MESSAGE[0]:", JSON.stringify(m, null, 2).slice(0, 800));
}
