import express from "express";
import {
    register,
    sendOTP,
    verifyOTP,
    login,
    getCurrentUser,
    requestPasswordResetOTP,
    verifyPasswordResetOTP,
    resetPassword
} from "../controllers/authController.js";
import { authenticateUser } from "../middleware/authMiddleware.js";

const router = express.Router();

// 1. User Registration
router.post("/auth/register", register);

// 2. Mobile OTP Dispatch
router.post("/auth/otp/send", sendOTP);

// 3. Mobile OTP Verification & Account Activation
router.post("/auth/otp/verify", verifyOTP);

// 4. User Login
router.post("/auth/login", login);

// 5. Authenticated User Profile
router.get("/auth/me", authenticateUser, getCurrentUser);

// 6. Password Reset Flow
router.post("/auth/password-reset/request", requestPasswordResetOTP);
router.post("/auth/password-reset/verify", verifyPasswordResetOTP);
router.post("/auth/password-reset/reset", resetPassword);

export default router;

