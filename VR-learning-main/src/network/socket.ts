/**
 * Shared browser Socket.IO client.
 * Goal: connect each browser/headset to server.ts using its saved identity and
 * selected role. All real-time classroom systems import this same connection
 * to avoid duplicate multiplayer sockets.
 */

import {
  io
} from "socket.io-client";

const serverHost =
  window.location.hostname;



const socketServerUrl =
   `http://${serverHost}:3001`;

const urlParams =
  new URLSearchParams(
    window.location.search
  );

function readSavedUser(): {
  username: string;
  role: string;
} {
  const usernameFromUrl =
    urlParams
      .get("username")
      ?.trim();

  const savedUser =
    localStorage.getItem(
      "vrUser"
    );

  if (savedUser) {
    try {
      const parsed =
        JSON.parse(savedUser);

      return {
        username:
          usernameFromUrl ||
          parsed.username ||
          "student",

        role:
          parsed.role ===
          "instructor"
            ? "instructor"
            : "student"
      };
    } catch (error) {
      console.error(
        "[Socket] Invalid vrUser:",
        error
      );
    }
  }

  return {
    username:
      usernameFromUrl ||
      "student",

    role: "student"
  };
}

const currentUser =
  readSavedUser();

console.log(
  "[Socket] Connecting to:",
  socketServerUrl
);

console.log(
  "[Socket] Username:",
  currentUser.username
);

console.log(
  "[Socket] Role:",
  currentUser.role
);

export const socket = io(
  socketServerUrl,
  {
    autoConnect: false,
    transports: [
      "websocket",
      "polling"
    ],

    reconnection: true,
    reconnectionAttempts:
      Infinity,

    reconnectionDelay:
      1000,

    query: {
      username:
        currentUser.username,

      role:
        currentUser.role
    }
  }
);

export function connectSocketForUser(user: { username: string; role: string }): void {
  socket.io.opts.query = {
    username: user.username,
    role: user.role
  };

  if (socket.connected) {
    socket.disconnect();
  }

  socket.connect();
}

socket.on(
  "connect",
  () => {
    console.log(
      "[Socket] Connected:",
      socket.id
    );
  }
);

socket.on(
  "connect_error",
  error => {
    console.error(
      "[Socket] Connection error:",
      error.message
    );
  }
);

socket.on(
  "disconnect",
  reason => {
    console.warn(
      "[Socket] Disconnected:",
      reason
    );
  }
);
