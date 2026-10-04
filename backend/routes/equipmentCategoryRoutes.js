import express from "express";

import {
    createEquipmentCategory,
    getEquipmentCategories,
    getEquipmentCategoryById,
    updateEquipmentCategory,
    deleteEquipmentCategory
} from "../controllers/equipmentCategoryController.js";

const router = express.Router();

// List equipment categories (supports ?status=ACTIVE|INACTIVE|ALL and ?search=...)
router.get(
    "/equipment-categories",
    getEquipmentCategories
);

// Get equipment category by ID
router.get(
    "/equipment-categories/:categoryId",
    getEquipmentCategoryById
);

// Create new equipment category
router.post(
    "/equipment-categories",
    createEquipmentCategory
);

// Update equipment category
router.put(
    "/equipment-categories/:categoryId",
    updateEquipmentCategory
);

router.patch(
    "/equipment-categories/:categoryId",
    updateEquipmentCategory
);

// Delete equipment category
router.delete(
    "/equipment-categories/:categoryId",
    deleteEquipmentCategory
);

export default router;