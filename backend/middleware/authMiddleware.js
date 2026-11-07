import jwt from "jsonwebtoken";
import pool from "../db.js";

/**
 * Authenticates user via Bearer JWT token in Authorization header.
 * Attaches authenticated user data (id, full_name, email, role, status) to req.user.
 */
export const authenticateUser = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Authentication token is missing or invalid"
            });
        }

        const token = authHeader.split(" ")[1];
        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Authentication token is missing or invalid"
            });
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            console.error("JWT_SECRET is not configured");
            return res.status(500).json({
                success: false,
                message: "Authentication service is not configured"
            });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, secret);
        } catch (err) {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired token"
            });
        }

        // Verify that the user exists and is active in the database
        const userId = decoded.id || decoded.userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User account not found"
            });
        }
        const [users] = await pool.query(
            "SELECT id, full_name, email, role, status FROM users WHERE id = ?",
            [userId]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: "User account not found"
            });
        }

        const user = users[0];

        if (user.status !== "ACTIVE") {
            return res.status(403).json({
                success: false,
                message: "User account is not active"
            });
        }

        // Attach role-specific profile details (id and location_id)
        if (user.role === "AREA_ADMIN") {
            const [adminProfiles] = await pool.query(
                "SELECT id, location_id FROM area_admins WHERE user_id = ?",
                [user.id]
            );
            user.area_admin_id = adminProfiles.length > 0 ? adminProfiles[0].id : null;
            user.location_id = adminProfiles.length > 0 ? adminProfiles[0].location_id : null;
        } else if (user.role === "OWNER") {
            const [ownerProfiles] = await pool.query(
                "SELECT id, location_id FROM owners WHERE user_id = ?",
                [user.id]
            );
            user.owner_id = ownerProfiles.length > 0 ? ownerProfiles[0].id : null;
            user.location_id = ownerProfiles.length > 0 ? ownerProfiles[0].location_id : null;
        } else if (user.role === "FARMER") {
            const [farmerProfiles] = await pool.query(
                "SELECT id, location_id FROM farmers WHERE user_id = ?",
                [user.id]
            );
            user.farmer_id = farmerProfiles.length > 0 ? farmerProfiles[0].id : null;
            user.location_id = farmerProfiles.length > 0 ? farmerProfiles[0].location_id : null;
        }

        req.user = user;
        next();
    } catch (error) {
        console.error("Authentication middleware error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error during authentication"
        });
    }
};

/**
 * Authorizes user based on their role.
 * Must be preceded by authenticateUser.
 */
export const authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to perform this action"
            });
        }
        next();
    };
};
