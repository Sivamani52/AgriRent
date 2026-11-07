import express from "express";
import upload from "../middleware/uploadMiddleware.js";
import { authenticateUser, authorizeRoles } from "../middleware/authMiddleware.js";
import {
    submitInitialInspection,
    confirmInitialInspection,
    getInitialInspection,
    submitFinalInspection,
    confirmFinalInspection,
    getFinalInspection,
    getFullInspectionHistory
} from "../controllers/inspectionController.js";

const router = express.Router();

// =========================================================================
// STAGE 1: INITIAL INSPECTION (Pre-Handover)
// =========================================================================

// Submit / Record Stage 1 Checklist & Media
router.post(
    "/bookings/:bookingId/inspections/initial",
    authenticateUser,
    authorizeRoles("OWNER", "FARMER"),
    upload.array("media", 5),
    submitInitialInspection
);

// Confirm Stage 1 Initial Inspection (Both parties sign off -> Handover to IN_PROGRESS)
router.patch(
    "/bookings/:bookingId/inspections/initial/confirm",
    authenticateUser,
    authorizeRoles("OWNER", "FARMER"),
    confirmInitialInspection
);

// View Stage 1 Initial Inspection details & media
router.get(
    "/bookings/:bookingId/inspections/initial",
    authenticateUser,
    authorizeRoles("OWNER", "FARMER", "AREA_ADMIN", "SUPER_ADMIN"),
    getInitialInspection
);

// =========================================================================
// STAGE 2: FINAL INSPECTION (Post-Rental Return)
// =========================================================================

// Submit / Record Stage 2 Return Checklist, Damages & Media
router.post(
    "/bookings/:bookingId/inspections/final",
    authenticateUser,
    authorizeRoles("OWNER", "FARMER"),
    upload.array("media", 5),
    submitFinalInspection
);

// Confirm Stage 2 Final Inspection (Both parties sign off -> Return finalized & COMPLETED)
router.patch(
    "/bookings/:bookingId/inspections/final/confirm",
    authenticateUser,
    authorizeRoles("OWNER", "FARMER"),
    confirmFinalInspection
);

// View Stage 2 Final Inspection details & media
router.get(
    "/bookings/:bookingId/inspections/final",
    authenticateUser,
    authorizeRoles("OWNER", "FARMER", "AREA_ADMIN", "SUPER_ADMIN"),
    getFinalInspection
);

// =========================================================================
// FULL INSPECTION LIFECYCLE HISTORY & COMPARISON
// =========================================================================

router.get(
    "/bookings/:bookingId/inspections",
    authenticateUser,
    authorizeRoles("OWNER", "FARMER", "AREA_ADMIN", "SUPER_ADMIN"),
    getFullInspectionHistory
);

export default router;

