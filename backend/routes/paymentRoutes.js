import express from "express";

import {
    submitPayment,
    verifyPayment,
    rejectPayment
} from "../controllers/paymentController.js";

const router = express.Router();

router.post("/payments", submitPayment);
router.patch("/payments/:paymentId/verify", verifyPayment);
router.patch("/payments/:paymentId/reject", rejectPayment);

export default router;