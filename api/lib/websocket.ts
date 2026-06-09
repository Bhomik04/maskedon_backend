import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";
import { verify } from "jsonwebtoken";
import { isOriginAllowed } from "./allowed-origins";
import { logger } from "./logger";
import { getUnreadCount } from "../../dblayer/notification-queries";
import { getUnreadMessageCount } from "../../dblayer/messaging-queries";

const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET environment variable is required");
  return secret;
})();

interface AuthPayload {
  userId: string;
  username: string;
}

// Track connected users: userId -> Set of socket IDs
const connectedUsers = new Map<string, Set<string>>();

export function initWebSocket(httpServer: HTTPServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin(origin, callback) {
        if (isOriginAllowed(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Socket CORS blocked: origin is not allowed"));
      },
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
      methods: ["GET", "POST"],
    },
  });

  // Middleware to authenticate socket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication error: missing token"));
    }

    try {
      const decoded = verify(token, JWT_SECRET) as AuthPayload;
      socket.data.userId = decoded.userId;
      socket.data.username = decoded.username;
      next();
    } catch (error) {
      next(new Error("Authentication error: invalid token"));
    }
  });

  // ── Per-user connection rate limiting ──
  const MAX_CONNECTIONS_PER_USER = 5;

  // Connection handler
  io.on("connection", (socket: Socket) => {
    const userId = socket.data.userId as string;

    // Track connected users
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    const userSockets = connectedUsers.get(userId)!;

    // Reject excess connections from same user
    if (userSockets.size >= MAX_CONNECTIONS_PER_USER) {
      logger.warn(`WebSocket rate limit: user ${userId} exceeded max connections`);
      socket.disconnect(true);
      return;
    }

    userSockets.add(socket.id);

    logger.debug("WebSocket client connected", {
      userId,
      socketId: socket.id,
      totalUserConnections: userSockets.size,
    });

    // Send the current unread notification count immediately on connect so the
    // client can populate the bell badge without waiting for a new notification.
    getUnreadCount(userId)
      .then((count) => {
        socket.emit("notification:unread-count", { count });
      })
      .catch((err) => {
        logger.warn("Failed to fetch unread count on socket connect", err);
      });

    getUnreadMessageCount(userId)
      .then((count) => {
        socket.emit("message:unread-count", { count });
      })
      .catch((err) => {
        logger.warn("Failed to fetch unread message count on socket connect", err);
      });

    // Disconnect handler
    socket.on("disconnect", () => {
      const sockets = connectedUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          connectedUsers.delete(userId);
        }
      }
      logger.debug("WebSocket client disconnected", {
        userId,
        socketId: socket.id,
        remainingUserConnections: connectedUsers.get(userId)?.size || 0,
      });
    });

    // Error handler
    socket.on("error", (err: Error) => {
      logger.warn("WebSocket client error", err);
    });
  });

  return io;
}

/**
 * Emit a notification to a specific user via WebSocket
 * Falls back gracefully if user is not connected
 */
export function emitNotificationToUser(
  io: SocketIOServer,
  userId: string,
  notification: {
    id: string;
    type: string;
    title: string;
    body?: string;
    reference_id?: string;
    reference_type?: string;
  }
) {
  const userSockets = connectedUsers.get(userId);
  if (userSockets && userSockets.size > 0) {
    // Emit to all sockets of this user (in case they have multiple tabs open)
    userSockets.forEach((socketId) => {
      io.to(socketId).emit("notification:new", notification);
    });
    logger.debug("Notification emitted to connected client sockets");
  } else {
    logger.debug("Notification queued for offline user fetch");
  }
}

/**
 * Emit unread count update to a specific user
 * Useful when marking notifications as read/unread
 */
export function emitUnreadCountToUser(
  io: SocketIOServer,
  userId: string,
  count: number
) {
  const userSockets = connectedUsers.get(userId);
  if (userSockets && userSockets.size > 0) {
    userSockets.forEach((socketId) => {
      io.to(socketId).emit("notification:unread-count", { count });
    });
  }
}

export function emitMessageToUser(
  io: SocketIOServer,
  userId: string,
  message: {
    id: string;
    conversation_id: string;
    sender_id: string;
    body: string;
    created_at: Date;
    read_at: Date | null;
  }
) {
  const userSockets = connectedUsers.get(userId);
  if (userSockets && userSockets.size > 0) {
    userSockets.forEach((socketId) => {
      io.to(socketId).emit("message:new", message);
    });
  }
}

export function emitMessageUnreadCountToUser(
  io: SocketIOServer,
  userId: string,
  count: number
) {
  const userSockets = connectedUsers.get(userId);
  if (userSockets && userSockets.size > 0) {
    userSockets.forEach((socketId) => {
      io.to(socketId).emit("message:unread-count", { count });
    });
  }
}
