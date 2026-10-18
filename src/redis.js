const { createClient } = require("redis");

const redis = createClient({
  url: process.env.REDIS_URL || "redis://127.0.0.1:6379"
});

redis.on("error", (error) => {
  console.error("[redis] Client error:", error.message);
});

module.exports = redis;
