import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../db.js";
import { sendOTPSMS } from "../services/smsService.js";

const PHONE_REGEX = /^[6-9]\d{9}$/;

/**
 * Register a new user (FARMER or OWNER)
 * Route: POST /api/auth/register
 */
export const register = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { full_name, phone, email, password, role, location_id, address } = req.body;

        // 1. Input validations
        if (!full_name || !phone || !password || !role) {
            return res.status(400).json({
                success: false,
                message: "Full name, phone, password, and role are required"
            });
        }

        const trimmedPhone = phone.trim();
        if (!PHONE_REGEX.test(trimmedPhone)) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid 10-digit Indian mobile number"
            });
        }

        const validRoles = ["FARMER", "OWNER"];
        const upperRole = role.toUpperCase();
        if (!validRoles.includes(upperRole)) {
            return res.status(400).json({
                success: false,
                message: "Public registration is only permitted for roles FARMER or OWNER"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters long"
            });
        }

        // 2. Check duplicate phone or email
        const [existingUsers] = await connection.query(
            "SELECT id, phone, email FROM users WHERE phone = ? OR (email IS NOT NULL AND email = ?)",
            [trimmedPhone, email ? email.trim() : ""]
        );

        if (existingUsers.length > 0) {
            const conflict = existingUsers[0].phone === trimmedPhone ? "phone number" : "email address";
            return res.status(400).json({
                success: false,
                message: `An account with this ${conflict} already exists`
            });
        }

        await connection.beginTransaction();

        // 3. Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // 4. Insert into users table
        const [userResult] = await connection.query(
            `INSERT INTO users (full_name, phone, email, password_hash, role, status)
             VALUES (?, ?, ?, ?, ?, 'PENDING')`,
            [full_name.trim(), trimmedPhone, email ? email.trim() : null, passwordHash, upperRole]
        );
        const userId = userResult.insertId;

        // 5. Insert role-specific profile
        if (upperRole === "FARMER") {
            await connection.query(
                `INSERT INTO farmers (user_id, location_id, address)
                 VALUES (?, ?, ?)`,
                [userId, location_id || null, address ? address.trim() : null]
            );
        } else if (upperRole === "OWNER") {
            await connection.query(
                `INSERT INTO owners (user_id, location_id, verification_status)
                 VALUES (?, ?, 'PENDING')`,
                [userId, location_id || null]
            );
        }

        // 6. Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = await bcrypt.hash(otp, 8);

        // Store OTP with 5-minute expiry
        await connection.query(
            `INSERT INTO user_otps (phone, otp_hash, expires_at)
             VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
            [trimmedPhone, otpHash]
        );

        await connection.commit();

        // 7. Send OTP via SMS
        sendOTPSMS({ phone: trimmedPhone, otp }).catch(err => console.error("Register OTP SMS error:", err));

        return res.status(201).json({
            success: true,
            message: "Registration initiated successfully. Please verify the OTP sent to your mobile.",
            data: {
                userId,
                phone: trimmedPhone,
                role: upperRole,
                status: "PENDING",
                // Exposed for test verification in non-production
                otp: process.env.NODE_ENV === "production" ? undefined : otp
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("User registration error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to register user"
        });
    } finally {
        connection.release();
    }
};

/**
 * Dispatch Mobile OTP for login or registration verification
 * Route: POST /api/auth/otp/send
 */
export const sendOTP = async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone || !PHONE_REGEX.test(phone.trim())) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid 10-digit mobile number"
            });
        }

        const trimmedPhone = phone.trim();

        // Rate limit: check if an unexpired OTP was sent within the last 60 seconds
        const [recentOtps] = await pool.query(
            `SELECT id FROM user_otps
             WHERE phone = ? AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)
             LIMIT 1`,
            [trimmedPhone]
        );

        if (recentOtps.length > 0) {
            return res.status(429).json({
                success: false,
                message: "Please wait 60 seconds before requesting another OTP"
            });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = await bcrypt.hash(otp, 8);

        await pool.query(
            `INSERT INTO user_otps (phone, otp_hash, expires_at)
             VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
            [trimmedPhone, otpHash]
        );

        sendOTPSMS({ phone: trimmedPhone, otp }).catch(err => console.error("Send OTP SMS error:", err));

        return res.status(200).json({
            success: true,
            message: `OTP sent successfully to ${trimmedPhone}`,
            data: {
                phone: trimmedPhone,
                otp: process.env.NODE_ENV === "production" ? undefined : otp
            }
        });

    } catch (error) {
        console.error("Send OTP error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send OTP"
        });
    }
};

/**
 * Verify Mobile OTP and activate account or authenticate
 * Route: POST /api/auth/otp/verify
 */
export const verifyOTP = async (req, res) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({
                success: false,
                message: "Phone number and OTP are required"
            });
        }

        const trimmedPhone = phone.trim();
        const trimmedOtp = otp.trim();

        // 1. Fetch latest active unverified OTP for this phone
        const [otpRows] = await pool.query(
            `SELECT id, otp_hash, expires_at, attempts
             FROM user_otps
             WHERE phone = ? AND is_verified = FALSE AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1`,
            [trimmedPhone]
        );

        if (otpRows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid or expired OTP. Please request a new OTP."
            });
        }

        const otpRecord = otpRows[0];

        // 2. Check retry limits (max 5 attempts)
        if (otpRecord.attempts >= 5) {
            return res.status(400).json({
                success: false,
                message: "Maximum OTP attempts exceeded. Please request a new OTP."
            });
        }

        // 3. Verify OTP hash
        const isMatch = await bcrypt.compare(trimmedOtp, otpRecord.otp_hash);
        if (!isMatch) {
            await pool.query(
                "UPDATE user_otps SET attempts = attempts + 1 WHERE id = ?",
                [otpRecord.id]
            );
            return res.status(400).json({
                success: false,
                message: "Incorrect OTP. Please try again."
            });
        }

        // 4. Mark OTP as verified
        await pool.query(
            "UPDATE user_otps SET is_verified = TRUE WHERE id = ?",
            [otpRecord.id]
        );

        // 5. Activate user if currently PENDING
        await pool.query(
            "UPDATE users SET status = 'ACTIVE' WHERE phone = ? AND status = 'PENDING'",
            [trimmedPhone]
        );

        // 6. Fetch user profile
        const [users] = await pool.query(
            "SELECT id, full_name, phone, email, role, status FROM users WHERE phone = ?",
            [trimmedPhone]
        );

        if (users.length === 0) {
            return res.status(200).json({
                success: true,
                message: "Mobile OTP verified successfully"
            });
        }

        const user = users[0];

        // 7. Issue JWT Token
        const secret = process.env.JWT_SECRET;
        const token = jwt.sign(
            { id: user.id, role: user.role },
            secret,
            { expiresIn: "7d" }
        );

        return res.status(200).json({
            success: true,
            message: "OTP verified successfully. Account activated.",
            data: {
                token,
                user: {
                    id: user.id,
                    fullName: user.full_name,
                    phone: user.phone,
                    email: user.email,
                    role: user.role,
                    status: user.status
                }
            }
        });

    } catch (error) {
        console.error("Verify OTP error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to verify OTP"
        });
    }
};

/**
 * Login with Phone/Email and Password
 * Route: POST /api/auth/login
 */
export const login = async (req, res) => {
    try {
        const { identifier, phone, email, password } = req.body;
        const loginId = (identifier || phone || email || "").trim();

        if (!loginId || !password) {
            return res.status(400).json({
                success: false,
                message: "Mobile number/email and password are required"
            });
        }

        // 1. Fetch user by phone or email
        const [users] = await pool.query(
            `SELECT id, full_name, phone, email, role, status, password_hash,
                    suspended_until, suspension_reason
             FROM users
             WHERE phone = ? OR (email IS NOT NULL AND email = ?)`,
            [loginId, loginId]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid phone number or password"
            });
        }

        const user = users[0];

        // 2. Check account status & session enforcement
        if (user.status === "BLOCKED") {
            return res.status(403).json({
                success: false,
                message: `Account has been permanently blocked. Reason: ${user.suspension_reason || "Policy violation"}`
            });
        }

        if (user.status === "SUSPENDED") {
            if (user.suspended_until && new Date() > new Date(user.suspended_until)) {
                // Auto-reactivate expired suspension
                await pool.query(
                    "UPDATE users SET status = 'ACTIVE', suspended_until = NULL, suspension_reason = NULL WHERE id = ?",
                    [user.id]
                );
                user.status = "ACTIVE";
            } else {
                const untilStr = user.suspended_until ? new Date(user.suspended_until).toISOString() : "further notice";
                return res.status(403).json({
                    success: false,
                    message: `Account is temporarily suspended until ${untilStr}. Reason: ${user.suspension_reason || "Administrative suspension"}`
                });
            }
        }

        if (user.status === "PENDING") {
            return res.status(403).json({
                success: false,
                message: "Your account is pending mobile OTP verification. Please verify your mobile number."
            });
        }

        // 3. Verify password
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid phone number or password"
            });
        }

        // 4. Issue JWT Token
        const secret = process.env.JWT_SECRET;
        const token = jwt.sign(
            { id: user.id, role: user.role },
            secret,
            { expiresIn: "7d" }
        );

        // Fetch role profiles
        let profileDetails = {};
        if (user.role === "OWNER") {
            const [ownerRows] = await pool.query("SELECT id, location_id, verification_status FROM owners WHERE user_id = ?", [user.id]);
            if (ownerRows.length > 0) profileDetails = { ownerId: ownerRows[0].id, locationId: ownerRows[0].location_id, verificationStatus: ownerRows[0].verification_status };
        } else if (user.role === "FARMER") {
            const [farmerRows] = await pool.query("SELECT id, location_id FROM farmers WHERE user_id = ?", [user.id]);
            if (farmerRows.length > 0) profileDetails = { farmerId: farmerRows[0].id, locationId: farmerRows[0].location_id };
        } else if (user.role === "AREA_ADMIN") {
            const [adminRows] = await pool.query("SELECT id, location_id FROM area_admins WHERE user_id = ?", [user.id]);
            if (adminRows.length > 0) profileDetails = { areaAdminId: adminRows[0].id, locationId: adminRows[0].location_id };
        }

        return res.status(200).json({
            success: true,
            message: "Login successful",
            data: {
                token,
                user: {
                    id: user.id,
                    fullName: user.full_name,
                    phone: user.phone,
                    email: user.email,
                    role: user.role,
                    status: user.status,
                    ...profileDetails
                }
            }
        });

    } catch (error) {
        console.error("User login error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to login"
        });
    }
};

/**
 * Get current authenticated user profile
 * Route: GET /api/auth/me
 */
export const getCurrentUser = async (req, res) => {
    try {
        return res.status(200).json({
            success: true,
            data: req.user
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch user profile" });
    }
};

export default {
    register,
    sendOTP,
    verifyOTP,
    login,
    getCurrentUser
};

