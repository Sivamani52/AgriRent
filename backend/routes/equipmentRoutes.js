import express from "express";

import {
    updateEquipmentStatus,
    getEquipmentById,
    getAvailableEquipment,
    updateEquipmentVerification,
    createEquipment,
    updateEquipment,
    deleteEquipment,
    searchEquipment,
    getEquipmentByOwner
} from "../controllers/equipmentController.js";
import { authenticateUser, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public routes for searching and browsing verified available equipment
router.get(
    "/equipment/search",
    searchEquipment
);

router.get(
    "/equipment",
    getAvailableEquipment
);

router.get(
    "/equipment/:equipmentId",
    getEquipmentById
);

// Protected routes
router.get(
    "/equipment/owner/:ownerId",
    authenticateUser,
    authorizeRoles("OWNER", "AREA_ADMIN", "SUPER_ADMIN"),
    getEquipmentByOwner
);

router.post(
    "/equipment",
    authenticateUser,
    authorizeRoles("OWNER"),
    createEquipment
);

router.put(
    "/equipment/:equipmentId",
    authenticateUser,
    authorizeRoles("OWNER"),
    updateEquipment
);

router.delete(
    "/equipment/:equipmentId",
    authenticateUser,
    authorizeRoles("OWNER"),
    deleteEquipment
);

router.patch(
    "/equipment/:equipmentId/status",
    authenticateUser,
    authorizeRoles("OWNER", "AREA_ADMIN", "SUPER_ADMIN"),
    updateEquipmentStatus
);

router.patch(
    "/equipment/:equipmentId/verification",
    authenticateUser,
    authorizeRoles("AREA_ADMIN", "SUPER_ADMIN"),
    updateEquipmentVerification
);

export default router;
