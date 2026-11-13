// QuickNode Streams webhook signature check. QuickNode signs every delivery with the Stream's
// security token: X-QN-Signature = hex(HMAC-SHA256(token, nonce + timestamp + body)), where body
// is the uncompressed JSON text. Headers: X-QN-Nonce, X-QN-Timestamp, X-QN-Signature.

import { createHmac, timingSafeEqual } from "node:crypto";

export function signStreamsPayload(secret: string, nonce: string, timestamp: string, body: string): string {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(nonce + timestamp + body, "utf8").digest("hex");
}

export function verifyStreamsSignature(
  secret: string,
  headers: { nonce: string | null; timestamp: string | null; signature: string | null },
  body: string,
): boolean {
  const { nonce, timestamp, signature } = headers;
  if (!nonce || !timestamp || !signature || !/^[0-9a-f]+$/i.test(signature)) return false;
  const expected = Buffer.from(signStreamsPayload(secret, nonce, timestamp, body), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
