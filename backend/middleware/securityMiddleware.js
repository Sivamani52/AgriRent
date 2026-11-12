import cors from "cors";

const DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173"
];

/**
 * Builds CORS middleware using CORS_ORIGINS env var (comma-separated) or React dev defaults.
 */
export const createCorsMiddleware = () => {
    const envOrigins = (process.env.CORS_ORIGINS || "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);

    const allowedOrigins = envOrigins.length > 0 ? envOrigins : DEFAULT_ALLOWED_ORIGINS;
    const allowAll = allowedOrigins.includes("*");

    return cors({
        origin(origin, callback) {
            // Allow same-origin / non-browser clients (Postman, curl, mobile apps, automated tests)
            if (!origin) {
                return callback(null, true);
            }
            if (allowAll || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            const err = new Error(`CORS policy blocked origin: ${origin}`);
            err.statusCode = 403;
            return callback(err, false);
        },
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
        maxAge: 86400
    });
};

/**
 * Sets baseline HTTP security headers without altering JSON/API behavior.
 */
export const securityHeaders = (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-XSS-Protection", "0");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    next();
};

/**
 * Lightweight sliding-window in-memory rate limiter for Express routes.
 */
export const createRateLimiter = ({
    windowMs = 15 * 60 * 1000,
    max = 30,
    message = "Too many requests. Please try again later."
} = {}) => {
    const hits = new Map();

    // Periodic cleanup of expired buckets to keep memory bounded
    const cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits.entries()) {
            if (entry.resetAt <= now) {
                hits.delete(key);
            }
        }
    }, Math.max(windowMs, 60 * 1000));

    if (typeof cleanupTimer.unref === "function") {
        cleanupTimer.unref();
    }

    return (req, res, next) => {
        const effectiveMax = Number(process.env.RATE_LIMIT_MAX_OVERRIDE || max);
        const ip = req.ip || req.socket?.remoteAddress || "unknown";
        const key = `${ip}:${req.baseUrl}${req.path}`;
        const now = Date.now();

        let entry = hits.get(key);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            hits.set(key, entry);
        }

        entry.count += 1;

        const remaining = Math.max(effectiveMax - entry.count, 0);
        const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);

        res.setHeader("X-RateLimit-Limit", String(effectiveMax));
        res.setHeader("X-RateLimit-Remaining", String(remaining));
        res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

        if (entry.count > effectiveMax) {
            res.setHeader("Retry-After", String(Math.max(retryAfterSeconds, 1)));
            return res.status(429).json({
                success: false,
                message
            });
        }

        next();
    };
};

