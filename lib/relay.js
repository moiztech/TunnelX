"use strict";

const MAGIC_APP = Buffer.from("LANB");
const MAGIC_IP4 = Buffer.from("LANT");

function normalizeRoomId(roomId) {
  return String(roomId).replace(/-/g, "").toLowerCase();
}

/**
 * @param {"APP"|"IP4"} kind APP = legacy payload; IP4 = raw IPv4 packet from WinTun
 * @param {string} roomId UUID
 * @param {Buffer} payload
 */
function build(kind, roomId, payload) {
  const magic = kind === "IP4" ? MAGIC_IP4 : MAGIC_APP;
  const hex = normalizeRoomId(roomId);
  const roomBuf = Buffer.from(hex, "hex");
  if (roomBuf.length !== 16) throw new Error("Invalid room id");
  return Buffer.concat([magic, roomBuf, Buffer.from(payload)]);
}

/**
 * @param {Buffer} msg
 * @returns {{ kind: "APP"|"IP4", roomHex: string, payload: Buffer } | null}
 */
function parse(msg) {
  for (const [kind, magic] of [
    ["APP", MAGIC_APP],
    ["IP4", MAGIC_IP4],
  ]) {
    if (
      msg.length >= magic.length + 16 &&
      msg.subarray(0, magic.length).equals(magic)
    ) {
      return {
        kind,
        roomHex: msg.subarray(magic.length, magic.length + 16).toString("hex"),
        payload: msg.subarray(magic.length + 16),
      };
    }
  }
  return null;
}

function isIPv4Packet(buf) {
  return buf && buf.length >= 20 && (buf[0] >> 4) === 4;
}

module.exports = { build, parse, normalizeRoomId, isIPv4Packet };
