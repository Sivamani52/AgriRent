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

const router = express.Router();

router.patch(
    "/equipment/:equipmentId/status",
    updateEquipmentStatus
);

router.get(
    "/equipment/search",
    searchEquipment
);

router.get(
    "/equipment/owner/:ownerId",
    getEquipmentByOwner
);

router.get(
    "/equipment/:equipmentId",
    getEquipmentById
);


router.get(
    "/equipment",
    getAvailableEquipment
);

router.patch(
    "/equipment/:equipmentId/verification",
    updateEquipmentVerification
);

router.post(
    "/equipment",
    createEquipment
);

router.put(
    "/equipment/:equipmentId",
    updateEquipment
);

router.delete(
    "/equipment/:equipmentId",
    deleteEquipment
);




export default router;