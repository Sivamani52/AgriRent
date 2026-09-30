import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

// Create MySQL connection pool
const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "agrirent",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Function to test the database connection
export const testConnection = async () => {
  try {
    const connection = await db.getConnection();
    console.log(`✅ MySQL connected successfully to database: "${process.env.DB_NAME || "agrirent"}"`);
    connection.release();
    return true;
  } catch (error) {
    console.warn(`⚠️ MySQL connection error: ${error.message}`);
    console.warn(`💡 Check MySQL service status and your credentials in backend/.env`);
    return false;
  }
};

// Test connection on load
testConnection();

export { db };
export default db;
