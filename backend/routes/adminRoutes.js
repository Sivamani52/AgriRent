import express from "express";
import upload from "../middleware/uploadMiddleware.js";
import {
    getRefundDisputes,
    getSuperAdminDisputesDashboard,
    getSuperAdminDisputeDossier,
    requestAdditionalEvidence,
    submitFinalDisputeDecision,
    executeUserAccountAction,
    getUserAccountAuditHistory,
    updateDisputeInvestigation,
    uploadDisputeEvidence,
    escalateDisputeToSuperAdmin
} from "../controllers/adminController.js";
import { authenticateUser, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// =========================================================================
// AREA & SUPER ADMIN SHARED DISPUTES
// =========================================================================

// Shared regional listing (Area Admin gets location-scoped, Super Admin gets platform-wide)
router.get(
    "/admin/refund-disputes",
    authenticateUser,
    authorizeRoles("AREA_ADMIN", "SUPER_ADMIN"),
    getRefundDisputes
);

// Area Admin / Super Admin records investigation findings, recommendations, and notes
router.put(
    "/admin/disputes/:disputeId/investigation",
    authenticateUser,
    authorizeRoles("AREA_ADMIN", "SUPER_ADMIN"),
    updateDisputeInvestigation
);

// Upload supporting evidence files (images/documents) to dispute
router.post(
    "/admin/disputes/:disputeId/evidence",
    authenticateUser,
    authorizeRoles("AREA_ADMIN", "SUPER_ADMIN", "OWNER", "FARMER"),
    upload.array("evidence", 5),
    uploadDisputeEvidence
);

// Area Admin manually escalates an unresolved dispute to Super Admin
router.post(
    "/admin/disputes/:disputeId/escalate",
    authenticateUser,
    authorizeRoles("AREA_ADMIN"),
    escalateDisputeToSuperAdmin
);

// =========================================================================
// SUPER ADMIN FINAL DISPUTE RESOLUTION & DOSSIER REVIEW
// =========================================================================

// Feature 1: Super Admin Platform-Wide Disputes Dashboard
router.get(
    "/admin/super/disputes",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    getSuperAdminDisputesDashboard
);

// Feature 2: Investigation Review (Full Composite Dossier)
router.get(
    "/admin/super/disputes/:disputeId",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    getSuperAdminDisputeDossier
);

// Feature 3: Request Additional Evidence / Remand to Area Admin
router.post(
    "/admin/super/disputes/:disputeId/request-evidence",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    requestAdditionalEvidence
);

// Features 4 & 9: Final Binding Dispute Decision & Refund Integration
router.post(
    "/admin/super/disputes/:disputeId/decide",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    submitFinalDisputeDecision
);

// =========================================================================
// SUPER ADMIN ACCOUNT ADMINISTRATION (FEATURE 5)
// =========================================================================

// Issue warning, temporary suspension, permanent block, or reactivation
router.post(
    "/admin/super/users/:userId/account-action",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    executeUserAccountAction
);

// View user disciplinary and dispute audit trail
router.get(
    "/admin/super/users/:userId/audit-history",
    authenticateUser,
    authorizeRoles("SUPER_ADMIN"),
    getUserAccountAuditHistory
);

export default router;
