// The site password for the beta. config.js carries the public API key encrypted with it (AES-GCM,
// the key drawn from the password with PBKDF2), so without the password the app can't reach the
// community at all. Pure: Web Crypto only.

export const fromB64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
export const toB64 = (u8) => btoa(String.fromCharCode(...u8));

export async function gateDerive(g, password) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(g.salt), iterations: g.iter }, base, 256);
  return new Uint8Array(bits);
}

export async function gateOpen(g, raw) {
  try {
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(g.iv) }, key, fromB64(g.ct));
    return new TextDecoder().decode(plain);
  } catch (_) { return null; }
}
