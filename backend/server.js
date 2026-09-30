import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import db from "./db.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

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

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});