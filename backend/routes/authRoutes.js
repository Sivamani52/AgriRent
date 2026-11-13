import express from "express";
import {
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
} from "../controllers/authController.js";
import { authenticateUser } from "../middleware/authMiddleware.js";

const router = express.Router();

// 1. User Registration
router.post("/auth/register", register);

// 2. Email OTP Dispatch
router.post("/auth/otp/send", sendOTP);

// 3. Email OTP Verification & Account Activation
router.post("/auth/otp/verify", verifyOTP);

// 4. User Login & Logout
router.post("/auth/login", login);
router.post("/auth/logout", authenticateUser, logout);

// 5. Authenticated User Profile & Password Change
router.get("/auth/me", authenticateUser, getCurrentUser);
router.put("/auth/profile", authenticateUser, updateProfile);
router.post("/auth/change-password", authenticateUser, changePassword);

// 6. Password Reset Flow
router.post("/auth/password-reset/request", requestPasswordResetOTP);
router.post("/auth/password-reset/verify", verifyPasswordResetOTP);
router.post("/auth/password-reset/reset", resetPassword);

export default router;

