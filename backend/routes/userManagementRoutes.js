import express from "express";
import {
    createAreaAdmin,
    getAreaAdmins,
    updateAreaAdminLocation,
    getUsersList,
    searchFarmers
} from "../controllers/userManagementController.js";
import { authenticateUser, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// Super Admin: Area Admin management
router.post(
    "/admin/super/area-admins",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    createAreaAdmin
);

router.get(
    "/admin/super/area-admins",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    getAreaAdmins
);

router.patch(
    "/admin/super/area-admins/:areaAdminId/location",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    updateAreaAdminLocation
);

// Super Admin: Platform user monitoring
router.get(
    "/admin/super/users",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    getUsersList
);

// Area Admin & Super Admin: Farmer lookup for assisted booking
router.get(
    "/admin/farmers/search",
    authenticateUser,
    authorizeRoles("AREA_ADMIN", "SUPER_ADMIN"),
    searchFarmers
);

export default router;

