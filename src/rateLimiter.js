const redis = require("./redis");

const LIMIT = Math.max(1, Number.parseInt(process.env.RATE_LIMIT_MAX || "5", 10));
const WINDOW_SECONDS = Math.max(1, Number.parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS || "10", 10));

// The Lua script runs atomically in Redis, so concurrent requests cannot race
// between incrementing the counter and setting the first-window expiration.
const consumeRequestScript = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
if ttl < 0 then ttl = tonumber(ARGV[1]) end
return {current, ttl}
`;

function getClientKey(req) {
  // Express's req.ip is used rather than trusting arbitrary X-Forwarded-For
  // headers. Configure app.set('trust proxy', ...) only behind a trusted proxy.
  return req.ip || req.socket.remoteAddress || "unknown";
}

function rateLimiter(req, res, next) {
  const key = `rate-limit:${getClientKey(req)}`;

  redis.eval(consumeRequestScript, {
    keys: [key],
    arguments: [String(WINDOW_SECONDS)]
  }).then(([countValue, ttlValue]) => {
    const count = Number(countValue);
    const ttl = Math.max(0, Number(ttlValue));

    res.set({
      "RateLimit-Limit": String(LIMIT),
      "RateLimit-Remaining": String(Math.max(0, LIMIT - count)),
      "RateLimit-Reset": String(ttl)
    });

    if (count > LIMIT) {
      res.set("Retry-After", String(ttl));
      return res.status(429).json({
        success: false,
        error: "RATE_LIMIT_EXCEEDED",
        message: "Rate limit exceeded. Please wait before retrying.",
        limit: LIMIT,
        remaining: 0,
        retryAfter: ttl,
        windowSeconds: WINDOW_SECONDS,
        timestamp: new Date().toISOString()
      });
    }

    req.rateLimit = {
      limit: LIMIT,
      remaining: Math.max(0, LIMIT - count),
      resetAfter: ttl,
      count
    };
    next();
  }).catch((error) => {
    console.error("[rate-limit] Redis operation failed:", error.message);
    // Fail closed: do not accidentally allow unlimited traffic if Redis is down.
    res.status(503).json({
      success: false,
      error: "RATE_LIMITER_UNAVAILABLE",
      message: "The rate limiter is temporarily unavailable. Please try again shortly."
    });
  });
}

module.exports = { rateLimiter, LIMIT, WINDOW_SECONDS, getClientKey };
