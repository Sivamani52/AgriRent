import "dotenv/config";
import express from "express";
import cors from "cors";
import db from "./db.js";
import equipmentMediaRoutes from "./routes/equipmentMediaRoutes.js";
import equipmentRoutes from "./routes/equipmentRoutes.js";
import equipmentCategoryRoutes from "./routes/equipmentCategoryRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { 
    checkPaymentVerificationTimeouts, 
    checkBookingAcceptanceTimeouts 
} from "./services/paymentTimeoutService.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", equipmentMediaRoutes);
app.use("/api", equipmentRoutes);
app.use("/api", equipmentCategoryRoutes);
app.use("/api", bookingRoutes);
app.use("/api", paymentRoutes);
app.use("/api", adminRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "AgriRent API is running",
  });
});

// Database check route
app.get("/api/db-check", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT 1 + 1 AS solution");
    res.json({ status: "success", message: "Database connected", solution: rows[0].solution });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// Global error handling middleware (handles Multer errors, validation errors, etc.)
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(err.status || 400).json({
    success: false,
    message: err.message || "An unexpected error occurred"
  });
});

const PORT = process.env.PORT || 5000;

const runTimeoutChecks = async () => {
    await checkPaymentVerificationTimeouts();
    await checkBookingAcceptanceTimeouts();
};

setInterval(runTimeoutChecks, 60 * 1000);
runTimeoutChecks();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
