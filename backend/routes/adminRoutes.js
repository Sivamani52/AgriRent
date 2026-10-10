import express from "express";
import { getRefundDisputes } from "../controllers/adminController.js";
import { authenticateUser, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get(
    "/admin/refund-disputes",
    authenticateUser,
    authorizeRoles("AREA_ADMIN", "SUPER_ADMIN"),
    getRefundDisputes
);

export default router;
