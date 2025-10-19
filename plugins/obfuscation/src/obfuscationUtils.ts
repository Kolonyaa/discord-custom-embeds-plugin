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

// Braille pattern utilities
function bytesToBraille(data: Uint8Array): string {
  let result = '';
  
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    
    // Each byte becomes 4 Braille characters (2 bits per Braille char)
    for (let j = 0; j < 4; j++) {
      const twoBits = (byte >> (6 - j * 2)) & 0x03;
      
      // Map 2-bit patterns to Braille (using the first 4 patterns: ⠀⠁⠂⠃)
      // Braille Unicode range: U+2800 to U+28FF
      const brailleChar = String.fromCharCode(0x2800 + twoBits);
      result += brailleChar;
    }
  }
  
  return result;
}

function brailleToBytes(brailleStr: string): Uint8Array {
  const byteCount = brailleStr.length / 4;
  if (!Number.isInteger(byteCount)) {
    throw new Error("Invalid Braille string length");
  }
  
  const result = new Uint8Array(byteCount);
  
  for (let i = 0; i < byteCount; i++) {
    let byte = 0;
    
    for (let j = 0; j < 4; j++) {
      const brailleChar = brailleStr.charAt(i * 4 + j);
      const brailleCode = brailleChar.charCodeAt(0) - 0x2800;
      
      if (brailleCode < 0 || brailleCode > 3) {
        throw new Error("Invalid Braille character");
      }
      
      byte = (byte << 2) | brailleCode;
    }
    
    result[i] = byte;
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