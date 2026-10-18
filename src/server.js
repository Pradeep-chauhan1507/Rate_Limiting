require("dotenv").config();

const express = require("express");
const path = require("path");
const redis = require("./redis");
const { rateLimiter, LIMIT, WINDOW_SECONDS, getClientKey } = require("./rateLimiter");

const app = express();
const PORT = Number.parseInt(process.env.PORT || "3000", 10);

app.disable("x-powered-by");
// Only enable trust proxy after configuring the exact trusted proxy for deployment.
// Example: app.set("trust proxy", 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", async (req, res) => {
  try {
    const pong = await redis.ping();
    res.json({
      success: true,
      server: "connected",
      redis: pong === "PONG" ? "connected" : "unknown",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      server: "connected",
      redis: "disconnected",
      message: "Cannot reach Redis."
    });
  }
});

app.get("/api/config", (req, res) => {
  res.json({
    limit: LIMIT,
    windowSeconds: WINDOW_SECONDS,
    endpoint: "GET /api/test",
    clientKey: "IP address",
    algorithm: "Fixed window counter (Redis + atomic Lua script)"
  });
});

// This is the demo endpoint protected by the rate limiter.
app.get("/api/test", rateLimiter, (req, res) => {
  res.status(200).json({
    success: true,
    message: "Request successful",
    limit: req.rateLimit.limit,
    remaining: req.rateLimit.remaining,
    resetAfter: req.rateLimit.resetAfter,
    requestNumberInWindow: req.rateLimit.count,
    timestamp: new Date().toISOString()
  });
});

// Status endpoint is deliberately NOT rate-limited and does NOT consume quota.
app.get("/api/status", async (req, res) => {
  try {
    const key = `rate-limit:${getClientKey(req)}`;
    const [countValue, ttlValue] = await Promise.all([
      redis.get(key),
      redis.ttl(key)
    ]);
    const count = Number(countValue || 0);
    const ttl = Math.max(0, Number(ttlValue || 0));
    const used = Math.min(count, LIMIT);

    res.json({
      success: true,
      limit: LIMIT,
      used,
      remaining: Math.max(0, LIMIT - count),
      windowSeconds: WINDOW_SECONDS,
      retryAfter: count >= LIMIT ? ttl : 0,
      cooldownActive: count >= LIMIT && ttl > 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({ success: false, message: "Unable to read rate-limit status." });
  }
});

app.get("/api", (req, res) => {
  res.json({
    name: "Rate Limiter Tester API",
    endpoints: {
      health: "GET /api/health",
      config: "GET /api/config",
      status: "GET /api/status",
      test: "GET /api/test (rate limited)"
    },
    documentation: "See README.md"
  });
});

async function start() {
  try {
    await redis.connect();
    console.log("[redis] Connected");
    app.listen(PORT, () => {
      console.log(`Rate Limiter Tester running at http://localhost:${PORT}`);
      console.log(`Limit: ${LIMIT} requests per ${WINDOW_SECONDS} seconds per client IP`);
    });
  } catch (error) {
    console.error("[startup] Could not connect to Redis:", error.message);
    console.error("Start Redis and check REDIS_URL in your .env file, then run npm start again.");
    process.exit(1);
  }
}

async function shutdown() {
  console.log("\nShutting down...");
  try {
    if (redis.isOpen) await redis.quit();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
