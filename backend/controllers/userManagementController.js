import bcrypt from "bcryptjs";
import pool from "../db.js";
import { isValidEmail } from "../services/emailService.js";
import { sendRegistrationConfirmationEmail } from "../services/notificationService.js";
import { parsePositiveInt } from "../utils/responseHelper.js";

const PHONE_REGEX = /^[6-9]\d{9}$/;
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

/**
 * Super Admin creates a new Area Admin account assigned to a location.
 * POST /api/admin/super/area-admins
 * Access: SUPER_ADMIN only
 */
export const createAreaAdmin = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { full_name, phone, email, password, location_id } = req.body;

        if (!full_name || !phone || !email || !password || !location_id) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "full_name, phone, email, password, and location_id are required"
            });
        }

        const trimmedName = String(full_name).trim();
        const trimmedPhone = String(phone).trim();
        const trimmedEmail = String(email).trim().toLowerCase();
        const locationId = parsePositiveInt(location_id);

        if (trimmedName.length < 2 || trimmedName.length > 100) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "Full name must be between 2 and 100 characters"
            });
        }

        if (!PHONE_REGEX.test(trimmedPhone)) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "Please enter a valid 10-digit Indian mobile number"
            });
        }

        if (!isValidEmail(trimmedEmail)) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "Please enter a valid email address"
            });
        }

        if (!STRONG_PASSWORD_REGEX.test(password)) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters and include uppercase, lowercase, and a number"
            });
        }

        if (!locationId) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "Invalid location_id"
            });
        }

        const [locations] = await connection.query(
            "SELECT id, state, district, mandal, village FROM locations WHERE id = ?",
            [locationId]
        );
        if (locations.length === 0) {
            connection.release();
            return res.status(404).json({
                success: false,
                message: "Location not found"
            });
        }

        const [existingUsers] = await connection.query(
            "SELECT id, phone, email FROM users WHERE phone = ? OR email = ?",
            [trimmedPhone, trimmedEmail]
        );
        if (existingUsers.length > 0) {
            connection.release();
            const conflict = existingUsers[0].phone === trimmedPhone ? "phone number" : "email address";
            return res.status(409).json({
                success: false,
                message: `An account with this ${conflict} already exists`
            });
        }

        await connection.beginTransaction();

        const passwordHash = await bcrypt.hash(password, 10);

        const [userResult] = await connection.query(
            `INSERT INTO users (full_name, phone, email, password_hash, role, status)
             VALUES (?, ?, ?, ?, 'AREA_ADMIN', 'ACTIVE')`,
            [trimmedName, trimmedPhone, trimmedEmail, passwordHash]
        );
        const userId = userResult.insertId;

        const [aaResult] = await connection.query(
            `INSERT INTO area_admins (user_id, location_id)
             VALUES (?, ?)`,
            [userId, locationId]
        );

        await connection.commit();

        sendRegistrationConfirmationEmail({
            email: trimmedEmail,
            name: trimmedName,
            role: "AREA_ADMIN"
        }).catch((err) => console.error("Area Admin welcome email error:", err));

        return res.status(201).json({
            success: true,
            message: "Area Admin created successfully",
            data: {
                areaAdminId: aaResult.insertId,
                userId,
                fullName: trimmedName,
                phone: trimmedPhone,
                email: trimmedEmail,
                role: "AREA_ADMIN",
                status: "ACTIVE",
                location: locations[0]
            }
        });
    } catch (error) {
        try {
            await connection.rollback();
        } catch {
            // ignore rollback error when transaction wasn't started
        }
        console.error("Create Area Admin error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to create Area Admin"
        });
    } finally {
        connection.release();
    }
};

/**
 * List all Area Admins with their assigned locations.
 * GET /api/admin/super/area-admins
 * Access: SUPER_ADMIN only
 */
export const getAreaAdmins = async (req, res) => {
    try {
        const { location_id, status } = req.query;

        let query = `
            SELECT
                aa.id AS area_admin_id,
                aa.user_id,
                aa.location_id,
                aa.created_at,
                u.full_name,
                u.phone,
                u.email,
                u.status,
                l.state,
                l.district,
                l.mandal,
                l.panchayat,
                l.village
            FROM area_admins aa
            JOIN users u ON aa.user_id = u.id
            JOIN locations l ON aa.location_id = l.id
            WHERE 1=1
        `;
        const values = [];

        if (location_id) {
            const locId = parsePositiveInt(location_id);
            if (!locId) {
                return res.status(400).json({ success: false, message: "Invalid location_id" });
            }
            query += " AND aa.location_id = ?";
            values.push(locId);
        }

        if (status) {
            query += " AND u.status = ?";
            values.push(String(status).toUpperCase());
        }

        query += " ORDER BY aa.created_at DESC";

        const [rows] = await pool.query(query, values);

        return res.status(200).json({
            success: true,
            message: "Area Admins fetched successfully",
            count: rows.length,
            data: rows
        });
    } catch (error) {
        console.error("Get Area Admins error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch Area Admins"
        });
    }
};

/**
 * Reassign an Area Admin to another location.
 * PATCH /api/admin/super/area-admins/:areaAdminId/location
 * Access: SUPER_ADMIN only
 */
export const updateAreaAdminLocation = async (req, res) => {
    try {
        const areaAdminId = parsePositiveInt(req.params.areaAdminId);
        const locationId = parsePositiveInt(req.body?.location_id);

        if (!areaAdminId || !locationId) {
            return res.status(400).json({
                success: false,
                message: "Valid areaAdminId and location_id are required"
            });
        }

        const [aaRows] = await pool.query("SELECT id, user_id FROM area_admins WHERE id = ?", [areaAdminId]);
        if (aaRows.length === 0) {
            return res.status(404).json({ success: false, message: "Area Admin not found" });
        }

        const [locRows] = await pool.query("SELECT id, state, district, mandal, village FROM locations WHERE id = ?", [locationId]);
        if (locRows.length === 0) {
            return res.status(404).json({ success: false, message: "Location not found" });
        }

        await pool.query("UPDATE area_admins SET location_id = ? WHERE id = ?", [locationId, areaAdminId]);

        return res.status(200).json({
            success: true,
            message: "Area Admin location updated successfully",
            data: {
                areaAdminId,
                userId: aaRows[0].user_id,
                location: locRows[0]
            }
        });
    } catch (error) {
        console.error("Update Area Admin location error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to update Area Admin location"
        });
    }
};

/**
 * List platform users with role/status/search filters and pagination.
 * GET /api/admin/super/users
 * Access: SUPER_ADMIN only
 */
export const getUsersList = async (req, res) => {
    try {
        const { role, status, search, page, limit } = req.query;

        const allowedRoles = ["SUPER_ADMIN", "AREA_ADMIN", "OWNER", "FARMER"];
        const allowedStatuses = ["ACTIVE", "INACTIVE", "PENDING", "SUSPENDED", "BLOCKED"];

        let whereSql = " WHERE 1=1";
        const values = [];

        if (role) {
            const upperRole = String(role).toUpperCase();
            if (!allowedRoles.includes(upperRole)) {
                return res.status(400).json({ success: false, message: "Invalid role filter" });
            }
            whereSql += " AND u.role = ?";
            values.push(upperRole);
        }

        if (status) {
            const upperStatus = String(status).toUpperCase();
            if (!allowedStatuses.includes(upperStatus)) {
                return res.status(400).json({ success: false, message: "Invalid status filter" });
            }
            whereSql += " AND u.status = ?";
            values.push(upperStatus);
        }

        if (search && search.trim()) {
            const pattern = `%${search.trim()}%`;
            whereSql += " AND (u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)";
            values.push(pattern, pattern, pattern);
        }

        const pageNum = Math.max(Number(page) || 1, 1);
        const limitNum = Math.min(Math.max(Number(limit) || 25, 1), 100);
        const offset = (pageNum - 1) * limitNum;

        const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM users u${whereSql}`, values);
        const total = countRows[0].total;

        const [users] = await pool.query(
            `SELECT
                u.id,
                u.full_name,
                u.email,
                u.phone,
                u.role,
                u.status,
                u.warning_count,
                u.suspended_until,
                u.created_at,
                f.id AS farmer_id,
                o.id AS owner_id,
                o.verification_status AS owner_verification_status,
                aa.id AS area_admin_id,
                COALESCE(f.location_id, o.location_id, aa.location_id) AS location_id
             FROM users u
             LEFT JOIN farmers f ON u.id = f.user_id
             LEFT JOIN owners o ON u.id = o.user_id
             LEFT JOIN area_admins aa ON u.id = aa.user_id
             ${whereSql}
             ORDER BY u.created_at DESC
             LIMIT ? OFFSET ?`,
            [...values, limitNum, offset]
        );

        return res.status(200).json({
            success: true,
            message: "Users fetched successfully",
            count: users.length,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum) || 1
            },
            data: users
        });
    } catch (error) {
        console.error("Get users list error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch users"
        });
    }
};

/**
 * Search farmers for Area Admin assisted booking or Super Admin lookup.
 * GET /api/admin/farmers/search?q=...
 * Access: AREA_ADMIN (scoped to assigned area or null-location farmers), SUPER_ADMIN
 */
export const searchFarmers = async (req, res) => {
    try {
        const { q, phone, page, limit } = req.query;
        const { role, location_id } = req.user;

        let whereSql = " WHERE u.status = 'ACTIVE'";
        const values = [];

        if (role === "AREA_ADMIN") {
            if (!location_id) {
                return res.status(403).json({
                    success: false,
                    message: "Area Admin has no assigned location"
                });
            }
            whereSql += " AND (f.location_id = ? OR f.location_id IS NULL)";
            values.push(location_id);
        }

        if (phone && phone.trim()) {
            whereSql += " AND u.phone = ?";
            values.push(phone.trim());
        }

        if (q && q.trim()) {
            const pattern = `%${q.trim()}%`;
            whereSql += " AND (u.full_name LIKE ? OR u.phone LIKE ? OR u.email LIKE ? OR f.farmer_id LIKE ?)";
            values.push(pattern, pattern, pattern, pattern);
        }

        const pageNum = Math.max(Number(page) || 1, 1);
        const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const offset = (pageNum - 1) * limitNum;

        const [farmers] = await pool.query(
            `SELECT
                f.id AS farmer_id,
                f.user_id,
                f.farmer_id AS external_farmer_code,
                f.location_id,
                f.address,
                u.full_name,
                u.phone,
                u.email,
                l.state,
                l.district,
                l.mandal,
                l.village
             FROM farmers f
             JOIN users u ON f.user_id = u.id
             LEFT JOIN locations l ON f.location_id = l.id
             ${whereSql}
             ORDER BY u.full_name ASC
             LIMIT ? OFFSET ?`,
            [...values, limitNum, offset]
        );

        return res.status(200).json({
            success: true,
            message: "Farmers fetched successfully",
            count: farmers.length,
            data: farmers
        });
    } catch (error) {
        console.error("Search farmers error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to search farmers"
        });
    }
};

