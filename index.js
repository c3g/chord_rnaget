#!/usr/bin/env node

// Small service to forward CHORD-formatted events from Redis PubSub to a
// socket.io connections (e.g. a JavaScript front-end.)
// Author: David Lougheed <david.lougheed@mail.mcgill.ca>
// Copyright: Canadian Centre for Computational Genomics, 2019-2020

const http = require("http");
const redis = require("redis");
const socketIO = require("socket.io");

const pj = require("./package");

const SERVICE_TYPE = `ca.c3g.chord:event-relay:${pj.version}`;
const SERVICE_ID = process.env.SERVICE_ID || SERVICE_TYPE;

const SERVICE_INFO = {
    "id": SERVICE_ID,
    "name": "CHORD Event Relay",
    "type": SERVICE_TYPE,
    "description": "Event relay for a CHORD application.",
    "organization": {
        "name": "C3G",
        "url": "http://c3g.ca"
    },
    "contactUrl": "mailto:david.lougheed@mail.mcgill.ca",
    "version": pj.version
};

const SERVICE_URL_BASE_PATH = process.env.SERVICE_URL_BASE_PATH || "";

const SOCKET_IO_PATH = process.env.SOCKET_IO_PATH || "/socket.io";


const app = http.createServer((req, res) => {
    // Only respond to /service-info requests (to be CHORD-compatible)
    if (req.url === `${SERVICE_URL_BASE_PATH}/service-info`) {
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(JSON.stringify(SERVICE_INFO));
        return;
    }

    res.writeHead(404);
    res.end();
});

let socketID = 0;
const connections = {};

const io = socketIO(app, {path: `${SERVICE_URL_BASE_PATH}${SOCKET_IO_PATH}`});

// Whenever a client connects via socket.io, keep track of their connection until disconnect
io.on("connection", socket => {
    const newSocketID = socketID++;
    connections[newSocketID] = socket;
    socket.on("disconnect", () => delete connections[newSocketID]);
});

// Create a pub-sub client to listen for events
const client = redis.createClient(process.env.REDIS_SOCKET || {});

// Forward any message received to all currently-open socket.io connections
client.on("pmessage", (pattern, channel, message) => {
    // TODO: Filter message type in relay
    Object.values(connections).forEach(socket => {
        try {
            // Include channel in message data, since otherwise the information is lost on the receiving end.
            socket.emit("events", {...JSON.parse(message), channel});
        } catch (e) {
            console.error(`Encountered error while relaying message: ${e} (pattern: ${pattern}, channel: ${
                channel}, message: ${message})`);
        }
    });
});

// Subscribe to all incoming messages
client.psubscribe("chord.*");

// Listen on either a socket file (for production) or a development port
app.listen(process.env.SERVICE_SOCKET || 8080);

// Properly shut down (thus cleaning up any open socket files) when a signal is received
const shutdown = () => app.close(() => process.exit());
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
