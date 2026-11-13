import express from "express";
import {
    getLocations,
    getLocationById,
    createLocation,
    updateLocation,
    deleteLocation
} from "../controllers/locationController.js";
import { authenticateUser, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/locations", getLocations);
router.get("/locations/:locationId", getLocationById);

router.post(
    "/locations",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    createLocation
);

router.put(
    "/locations/:locationId",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    updateLocation
);

router.delete(
    "/locations/:locationId",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    deleteLocation
);

export default router;

