type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const isProd = process.env.NODE_ENV === "production";
const envLevel = (process.env.LOG_LEVEL || "").toLowerCase() as LogLevel;
const defaultLevel: LogLevel = isProd ? "warn" : "info";
const currentLevel: LogLevel = ["debug", "info", "warn", "error", "silent"].includes(envLevel)
  ? envLevel
  : defaultLevel;

const rank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

function shouldLog(level: LogLevel): boolean {
  return rank[level] >= rank[currentLevel];
}

function serializeMeta(meta?: unknown): unknown {
  if (meta instanceof Error) {
    return {
      name: meta.name,
      message: meta.message,
      stack: isProd ? undefined : meta.stack,
    };
  }
  return meta;
}

export const logger = {
  debug(message: string, meta?: unknown) {
    if (!shouldLog("debug")) return;
    if (meta !== undefined) {
      console.debug(message, serializeMeta(meta));
      return;
    }
    console.debug(message);
  },
  info(message: string, meta?: unknown) {
    if (!shouldLog("info")) return;
    if (meta !== undefined) {
      console.info(message, serializeMeta(meta));
      return;
    }
    console.info(message);
  },
  warn(message: string, meta?: unknown) {
    if (!shouldLog("warn")) return;
    if (meta !== undefined) {
      console.warn(message, serializeMeta(meta));
      return;
    }
    console.warn(message);
  },
  error(message: string, meta?: unknown) {
    if (!shouldLog("error")) return;
    if (meta !== undefined) {
      console.error(message, serializeMeta(meta));
      return;
    }
    console.error(message);
  },
};
