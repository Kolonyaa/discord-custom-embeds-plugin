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
  let i = 0;
  while (i < length) {
    const val = gen.next().value >>> 0;
    ks[i++] = val & 0xff;
    if (i >= length) break;
    ks[i++] = (val >>> 8) & 0xff;
    if (i >= length) break;
    ks[i++] = (val >>> 16) & 0xff;
    if (i >= length) break;
    ks[i++] = (val >>> 24) & 0xff;
  }
  return ks;
}

export function scramble(text: string, secret: string): string {
  const encoder = new TextEncoder();
  const plain = encoder.encode(text);
  const iv = randomUint32();

  const ks = getKeystream(secret, iv, plain.length);
  const cipher = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i++) cipher[i] = plain[i] ^ ks[i];

  const combined = new Uint8Array(4 + cipher.length);
  combined[0] = (iv >>> 24) & 0xff;
  combined[1] = (iv >>> 16) & 0xff;
  combined[2] = (iv >>> 8) & 0xff;
  combined[3] = iv & 0xff;
  combined.set(cipher, 4);

  // Use URL-safe base64 without padding
  let base64 = btoa(String.fromCharCode(...combined));
  base64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return base64;
}

export function unscramble(base64: string, secret: string): string {
  // Convert back from URL-safe base64
  base64 = base64.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  
  const raw = atob(base64);
  const data = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);

  if (data.length < 4) throw new Error("Invalid data");

  const iv = ((data[0] << 24) >>> 0) | (data[1] << 16) | (data[2] << 8) | data[3];
  const cipher = data.slice(4);

  const ks = getKeystream(secret, iv, cipher.length);
  const plain = new Uint8Array(cipher.length);
  for (let i = 0; i < cipher.length; i++) plain[i] = cipher[i] ^ ks[i];

  const decoder = new TextDecoder();
  return decoder.decode(plain);
}