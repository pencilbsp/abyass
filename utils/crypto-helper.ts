interface Algorithm {
  name: string;
}

interface AesCtrParams extends Algorithm {
  length: number;
  counter: BufferSource;
}

export class CryptoHelper {
  private textEncoder: TextEncoder;
  private key: CryptoKey | null = null;
  private algorithm: AesCtrParams = {
    name: "AES-CTR",
    length: 128,
    counter: new Uint8Array(16),
  };

  constructor() {
    this.textEncoder = new TextEncoder();
  }

  async expandKey(keyHex: string) {
    const keyBytes = this.textEncoder.encode(keyHex);
    this.algorithm.counter = new Uint8Array(keyBytes.slice(0, 16));

    try {
      this.key = await crypto.subtle.importKey("raw", keyBytes, this.algorithm, false, ["encrypt", "decrypt"]);
      return true;
    } catch (error) {
      return false;
    }
  }

  async encrypt(data: string | Uint8Array) {
    if (!this.key) {
      throw new Error("Key not initialized");
    }

    const dataBytes = typeof data === "string" ? this.textEncoder.encode(data) : data;
    const encrypted = await crypto.subtle.encrypt(this.algorithm, this.key, dataBytes);
    return Array.from(new Uint8Array(encrypted))
      .map((b) => String.fromCharCode(b))
      .join("");
  }

  async decrypt(data: string | Uint8Array) {
    if (!this.key) {
      throw new Error("Key not initialized");
    }

    if (typeof data === "string") {
      const dataBytes = atob(data);
      const uint8Array = new Uint8Array((dataBytes.match(/[\s\S]/g) || []).map((char: string) => char.charCodeAt(0)));
      const decrypted = await crypto.subtle.decrypt(this.algorithm, this.key, uint8Array);
      return new TextDecoder().decode(decrypted);
    }

    const decrypted = await crypto.subtle.decrypt(this.algorithm, this.key, data);
    return new Uint8Array(decrypted);
  }
}
