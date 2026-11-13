import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../db.js";
import {
    sendOTPEmail,
    sendRegistrationConfirmationEmail,
    sendPasswordResetOTPEmail,
    sendPasswordResetSuccessEmail
} from "../services/notificationService.js";
import { isValidEmail } from "../services/emailService.js";
import { parsePositiveInt } from "../utils/responseHelper.js";

const PHONE_REGEX = /^[6-9]\d{9}$/;
const REGISTER_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;

const generateSecureOTP = () => crypto.randomInt(100000, 1000000).toString();

const signAuthToken = (user) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error("JWT_SECRET is not configured");
    }
    return jwt.sign(
        { id: user.id, role: user.role, issuedAtMs: Date.now() },
        secret,
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );
};

/**
 * Register a new user (FARMER or OWNER)
 * Route: POST /api/auth/register
 */
export const register = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { full_name, phone, email, password, role, location_id, address } = req.body;

        // 1. Input validations
        if (!full_name || !phone || !email || !password || !role) {
            return res.status(400).json({
                success: false,
                message: "Full name, phone, email, password, and role are required"
            });
        }

        const trimmedName = String(full_name).trim();
        if (trimmedName.length < 2 || trimmedName.length > 100) {
            return res.status(400).json({
                success: false,
                message: "Full name must be between 2 and 100 characters"
            });
        }

        const trimmedPhone = String(phone).trim();
        if (!PHONE_REGEX.test(trimmedPhone)) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid 10-digit Indian mobile number"
            });
        }

        const trimmedEmail = String(email).trim().toLowerCase();
        if (!isValidEmail(trimmedEmail)) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid email address"
            });
        }

        const validRoles = ["FARMER", "OWNER"];
        const upperRole = String(role).trim().toUpperCase();
        if (!validRoles.includes(upperRole)) {
            return res.status(400).json({
                success: false,
                message: "Public registration is only permitted for roles FARMER or OWNER"
            });
        }

        if (typeof password !== "string" || !REGISTER_PASSWORD_REGEX.test(password)) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters long and include uppercase, lowercase, and a number"
            });
        }

        let validatedLocationId = null;
        if (upperRole === "OWNER") {
            validatedLocationId = parsePositiveInt(location_id);
            if (!validatedLocationId) {
                return res.status(400).json({
                    success: false,
                    message: "A valid location_id is required for OWNER registration"
                });
            }
        } else if (location_id !== undefined && location_id !== null && location_id !== "") {
            validatedLocationId = parsePositiveInt(location_id);
            if (!validatedLocationId) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid location_id"
                });
            }
        }

        if (validatedLocationId) {
            const [locRows] = await connection.query(
                "SELECT id FROM locations WHERE id = ?",
                [validatedLocationId]
            );
            if (locRows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Selected location not found"
                });
            }
        }

        // 2. Check duplicate phone or email
        const [existingUsers] = await connection.query(
            "SELECT id, phone, email FROM users WHERE phone = ? OR email = ?",
            [trimmedPhone, trimmedEmail]
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
            [trimmedName, trimmedPhone, trimmedEmail, passwordHash, upperRole]
        );
        const userId = userResult.insertId;

        // 5. Insert role-specific profile
        if (upperRole === "FARMER") {
            await connection.query(
                `INSERT INTO farmers (user_id, location_id, address)
                 VALUES (?, ?, ?)`,
                [userId, validatedLocationId, address ? String(address).trim() : null]
            );
        } else if (upperRole === "OWNER") {
            await connection.query(
                `INSERT INTO owners (user_id, location_id, verification_status)
                 VALUES (?, ?, 'PENDING')`,
                [userId, validatedLocationId]
            );
        }

        // 6. Generate cryptographically secure 6-digit OTP and invalidate prior unverified registration OTPs
        const otp = generateSecureOTP();
        const otpHash = await bcrypt.hash(otp, 8);

        await connection.query(
            `UPDATE user_otps
             SET is_used = TRUE
             WHERE (phone = ? OR email = ?) AND purpose = 'REGISTRATION' AND is_verified = FALSE AND is_used = FALSE`,
            [trimmedPhone, trimmedEmail]
        );

        await connection.query(
            `INSERT INTO user_otps (phone, email, purpose, otp_hash, expires_at)
             VALUES (?, ?, 'REGISTRATION', ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
            [trimmedPhone, trimmedEmail, otpHash]
        );

        await connection.commit();

        // 7. Send OTP via Brevo Email (non-blocking)
        sendOTPEmail({ email: trimmedEmail, name: trimmedName, otp }).catch((err) =>
            console.error("Register OTP Email error:", err)
        );

        return res.status(201).json({
            success: true,
            message: "Registration initiated successfully. Please verify the OTP sent to your email.",
            data: {
                userId,
                phone: trimmedPhone,
                email: trimmedEmail,
                role: upperRole,
                locationId: validatedLocationId,
                status: "PENDING"
            }
        });
    } catch (error) {
        try {
            await connection.rollback();
        } catch {
            // ignore if transaction not started
        }
        console.error("User registration error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to register user"
        });
    } finally {
        connection.release();
    }
};

/**
 * Dispatch OTP for registration verification
 * Route: POST /api/auth/otp/send
 */
export const sendOTP = async (req, res) => {
    try {
        const { phone, email, identifier } = req.body;
        const target = String(identifier || email || phone || "").trim();

        if (!target) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid mobile number or email address"
            });
        }

        const isPhone = PHONE_REGEX.test(target);
        const isEmail = isValidEmail(target);

        if (!isPhone && !isEmail) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid 10-digit mobile number or email address"
            });
        }

        const normalizedTarget = isEmail ? target.toLowerCase() : target;

        // Rate limit: check if an OTP was sent within the last 60 seconds
        const [recentOtps] = await pool.query(
            `SELECT id FROM user_otps
             WHERE (phone = ? OR email = ?)
               AND purpose = 'REGISTRATION'
               AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)
             LIMIT 1`,
            [normalizedTarget, normalizedTarget]
        );

        if (recentOtps.length > 0) {
            return res.status(429).json({
                success: false,
                message: "Please wait 60 seconds before requesting another OTP"
            });
        }

        // Fetch user info if registered
        const [users] = await pool.query(
            "SELECT id, full_name, phone, email, status FROM users WHERE phone = ? OR email = ?",
            [normalizedTarget, normalizedTarget]
        );

        const targetEmail = users.length > 0 ? users[0].email : (isEmail ? normalizedTarget : null);
        const targetPhone = users.length > 0 ? users[0].phone : (isPhone ? normalizedTarget : null);
        const targetName = users.length > 0 ? users[0].full_name : "AgriRent User";

        const otp = generateSecureOTP();
        const otpHash = await bcrypt.hash(otp, 8);

        await pool.query(
            `UPDATE user_otps
             SET is_used = TRUE
             WHERE (phone = ? OR email = ?) AND purpose = 'REGISTRATION' AND is_verified = FALSE AND is_used = FALSE`,
            [targetPhone, targetEmail]
        );

        await pool.query(
            `INSERT INTO user_otps (phone, email, purpose, otp_hash, expires_at)
             VALUES (?, ?, 'REGISTRATION', ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
            [targetPhone, targetEmail, otpHash]
        );

        if (targetEmail) {
            sendOTPEmail({ email: targetEmail, name: targetName, otp }).catch((err) =>
                console.error("Send OTP Email error:", err)
            );
        }

        return res.status(200).json({
            success: true,
            message: targetEmail
                ? `OTP sent successfully to registered email ${targetEmail}`
                : "OTP generated successfully",
            data: {
                phone: targetPhone,
                email: targetEmail
            }
        });
    } catch (error) {
        console.error("Send OTP error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to send OTP"
        });
    }
};

/**
 * Verify REGISTRATION OTP and activate account
 * Route: POST /api/auth/otp/verify
 */
export const verifyOTP = async (req, res) => {
    try {
        const { phone, email, identifier, otp } = req.body;
        const targetRaw = String(identifier || email || phone || "").trim();

        if (!targetRaw || !otp) {
            return res.status(400).json({
                success: false,
                message: "Identifier (mobile/email) and OTP are required"
            });
        }

        const target = isValidEmail(targetRaw) ? targetRaw.toLowerCase() : targetRaw;
        const trimmedOtp = String(otp).trim();

        // 1. Fetch latest active unverified REGISTRATION OTP
        const [otpRows] = await pool.query(
            `SELECT id, otp_hash, expires_at, attempts
             FROM user_otps
             WHERE (phone = ? OR email = ?)
               AND purpose = 'REGISTRATION'
               AND is_verified = FALSE
               AND is_used = FALSE
               AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1`,
            [target, target]
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
            await pool.query("UPDATE user_otps SET is_used = TRUE WHERE id = ?", [otpRecord.id]);
            return res.status(400).json({
                success: false,
                message: "Maximum OTP attempts exceeded. Please request a new OTP."
            });
        }

        // 3. Verify OTP hash
        const isMatch = await bcrypt.compare(trimmedOtp, otpRecord.otp_hash);
        if (!isMatch) {
            const newAttempts = otpRecord.attempts + 1;
            const isBurned = newAttempts >= 5;
            await pool.query(
                "UPDATE user_otps SET attempts = ?, is_used = ? WHERE id = ?",
                [newAttempts, isBurned ? 1 : 0, otpRecord.id]
            );
            return res.status(400).json({
                success: false,
                message: "Incorrect OTP. Please try again."
            });
        }

        // 4. Mark OTP verified and single-use consumed
        await pool.query(
            "UPDATE user_otps SET is_verified = TRUE, is_used = TRUE WHERE id = ?",
            [otpRecord.id]
        );

        // 5. Activate user if currently PENDING
        await pool.query(
            "UPDATE users SET status = 'ACTIVE' WHERE (phone = ? OR email = ?) AND status = 'PENDING'",
            [target, target]
        );

        // 6. Fetch user profile
        const [users] = await pool.query(
            "SELECT id, full_name, phone, email, role, status FROM users WHERE phone = ? OR email = ?",
            [target, target]
        );

        if (users.length === 0) {
            return res.status(200).json({
                success: true,
                message: "OTP verified successfully"
            });
        }

        const user = users[0];

        if (user.status !== "ACTIVE") {
            return res.status(403).json({
                success: false,
                message: `User account is ${user.status.toLowerCase()} and cannot be signed in`
            });
        }

        // 7. Dispatch registration confirmation email (non-blocking)
        if (user.email) {
            sendRegistrationConfirmationEmail({
                email: user.email,
                name: user.full_name,
                role: user.role
            }).catch((err) => console.error("Registration confirmation email error:", err));
        }

        // 8. Issue JWT Token
        const token = signAuthToken(user);

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
        console.error("Verify OTP error:", error.message || error);
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
        const loginRaw = String(identifier || phone || email || "").trim();

        if (!loginRaw || !password) {
            return res.status(400).json({
                success: false,
                message: "Mobile number/email and password are required"
            });
        }

        const loginId = isValidEmail(loginRaw) ? loginRaw.toLowerCase() : loginRaw;

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
                message: "Your account is pending email OTP verification. Please check your email and verify your account."
            });
        }

        if (user.status !== "ACTIVE") {
            return res.status(403).json({
                success: false,
                message: "User account is not active"
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
        const token = signAuthToken(user);

        // Fetch role profiles
        let profileDetails = {};
        if (user.role === "OWNER") {
            const [ownerRows] = await pool.query("SELECT id, location_id, verification_status FROM owners WHERE user_id = ?", [user.id]);
            if (ownerRows.length > 0) profileDetails = { ownerId: ownerRows[0].id, locationId: ownerRows[0].location_id, verificationStatus: ownerRows[0].verification_status };
        } else if (user.role === "FARMER") {
            const [farmerRows] = await pool.query("SELECT id, location_id, address FROM farmers WHERE user_id = ?", [user.id]);
            if (farmerRows.length > 0) profileDetails = { farmerId: farmerRows[0].id, locationId: farmerRows[0].location_id, address: farmerRows[0].address };
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
        console.error("User login error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to login"
        });
    }
};

/**
 * Logout authenticated session and invalidate current/older JWTs
 * Route: POST /api/auth/logout
 */
export const logout = async (req, res) => {
    try {
        await pool.query(
            "UPDATE users SET token_invalidated_before = NOW(3) WHERE id = ?",
            [req.user.id]
        );
        return res.status(200).json({
            success: true,
            message: "Logged out successfully"
        });
    } catch (error) {
        console.error("Logout error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to logout"
        });
    }
};

/**
 * Get current authenticated user profile
 * Route: GET /api/auth/me
 */
export const getCurrentUser = async (req, res) => {
    try {
        const user = { ...req.user };
        if (user.role === "FARMER") {
            const [rows] = await pool.query("SELECT address, farmer_id FROM farmers WHERE user_id = ?", [user.id]);
            if (rows.length > 0) {
                user.address = rows[0].address;
                user.farmer_code = rows[0].farmer_id;
            }
        } else if (user.role === "OWNER") {
            const [rows] = await pool.query("SELECT verification_status FROM owners WHERE user_id = ?", [user.id]);
            if (rows.length > 0) {
                user.verification_status = rows[0].verification_status;
            }
        }

        return res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch user profile" });
    }
};

/**
 * Update current authenticated user profile (full_name, address for FARMER, location_id for FARMER/OWNER)
 * Route: PUT /api/auth/profile
 */
export const updateProfile = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { full_name, address, location_id } = req.body;

        if (full_name === undefined && address === undefined && location_id === undefined) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "At least one updatable profile field (full_name, address, location_id) is required"
            });
        }

        if (full_name !== undefined) {
            const trimmed = String(full_name).trim();
            if (trimmed.length < 2 || trimmed.length > 100) {
                connection.release();
                return res.status(400).json({
                    success: false,
                    message: "Full name must be between 2 and 100 characters"
                });
            }
        }

        let validatedLocId = undefined;
        if (location_id !== undefined) {
            if (req.user.role === "AREA_ADMIN" || req.user.role === "SUPER_ADMIN") {
                connection.release();
                return res.status(403).json({
                    success: false,
                    message: "Administrative area assignment can only be modified by Super Admin"
                });
            }
            if (location_id === null && req.user.role === "OWNER") {
                connection.release();
                return res.status(400).json({
                    success: false,
                    message: "location_id cannot be null for OWNER accounts"
                });
            }
            if (location_id !== null) {
                validatedLocId = parsePositiveInt(location_id);
                if (!validatedLocId) {
                    connection.release();
                    return res.status(400).json({ success: false, message: "Invalid location_id" });
                }
                const [locs] = await connection.query("SELECT id FROM locations WHERE id = ?", [validatedLocId]);
                if (locs.length === 0) {
                    connection.release();
                    return res.status(404).json({ success: false, message: "Location not found" });
                }
            } else {
                validatedLocId = null;
            }
        }

        await connection.beginTransaction();

        if (full_name !== undefined) {
            await connection.query("UPDATE users SET full_name = ? WHERE id = ?", [String(full_name).trim(), req.user.id]);
        }

        if (req.user.role === "FARMER" && (address !== undefined || validatedLocId !== undefined)) {
            const updates = [];
            const params = [];
            if (address !== undefined) {
                updates.push("address = ?");
                params.push(address ? String(address).trim() : null);
            }
            if (validatedLocId !== undefined) {
                updates.push("location_id = ?");
                params.push(validatedLocId);
            }
            if (updates.length > 0) {
                params.push(req.user.id);
                await connection.query(`UPDATE farmers SET ${updates.join(", ")} WHERE user_id = ?`, params);
            }
        } else if (req.user.role === "OWNER" && validatedLocId !== undefined) {
            await connection.query("UPDATE owners SET location_id = ? WHERE user_id = ?", [validatedLocId, req.user.id]);
        }

        await connection.commit();

        const [rows] = await connection.query(
            "SELECT id, full_name, phone, email, role, status FROM users WHERE id = ?",
            [req.user.id]
        );

        return res.status(200).json({
            success: true,
            message: "Profile updated successfully",
            data: rows[0]
        });
    } catch (error) {
        try {
            await connection.rollback();
        } catch {
            // ignore
        }
        console.error("Update profile error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to update profile"
        });
    } finally {
        connection.release();
    }
};

/**
 * Authenticated password change
 * Route: POST /api/auth/change-password
 */
export const changePassword = async (req, res) => {
    try {
        const { current_password, new_password, confirm_password } = req.body;

        if (!current_password || !new_password || !confirm_password) {
            return res.status(400).json({
                success: false,
                message: "current_password, new_password, and confirm_password are required"
            });
        }

        if (new_password !== confirm_password) {
            return res.status(400).json({
                success: false,
                message: "New password and confirm password do not match"
            });
        }

        if (!STRONG_PASSWORD_REGEX.test(new_password)) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters long and contain uppercase, lowercase, number, and special character"
            });
        }

        const [users] = await pool.query(
            "SELECT id, full_name, email, password_hash FROM users WHERE id = ?",
            [req.user.id]
        );
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const user = users[0];
        const isCurrentValid = await bcrypt.compare(current_password, user.password_hash);
        if (!isCurrentValid) {
            return res.status(401).json({
                success: false,
                message: "Current password is incorrect"
            });
        }

        const newHash = await bcrypt.hash(new_password, 10);
        await pool.query(
            `UPDATE users
             SET password_hash = ?,
                 password_changed_at = NOW(3)
             WHERE id = ?`,
            [newHash, user.id]
        );

        sendPasswordResetSuccessEmail({
            email: user.email,
            name: user.full_name
        }).catch((err) => console.error("Change password email error:", err));

        return res.status(200).json({
            success: true,
            message: "Password updated successfully. Please log in again with your new password."
        });
    } catch (error) {
        console.error("Change password error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to change password"
        });
    }
};

/**
 * Request Password Reset OTP
 * Route: POST /api/auth/password-reset/request
 */
export const requestPasswordResetOTP = async (req, res) => {
    try {
        const { phone, email, identifier } = req.body;
        const targetRaw = String(identifier || email || phone || "").trim();

        if (!targetRaw) {
            return res.status(400).json({
                success: false,
                message: "Please enter your registered mobile number or email address"
            });
        }

        const isPhone = PHONE_REGEX.test(targetRaw);
        const isEmail = isValidEmail(targetRaw);

        if (!isPhone && !isEmail) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid 10-digit mobile number or email address"
            });
        }

        const target = isEmail ? targetRaw.toLowerCase() : targetRaw;

        // 1. Rate limit: check if an OTP was sent within the last 60 seconds
        const [recentOtps] = await pool.query(
            `SELECT id FROM user_otps
             WHERE (phone = ? OR email = ?) AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)
             LIMIT 1`,
            [target, target]
        );

        if (recentOtps.length > 0) {
            return res.status(429).json({
                success: false,
                message: "Please wait 60 seconds before requesting another OTP"
            });
        }

        // 2. Check if user exists (User Enumeration Prevention: identical response either way)
        const [users] = await pool.query(
            "SELECT id, full_name, phone, email, status FROM users WHERE phone = ? OR email = ?",
            [target, target]
        );

        if (users.length === 0 || users[0].status === "BLOCKED") {
            return res.status(200).json({
                success: true,
                message: "If this account is registered, a password reset OTP has been sent."
            });
        }

        const user = users[0];

        // 3. Generate cryptographically secure 6-digit OTP
        const otp = generateSecureOTP();
        const otpHash = await bcrypt.hash(otp, 8);

        await pool.query(
            `UPDATE user_otps
             SET is_used = TRUE
             WHERE (phone = ? OR email = ?) AND purpose = 'PASSWORD_RESET' AND is_verified = FALSE`,
            [user.phone, user.email]
        );

        await pool.query(
            `INSERT INTO user_otps (phone, email, purpose, otp_hash, expires_at)
             VALUES (?, ?, 'PASSWORD_RESET', ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
            [user.phone, user.email, otpHash]
        );

        sendPasswordResetOTPEmail({
            email: user.email,
            name: user.full_name,
            otp
        }).catch((err) => console.error("Password reset OTP Email error:", err));

        return res.status(200).json({
            success: true,
            message: "If this account is registered, a password reset OTP has been sent."
        });
    } catch (error) {
        console.error("Request password reset OTP error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to process password reset request"
        });
    }
};

/**
 * Verify Password Reset OTP and issue short-lived Reset Authorization Token
 * Route: POST /api/auth/password-reset/verify
 */
export const verifyPasswordResetOTP = async (req, res) => {
    try {
        const { phone, email, identifier, otp } = req.body;
        const targetRaw = String(identifier || email || phone || "").trim();

        if (!targetRaw || !otp) {
            return res.status(400).json({
                success: false,
                message: "Registered mobile/email and OTP are required"
            });
        }

        const target = isValidEmail(targetRaw) ? targetRaw.toLowerCase() : targetRaw;
        const trimmedOtp = String(otp).trim();

        const [otpRows] = await pool.query(
            `SELECT id, otp_hash, expires_at, attempts, phone, email
             FROM user_otps
             WHERE (phone = ? OR email = ?)
               AND purpose = 'PASSWORD_RESET'
               AND is_verified = FALSE
               AND is_used = FALSE
               AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1`,
            [target, target]
        );

        if (otpRows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid or expired OTP. Please request a new OTP."
            });
        }

        const otpRecord = otpRows[0];

        if (otpRecord.attempts >= 5) {
            await pool.query("UPDATE user_otps SET is_used = TRUE WHERE id = ?", [otpRecord.id]);
            return res.status(400).json({
                success: false,
                message: "Maximum OTP attempts exceeded. Please request a new OTP."
            });
        }

        const isMatch = await bcrypt.compare(trimmedOtp, otpRecord.otp_hash);
        if (!isMatch) {
            const newAttempts = otpRecord.attempts + 1;
            const isBurned = newAttempts >= 5;
            await pool.query(
                "UPDATE user_otps SET attempts = ?, is_used = ? WHERE id = ?",
                [newAttempts, isBurned ? 1 : 0, otpRecord.id]
            );
            const remaining = 5 - newAttempts;
            return res.status(400).json({
                success: false,
                message: remaining > 0
                    ? `Incorrect OTP. ${remaining} attempt(s) remaining.`
                    : "Maximum OTP attempts exceeded. Please request a new OTP."
            });
        }

        await pool.query(
            "UPDATE user_otps SET is_verified = TRUE WHERE id = ?",
            [otpRecord.id]
        );

        const [users] = await pool.query(
            "SELECT id, phone, email, full_name, role FROM users WHERE phone = ? OR email = ?",
            [target, target]
        );

        if (users.length === 0) {
            return res.status(400).json({
                success: false,
                message: "User account not found"
            });
        }

        const user = users[0];

        const secret = process.env.JWT_SECRET;
        const resetToken = jwt.sign(
            {
                userId: user.id,
                phone: user.phone,
                email: user.email,
                otpId: otpRecord.id,
                purpose: "PASSWORD_RESET_AUTH"
            },
            secret,
            { expiresIn: "15m" }
        );

        return res.status(200).json({
            success: true,
            message: "OTP verified successfully. You may now reset your password.",
            data: {
                resetToken
            }
        });
    } catch (error) {
        console.error("Verify password reset OTP error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to verify OTP"
        });
    }
};

/**
 * Reset Password using verified Reset Authorization Token
 * Route: POST /api/auth/password-reset/reset
 */
export const resetPassword = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { reset_token, new_password, confirm_password } = req.body;

        if (!reset_token || !new_password || !confirm_password) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "reset_token, new_password, and confirm_password are required"
            });
        }

        if (new_password !== confirm_password) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "New password and confirm password do not match"
            });
        }

        if (!STRONG_PASSWORD_REGEX.test(new_password)) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character"
            });
        }

        const secret = process.env.JWT_SECRET;
        let decoded;
        try {
            decoded = jwt.verify(reset_token, secret);
        } catch {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "Invalid or expired reset authorization token. Please request a new OTP."
            });
        }

        if (!decoded || decoded.purpose !== "PASSWORD_RESET_AUTH" || !decoded.userId || !decoded.otpId) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "Invalid reset authorization token"
            });
        }

        await connection.beginTransaction();

        // 1. Lock OTP record & enforce purpose + single-use
        const [otpRows] = await connection.query(
            `SELECT id, purpose, phone, email, is_verified, is_used, expires_at
             FROM user_otps
             WHERE id = ? FOR UPDATE`,
            [decoded.otpId]
        );

        if (otpRows.length === 0 || otpRows[0].purpose !== "PASSWORD_RESET" || !otpRows[0].is_verified) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Invalid or unverified reset authorization"
            });
        }

        if (otpRows[0].is_used) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "This reset authorization token has already been used"
            });
        }

        // 2. Lock user record & verify ownership against OTP record
        const [users] = await connection.query(
            "SELECT id, phone, email, full_name, status FROM users WHERE id = ? FOR UPDATE",
            [decoded.userId]
        );

        if (users.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "User account not found"
            });
        }

        const user = users[0];
        if (otpRows[0].phone !== user.phone && otpRows[0].email !== user.email) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Invalid reset authorization token"
            });
        }

        if (user.status === "BLOCKED") {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "This account has been permanently blocked"
            });
        }

        // 3. Hash new password
        const passwordHash = await bcrypt.hash(new_password, 10);

        // 4. Update user password and set password_changed_at
        await connection.query(
            `UPDATE users
             SET password_hash = ?,
                 password_changed_at = NOW(3)
             WHERE id = ?`,
            [passwordHash, user.id]
        );

        // 5. Consume the OTP authorization
        await connection.query(
            "UPDATE user_otps SET is_used = TRUE WHERE id = ?",
            [decoded.otpId]
        );

        await connection.commit();

        sendPasswordResetSuccessEmail({
            email: user.email,
            name: user.full_name
        }).catch((err) => console.error("Password reset success email error:", err));

        return res.status(200).json({
            success: true,
            message: "Password has been reset successfully. Please log in with your new password."
        });
    } catch (error) {
        try {
            await connection.rollback();
        } catch {
            // ignore
        }
        console.error("Reset password error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to reset password"
        });
    } finally {
        connection.release();
    }
};

export default {
    register,
    sendOTP,
    verifyOTP,
    login,
    logout,
    getCurrentUser,
    updateProfile,
    changePassword,
    requestPasswordResetOTP,
    verifyPasswordResetOTP,
    resetPassword
};
