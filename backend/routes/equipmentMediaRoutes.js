import express from "express";
import upload from "../middleware/uploadMiddleware.js";
import {
    uploadEquipmentMedia,
    getEquipmentMedia,
    deleteEquipmentMedia
} from "../controllers/equipmentMediaController.js";
const router = express.Router();

router.post(
    "/equipment/:equipmentId/media",
    upload.single("media"),
    uploadEquipmentMedia
);

router.get(
    "/equipment/:equipmentId/media",
    getEquipmentMedia
);

router.delete(
    "/equipment/:equipmentId/media/:mediaId",
    deleteEquipmentMedia
);

export default router;