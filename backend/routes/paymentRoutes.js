import express from "express";

import {
    submitPayment,
    verifyPayment,
    rejectPayment,
    submitRefund,
     confirmRefund,
     disputeRefund
} from "../controllers/paymentController.js";

const router = express.Router();

router.post("/payments", submitPayment);
router.patch("/payments/:paymentId/verify", verifyPayment);
router.patch("/payments/:paymentId/reject", rejectPayment);
router.patch("/payments/:paymentId/refund", submitRefund);
router.patch("/payments/:paymentId/refund/confirm",confirmRefund);
router.patch("/payments/:paymentId/refund/dispute", disputeRefund);



export default router;