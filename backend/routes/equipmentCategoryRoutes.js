import express from "express";
import {
    createEquipmentCategory,
    getEquipmentCategories,
    getEquipmentCategoryById,
    updateEquipmentCategory,
    deleteEquipmentCategory
} from "../controllers/equipmentCategoryController.js";
import { authenticateUser, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public routes: List and view equipment categories
router.get(
    "/equipment-categories",
    getEquipmentCategories
);

router.get(
    "/equipment-categories/:categoryId",
    getEquipmentCategoryById
);

// Protected routes: SUPER_ADMIN only
router.post(
    "/equipment-categories",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    createEquipmentCategory
);

router.put(
    "/equipment-categories/:categoryId",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    updateEquipmentCategory
);

router.patch(
    "/equipment-categories/:categoryId",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    updateEquipmentCategory
);

router.delete(
    "/equipment-categories/:categoryId",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    deleteEquipmentCategory
);

export default router;
