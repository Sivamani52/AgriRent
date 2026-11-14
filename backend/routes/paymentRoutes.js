import express from "express";
import { authenticateUser, authorizeRoles } from "../middleware/authMiddleware.js";

import {
    submitPayment,
    verifyPayment,
    rejectPayment,
    submitRefund,
    confirmRefund,
    disputeRefund,
    getPaymentById,
    getBookingPayments,
    getFarmerPayments,
    getOwnerPayments,
    getRefunds
} from "../controllers/paymentController.js";

const router = express.Router();

// Specific read routes (mounted before :paymentId)
router.get(
    "/payments/farmer",
    authenticateUser,
    authorizeRoles("FARMER"),
    getFarmerPayments
);

router.get(
    "/payments/owner",
    authenticateUser,
    authorizeRoles("OWNER"),
    getOwnerPayments
);

router.get(
    "/payments/refunds",
    authenticateUser,
    authorizeRoles("OWNER", "FARMER", "AREA_ADMIN", "SUPER_ADMIN"),
    getRefunds
);

router.get(
    "/payments/booking/:bookingId",
    authenticateUser,
    getBookingPayments
);

// 1. Farmer submits advance payment
router.post(
    "/payments",
    authenticateUser,
    authorizeRoles("FARMER"),
    submitPayment
);

// 2. Read single payment by ID
router.get(
    "/payments/:paymentId",
    authenticateUser,
    getPaymentById
);

// 3. Owner verifies advance payment
router.patch(
    "/payments/:paymentId/verify",
    authenticateUser,
    authorizeRoles("OWNER"),
    verifyPayment
);

// 4. Owner rejects advance payment
router.patch(
    "/payments/:paymentId/reject",
    authenticateUser,
    authorizeRoles("OWNER"),
    rejectPayment
);

// 5. Authorized owner (or Area/Super Admin) submits refund details
router.patch(
    "/payments/:paymentId/refund",
    authenticateUser,
    authorizeRoles("OWNER", "AREA_ADMIN", "SUPER_ADMIN"),
    submitRefund
);

// 6. Farmer confirms receipt of refund
router.patch(
    "/payments/:paymentId/refund/confirm",
    authenticateUser,
    authorizeRoles("FARMER"),
    confirmRefund
);

// 7. Farmer raises refund dispute
router.patch(
    "/payments/:paymentId/refund/dispute",
    authenticateUser,
    authorizeRoles("FARMER"),
    disputeRefund
);

export default router;
