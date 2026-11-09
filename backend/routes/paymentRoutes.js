import express from "express";
import { authenticateUser, authorizeRoles } from "../middleware/authMiddleware.js";

import {
    submitPayment,
    verifyPayment,
    rejectPayment,
    submitRefund,
    confirmRefund,
    disputeRefund
} from "../controllers/paymentController.js";

const router = express.Router();

// 1. Farmer submits advance payment
router.post(
    "/payments",
    authenticateUser,
    authorizeRoles("FARMER"),
    submitPayment
);

// 2. Owner verifies advance payment
router.patch(
    "/payments/:paymentId/verify",
    authenticateUser,
    authorizeRoles("OWNER"),
    verifyPayment
);

// 3. Owner rejects advance payment
router.patch(
    "/payments/:paymentId/reject",
    authenticateUser,
    authorizeRoles("OWNER"),
    rejectPayment
);

// 4. Authorized owner (or Area/Super Admin) submits refund details
router.patch(
    "/payments/:paymentId/refund",
    authenticateUser,
    authorizeRoles("OWNER", "AREA_ADMIN", "SUPER_ADMIN"),
    submitRefund
);

// 5. Farmer confirms receipt of refund
router.patch(
    "/payments/:paymentId/refund/confirm",
    authenticateUser,
    authorizeRoles("FARMER"),
    confirmRefund
);

// 6. Farmer raises refund dispute
router.patch(
    "/payments/:paymentId/refund/dispute",
    authenticateUser,
    authorizeRoles("FARMER"),
    disputeRefund
);

export default router;
