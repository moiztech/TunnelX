"use strict";

const { startLanBridgeServer, DEFAULT_HTTP, DEFAULT_UDP } = require("./app.js");

const HTTP_PORT = Number(process.env.LANBRIDGE_HTTP_PORT || DEFAULT_HTTP);
const UDP_PORT = Number(process.env.LANBRIDGE_UDP_PORT || DEFAULT_UDP);

startLanBridgeServer({ httpPort: HTTP_PORT, udpPort: UDP_PORT, quiet: false }).catch(
  (err) => {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  }
);
