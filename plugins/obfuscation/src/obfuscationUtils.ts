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

// Braille pattern utilities using ALL 256 characters
function bytesToBraille(data: Uint8Array): string {
  let result = '';
  
  for (let i = 0; i < data.length; i++) {
    // Each byte directly maps to one Braille character (0x2800 - 0x28FF)
    const brailleChar = String.fromCharCode(0x2800 + data[i]);
    result += brailleChar;
  }
  
  return result;
}

function brailleToBytes(brailleStr: string): Uint8Array {
  const result = new Uint8Array(brailleStr.length);
  
  for (let i = 0; i < brailleStr.length; i++) {
    const brailleChar = brailleStr.charAt(i);
    const brailleCode = brailleChar.charCodeAt(0) - 0x2800;
    
    if (brailleCode < 0 || brailleCode > 255) {
      throw new Error("Invalid Braille character");
    }
    
    result[i] = brailleCode;
  }
  
  return result;
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

  // Use Braille encoding instead of Base64
  return bytesToBraille(combined);
}

export function unscramble(brailleStr: string, secret: string): string {
  // Convert Braille back to bytes
  const combined = brailleToBytes(brailleStr);

  if (combined.length < 4) throw new Error("Invalid data");

  const iv = ((combined[0] << 24) >>> 0) | (combined[1] << 16) | (combined[2] << 8) | combined[3];
  const cipher = combined.slice(4);

  const ks = getKeystream(secret, iv, cipher.length);
  const plain = new Uint8Array(cipher.length);
  for (let i = 0; i < cipher.length; i++) plain[i] = cipher[i] ^ ks[i];

  const decoder = new TextDecoder();
  return decoder.decode(plain);
}

export function scrambleBuffer(data: Uint8Array, secret: string): string {
  const iv = randomUint32();
  const ks = getKeystream(secret, iv, data.length);
  
  const cipher = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) cipher[i] = data[i] ^ ks[i];

  const combined = new Uint8Array(4 + cipher.length);
  combined[0] = (iv >>> 24) & 0xff;
  combined[1] = (iv >>> 16) & 0xff;
  combined[2] = (iv >>> 8) & 0xff;
  combined[3] = iv & 0xff;
  combined.set(cipher, 4);

  return bytesToBraille(combined);
}

export function unscrambleBuffer(brailleStr: string, secret: string): Uint8Array {
  const combined = brailleToBytes(brailleStr);
  if (combined.length < 4) throw new Error("Invalid data");

  const iv = ((combined[0] << 24) >>> 0) | (combined[1] << 16) | (combined[2] << 8) | combined[3];
  const cipher = combined.slice(4);

  const ks = getKeystream(secret, iv, cipher.length);
  const plain = new Uint8Array(cipher.length);
  for (let i = 0; i < cipher.length; i++) plain[i] = cipher[i] ^ ks[i];

  return plain;
}