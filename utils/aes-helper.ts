import md5 from "md5";

/**
 * Minimal recreation of the `_0x5a3694` helper from core.bundle.js.
 * - Derives AES-CTR key from md5(keySeed) (hex string, utf8-encoded)
 * - Uses first 16 bytes of that utf8 hash as counter
 * - Supports encrypt/decrypt for strings and Uint8Array
 */
export class AesCtrHelper {
  private key: CryptoKey | null = null;
  private algorithm: AesCtrParams = {
    name: "AES-CTR",
    length: 128,
    counter: new Uint8Array(16),
  };
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  /**
   * Expand key from keySeed (md5 hex) and prepare counter.
   * Returns false if keySeed is empty or import fails.
   */
  async expandKey(keySeed: any): Promise<boolean> {
    if (!keySeed) return false;

    const keyBytes = this.encoder.encode(md5(keySeed));
    this.algorithm.counter = new Uint8Array(keyBytes.slice(0, 16));

    try {
      this.key = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        this.algorithm,
        false,
        ["encrypt", "decrypt"]
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Encrypt plain text/bytes; returns unchanged input if key is missing.
   */
  async encrypt(
    data: string | Uint8Array<ArrayBuffer>
  ): Promise<string | Uint8Array<ArrayBuffer>> {
    if (!data || !this.key) return data;
    const bytes = typeof data === "string" ? this.encoder.encode(data) : data;
    const encrypted = await crypto.subtle.encrypt(
      this.algorithm,
      this.key,
      bytes
    );
    return Array.from(new Uint8Array(encrypted))
      .map((b) => String.fromCharCode(b))
      .join("");
  }

  /**
   * Decrypt a string (binary form) or Uint8Array. Strings are treated as raw char codes.
   */
  async decrypt(
    data: string | Uint8Array<ArrayBuffer>
  ): Promise<string | Uint8Array<ArrayBuffer>> {
    if (!data || !this.key) return data;
    if (typeof data === "string") {
      return this.decryptString(data);
    }
    const decrypted = await crypto.subtle.decrypt(
      this.algorithm,
      this.key,
      data
    );
    return new Uint8Array(decrypted);
  }

  private async decryptString(data: string): Promise<string> {
    if (!this.key) return data;

    const bytes = new Uint8Array(
      (data.match(/[\s\S]/g) || []).map((ch) => ch.charCodeAt(0))
    );
    const decrypted = await crypto.subtle.decrypt(
      this.algorithm,
      this.key,
      bytes
    );
    return this.decoder.decode(decrypted);
  }
}
