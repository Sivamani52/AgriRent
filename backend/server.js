import "./config/env.js";
import express from "express";
import multer from "multer";
import db from "./db.js";
import authRoutes from "./routes/authRoutes.js";
import locationRoutes from "./routes/locationRoutes.js";
import userManagementRoutes from "./routes/userManagementRoutes.js";
import equipmentMediaRoutes from "./routes/equipmentMediaRoutes.js";
import equipmentRoutes from "./routes/equipmentRoutes.js";
import equipmentCategoryRoutes from "./routes/equipmentCategoryRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import inspectionRoutes from "./routes/inspectionRoutes.js";
import {
    createCorsMiddleware,
    securityHeaders,
    createRateLimiter
} from "./middleware/securityMiddleware.js";
import {
    checkPaymentVerificationTimeouts,
    checkBookingAcceptanceTimeouts,
    cleanExpiredOTPs,
    runWithLock
} from "./services/paymentTimeoutService.js";
import {
    checkInspectionMediaCleanupTimeouts
} from "./services/mediaCleanupService.js";

const app = express();

app.disable("x-powered-by");
app.use(securityHeaders);
app.use(createCorsMiddleware());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Rate limiting for sensitive authentication and OTP endpoints
const authRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: "Too many authentication requests. Please wait and try again."
});

const otpRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: "Too many OTP or password reset requests. Please try again later."
});

app.use("/api/auth/login", authRateLimiter);
app.use("/api/auth/register", authRateLimiter);
app.use("/api/auth/change-password", authRateLimiter);
app.use("/api/auth/otp", otpRateLimiter);
app.use("/api/auth/password-reset", otpRateLimiter);

app.use("/api", authRoutes);
app.use("/api", locationRoutes);
app.use("/api", userManagementRoutes);
app.use("/api", equipmentMediaRoutes);
app.use("/api", equipmentRoutes);
app.use("/api", equipmentCategoryRoutes);
app.use("/api", bookingRoutes);
app.use("/api", paymentRoutes);
app.use("/api", adminRoutes);
app.use("/api", inspectionRoutes);

app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "AgriRent API is running"
    });
});

app.get("/api/health", (req, res) => {
    res.status(200).json({
        success: true,
        message: "AgriRent API is healthy",
        data: {
            uptimeSeconds: Math.floor(process.uptime()),
            timestamp: new Date().toISOString()
        }
    });
});

// Database check route
app.get("/api/db-check", async (req, res) => {
    try {
        const [rows] = await db.query("SELECT 1 + 1 AS solution");
        res.status(200).json({
            success: true,
            status: "success",
            message: "Database connected",
            solution: rows[0].solution
        });
    } catch (error) {
        console.error("DB health check error:", error.message || error);
        res.status(500).json({
            success: false,
            status: "error",
            message: "Database connection failed"
        });
    }
});

// JSON 404 catch-all handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`
    });
});

// Global error handling middleware (handles JSON parse errors, Multer errors, CORS errors, etc.)
app.use((err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    if (err instanceof multer.MulterError) {
        let message = err.message || "File upload error";
        if (err.code === "LIMIT_FILE_SIZE") {
            message = "Uploaded file exceeds the 50MB size limit";
        } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
            message = "Unexpected file upload field or file count exceeded";
        }
        return res.status(400).json({
            success: false,
            message
        });
    }

    if (err?.type === "entity.parse.failed") {
        return res.status(400).json({
            success: false,
            message: "Invalid JSON request payload"
        });
    }

    const statusCode = err?.statusCode || err?.status || 500;
    console.error("Server error:", err);

    const isProduction = process.env.NODE_ENV === "production";
    const safeMessage =
        statusCode >= 500 && isProduction
            ? "An unexpected internal server error occurred"
            : statusCode >= 500 && !err?.expose
            ? "An unexpected internal server error occurred"
            : err?.message || "Request failed";

    return res.status(statusCode).json({
        success: false,
        message: safeMessage
    });
});

const PORT = process.env.PORT !== undefined && process.env.PORT !== ""
    ? Number(process.env.PORT)
    : 5000;

let isRunningTimeoutChecks = false;

const runTimeoutChecks = async () => {
    if (isRunningTimeoutChecks) {
        return;
    }
    isRunningTimeoutChecks = true;
    try {
        await runWithLock("agrirent_cron_lock", 0, async () => {
            await checkPaymentVerificationTimeouts();
            await checkBookingAcceptanceTimeouts();
            await checkInspectionMediaCleanupTimeouts();
            await cleanExpiredOTPs();
        });
    } catch (error) {
        console.error("Timeout scheduler error:", error.message || error);
    } finally {
        isRunningTimeoutChecks = false;
    }
};

if (process.env.DISABLE_SCHEDULER !== "true") {
    const schedulerInterval = setInterval(runTimeoutChecks, 60 * 1000);
    if (typeof schedulerInterval.unref === "function") {
        schedulerInterval.unref();
    }
    runTimeoutChecks();
}

const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

export { app, server };
