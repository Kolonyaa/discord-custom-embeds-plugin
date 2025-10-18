function randomUint32(): number {
  return (Math.random() * 0x100000000) >>> 0;
}

function seedFromSecretAndIv(secret: string, iv: number): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < secret.length; i++) {
    h ^= secret.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= iv;
  h = Math.imul(h, 16777619) >>> 0;
  return h >>> 0;
}

function* xorshift32(seed: number): Generator<number> {
  let x = seed >>> 0;
  while (true) {
    x ^= (x << 13) >>> 0;
    x ^= (x >>> 17);
    x ^= (x << 5) >>> 0;
    x = x >>> 0;
    yield x;
  }
}

function getKeystream(secret: string, iv: number, length: number): Uint8Array {
  const seed = seedFromSecretAndIv(secret, iv);
  const gen = xorshift32(seed);
  const ks = new Uint8Array(length);
  
  for (let i = 0; i < length; i++) {
    // Get a new 32-bit value every 4 bytes
    if (i % 4 === 0) {
      const val = gen.next().value >>> 0;
      // Store the 4 bytes in little-endian order
      ks[i] = val & 0xff;
      if (i + 1 < length) ks[i + 1] = (val >>> 8) & 0xff;
      if (i + 2 < length) ks[i + 2] = (val >>> 16) & 0xff;
      if (i + 3 < length) ks[i + 3] = (val >>> 24) & 0xff;
    }
  }
  return ks;
}

export function scramble(text: string, secret: string): string {
  const encoder = new TextEncoder();
  const plain = encoder.encode(text);
  const iv = randomUint32();

  const ks = getKeystream(secret, iv, plain.length);
  const cipher = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i++) {
    cipher[i] = plain[i] ^ ks[i];
  }

  const combined = new Uint8Array(4 + cipher.length);
  // Write IV as big-endian
  combined[0] = (iv >>> 24) & 0xff;
  combined[1] = (iv >>> 16) & 0xff;
  combined[2] = (iv >>> 8) & 0xff;
  combined[3] = iv & 0xff;
  combined.set(cipher, 4);

  // Convert to base64
  let binary = '';
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  return btoa(binary);
}

export function unscramble(base64: string, secret: string): string {
  try {
    const binary = atob(base64);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      data[i] = binary.charCodeAt(i);
    }

    if (data.length < 4) throw new Error("Invalid data: too short");

    // Read IV as big-endian
    const iv = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
    const cipher = data.slice(4);

    const ks = getKeystream(secret, iv, cipher.length);
    const plain = new Uint8Array(cipher.length);
    for (let i = 0; i < cipher.length; i++) {
      plain[i] = cipher[i] ^ ks[i];
    }

    const decoder = new TextDecoder();
    return decoder.decode(plain);
  } catch (error) {
    console.error("[ObfuscationPlugin] Unscramble error:", error);
    throw error;
  }
}