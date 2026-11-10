"use strict";
function toBigIntBE(bytes) {
  const hex = Buffer.from(bytes).toString("hex");
  return hex ? BigInt(`0x${hex}`) : 0n;
}
function toBigIntLE(bytes) { return toBigIntBE(Buffer.from(bytes).reverse()); }
function toBufferBE(value, width) {
  if (!Number.isSafeInteger(width) || width < 0 || width > 65536) throw new RangeError("Invalid buffer width");
  if (typeof value !== "bigint" || value < 0n || value >= (1n << BigInt(width * 8))) throw new RangeError("Integer does not fit buffer");
  return width ? Buffer.from(value.toString(16).padStart(width * 2, "0"), "hex") : Buffer.alloc(0);
}
function toBufferLE(value, width) { return toBufferBE(value, width).reverse(); }
module.exports = { toBigIntBE, toBigIntLE, toBufferBE, toBufferLE };
