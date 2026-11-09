import express from "express";
import upload from "../middleware/uploadMiddleware.js";
import { authenticateUser, authorizeRoles } from "../middleware/authMiddleware.js";

import {
    uploadEquipmentMedia,
    getEquipmentMedia,
    deleteEquipmentMedia,
    getOwnerEquipmentMedia
} from "../controllers/equipmentMediaController.js";

const router = express.Router();

// Public route: View media for an equipment
router.get(
    "/equipment/:equipmentId/media",
    getEquipmentMedia
);

// Protected routes:
// 1. Owner uploads media for their own equipment
router.post(
    "/equipment/:equipmentId/media",
    authenticateUser,
    authorizeRoles("OWNER"),
    upload.single("media"),
    uploadEquipmentMedia
);

// 2. Owner accesses their private media management (or admin in area / super admin)
router.get(
    "/equipment/owner/:ownerId/media",
    authenticateUser,
    authorizeRoles("OWNER", "AREA_ADMIN", "SUPER_ADMIN"),
    getOwnerEquipmentMedia
);

// 3. Authorized deletion: Owner of equipment or authorized Admin
router.delete(
    "/equipment/:equipmentId/media/:mediaId",
    authenticateUser,
    authorizeRoles("OWNER", "AREA_ADMIN", "SUPER_ADMIN"),
    deleteEquipmentMedia
);

export default router;
