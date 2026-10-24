import { describe, expect, it } from "vitest";
import { Vault, VaultError, isEnvelope, type KeyStore } from "./vault";

const SECRET = JSON.stringify({ provider: "openai", apiKey: "sk-proj-SUPER-SECRET-123", azureEndpoint: "https://my-secret-resource.openai.azure.com" });

function memoryKeys(): KeyStore & { has: () => boolean } {
  let key: CryptoKey | undefined;
  return { get: async () => key, set: async (k) => void (key = k), delete: async () => void (key = undefined), has: () => !!key };
}
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof VaultError ? e.code : String(e)));

describe("vault: device mode", () => {
  it("round-trips, and the stored text contains none of the secret", async () => {
    const v = new Vault(memoryKeys());
    const env = await v.seal(SECRET, "device");
    expect(isEnvelope(env)).toBe(true);
    const stored = JSON.stringify(env);
    for (const leak of ["sk-proj", "SUPER-SECRET", "my-secret-resource", "openai", "apiKey"]) expect(stored).not.toContain(leak);
    expect(Buffer.from(env.ct, "base64").toString("latin1")).not.toContain("sk-proj");
    expect(await v.open(env)).toBe(SECRET);
  });

  it("uses a fresh IV every time, so the same text encrypts differently", async () => {
    const v = new Vault(memoryKeys());
    const a = await v.seal(SECRET, "device");
    const b = await v.seal(SECRET, "device");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("the device key can't be exported", async () => {
    const keys = memoryKeys();
    const v = new Vault(keys);
    await v.seal(SECRET, "device");
    const key = (await keys.get())!;
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("detects tampering with the ciphertext", async () => {
    const v = new Vault(memoryKeys());
    const env = await v.seal(SECRET, "device");
    const raw = Buffer.from(env.ct, "base64");
    raw[3] ^= 1;
    expect(await code(v.open({ ...env, ct: raw.toString("base64") }))).toBe("corrupt");
  });

  it("reports a lost key instead of returning garbage", async () => {
    const keys = memoryKeys();
    const v = new Vault(keys);
    const env = await v.seal(SECRET, "device");
    await v.destroy();
    expect(await code(v.open(env))).toBe("key-lost");
  });

  it("a different device's key can't open it", async () => {
    const env = await new Vault(memoryKeys()).seal(SECRET, "device");
    const other = new Vault(memoryKeys());
    expect(await code(other.open(env))).toBe("key-lost");
    await other.seal("x", "device"); // other now has its own key
    expect(await code(other.open(env))).toBe("corrupt");
  });
});

describe("vault: passphrase mode", () => {
  it("opens with the right passphrase on a fresh vault (a new browser session)", async () => {
    const env = await new Vault(memoryKeys()).seal(SECRET, "passphrase", "correct horse battery staple");
    expect(env.salt && env.iter).toBeTruthy();
    expect(env.iter).toBeGreaterThanOrEqual(600_000);
    expect(JSON.stringify(env)).not.toContain("sk-proj");
    expect(await new Vault(memoryKeys()).open(env, "correct horse battery staple")).toBe(SECRET);
  }, 20_000);

  it("refuses a wrong passphrase, and without one it stays locked", async () => {
    const env = await new Vault(memoryKeys()).seal(SECRET, "passphrase", "correct horse battery staple");
    const fresh = new Vault(memoryKeys());
    expect(await code(fresh.open(env))).toBe("locked");
    expect(await code(fresh.open(env, "wrong passphrase"))).toBe("wrong-passphrase");
    expect(fresh.isUnlocked(env)).toBe(false);
  }, 20_000);

  it("once unlocked, re-saving doesn't need the passphrase again, and lock() forgets it", async () => {
    const v = new Vault(memoryKeys());
    const env = await v.seal(SECRET, "passphrase", "correct horse battery staple");
    const again = await v.seal(JSON.stringify({ apiKey: "sk-new" }), "passphrase");
    expect(again.salt).toBe(env.salt);
    expect(again.iv).not.toBe(env.iv);
    expect(await v.open(again)).toContain("sk-new");
    v.lock();
    expect(await code(v.open(again))).toBe("locked");
    expect(await code(v.seal("x", "passphrase"))).toBe("locked");
  }, 20_000);

  it("the passphrase is never part of the stored data", async () => {
    const env = await new Vault(memoryKeys()).seal(SECRET, "passphrase", "hunter2-unique-phrase");
    expect(JSON.stringify(env)).not.toContain("hunter2");
  }, 20_000);

  it("is not interchangeable with device mode: a swapped mode label fails", async () => {
    const keys = memoryKeys();
    const v = new Vault(keys);
    const env = await v.seal(SECRET, "passphrase", "correct horse battery staple");
    expect(await code(v.open({ ...env, mode: "device" }))).toBe("key-lost");
  }, 20_000);
});

describe("envelope detection", () => {
  it("tells encrypted data from legacy plaintext settings", () => {
    expect(isEnvelope({ provider: "openai", apiKey: "sk-x" })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope({ v: 1, mode: "device", iv: "a", ct: "b" })).toBe(true);
  });
});
