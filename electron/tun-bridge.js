"use strict";

const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

function writeFrame(sock, type, body) {
  const h = Buffer.alloc(5);
  h[0] = type & 0xff;
  h.writeUInt32BE(body.length, 1);
  sock.write(Buffer.concat([h, body]));
}

function findNodePath() {
  if (process.env.LANBRIDGE_NODE) return process.env.LANBRIDGE_NODE;
  if (process.resourcesPath) {
    const bundledNode = path.join(process.resourcesPath, "node", "node.exe");
    if (fs.existsSync(bundledNode)) return bundledNode;
  }
  try {
    const out = execSync("where.exe node", { encoding: "utf8" });
    const line = out.split(/\r?\n/).find((l) => l.trim().length > 0);
    if (line) return line.trim();
  } catch (_) {}
  return "node";
}

function unpackedPath(filePath) {
  return filePath.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

/**
 * @param {{ adapterName: string, ip: string, prefix: number, onPacket: (buf: Buffer) => void }} opts
 */
function startTunBridge(opts) {
  return new Promise((resolve, reject) => {
    let settled = false;
    /** @type {import('child_process').ChildProcess | null} */
    let childRef = null;
    const server = net.createServer();
    const serviceJs = unpackedPath(path.join(__dirname, "tun-service.js"));

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        server.close();
      } catch (_) {}
      try {
        if (childRef) childRef.kill();
      } catch (_) {}
      reject(err);
    };

    const timer = setTimeout(() => {
      fail(new Error("tun-service connection timed out (is Node.js on PATH?)"));
    }, 20000);

    server.listen(0, "127.0.0.1", () => {
      const cport = /** @type {import('net').AddressInfo} */ (
        server.address()
      ).port;

      const nodePath = findNodePath();
      const env = Object.assign({}, process.env);
      const child = spawn(nodePath, [serviceJs, String(cport)], {
        env,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      childRef = child;

      let stderr = "";
      if (child.stderr) {
        child.stderr.on("data", (d) => {
          stderr += d.toString();
        });
      }

      child.on("exit", (code) => {
        if (!settled) {
          fail(
            new Error(
              `tun-service exited (${code}). ${stderr.trim() || "Ensure Node.js is on PATH (or set LANBRIDGE_NODE)."}`
            )
          );
        }
      });

      server.once("connection", (sock) => {
        server.close();

        let buf = Buffer.alloc(0);
        sock.on("data", (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          while (buf.length >= 5) {
            const t = buf[0];
            const len = buf.readUInt32BE(1);
            if (buf.length < 5 + len) return;
            const body = buf.subarray(5, 5 + len);
            buf = buf.subarray(5 + len);

            if (t === 0) {
              let j;
              try {
                j = JSON.parse(body.toString("utf8"));
              } catch {
                continue;
              }
              if (j.ok === true && !settled) {
                settled = true;
                clearTimeout(timer);
                resolve(makeApi(sock, child));
              } else if (j.ok === false && !settled) {
                try {
                  sock.destroy();
                } catch (_) {}
                try {
                  child.kill();
                } catch (_) {}
                fail(new Error(j.error || "WinTun start failed"));
              }
              continue;
            }

            if (t === 2) {
              opts.onPacket(body);
            }
          }
        });

        sock.on("error", (err) => {
          if (!settled) fail(err);
        });

        writeFrame(
          sock,
          0,
          Buffer.from(
            JSON.stringify({
              cmd: "start",
              adapterName: opts.adapterName,
              ip: opts.ip,
              prefix: opts.prefix,
            })
          )
        );
      });
    });

    server.on("error", fail);
  });
}

/**
 * @param {import('net').Socket} sock
 * @param {import('child_process').ChildProcess} child
 */
function makeApi(sock, child) {
  return {
    send: (packet) => writeFrame(sock, 1, packet),
    stop: () => {
      try {
        writeFrame(
          sock,
          0,
          Buffer.from(JSON.stringify({ cmd: "stop" }))
        );
      } catch (_) {}
      try {
        sock.destroy();
      } catch (_) {}
      try {
        child.kill();
      } catch (_) {}
    },
  };
}

module.exports = { startTunBridge, findNodePath };
