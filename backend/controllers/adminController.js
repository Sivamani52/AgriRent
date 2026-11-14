import pool from "../db.js";
import cloudinary from "../config/cloudinary.js";
import {
    sendSuperAdminDisputeDecisionEmail,
    sendAdditionalEvidenceRequestedEmail,
    sendAccountActionEmail,
    sendSuperAdminEscalationEmail
} from "../services/notificationService.js";

const VALID_CASE_STATUSES = [
    "OPEN",
    "UNDER_ADMIN_REVIEW",
    "EVIDENCE_REQUESTED",
    "ESCALATED_TO_SUPER_ADMIN",
    "RESOLVED",
    "CLOSED"
];

/**
 * GET /api/admin/refund-disputes
 * Retrieves refund disputes for SUPER_ADMIN (platform-wide) and AREA_ADMIN (location-scoped).
 * Optional query parameter: ?status=OPEN
 */
export const getRefundDisputes = async (req, res) => {
    try {
        const { role, location_id, area_admin_id } = req.user;  
        const { status } = req.query;

        // Validate optional status query parameter
        if (status && !VALID_CASE_STATUSES.includes(status.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: `Invalid status filter. Allowed values: ${VALID_CASE_STATUSES.join(", ")}`
            });
        }

        let query = `
            SELECT
                rd.id AS dispute_id,
                rd.payment_id,
                rd.booking_id,
                rd.dispute_reason,
                rd.dispute_category,
                rd.status AS case_status,
                rd.assigned_area_admin_id,
                rd.admin_notes,
                COALESCE(bp.amount, b.total_amount, 0) AS payment_amount,
                bp.refund_status,
                bp.refund_transaction_id,
                bp.refund_submitted_at,
                rd.created_at,
                rd.updated_at,
                fu.full_name AS farmer_name,
                fu.phone AS farmer_phone,
                ou.full_name AS owner_name,
                ou.phone AS owner_phone,
                e.name AS equipment_name,
                l.district,
                l.state
            FROM refund_disputes rd
            LEFT JOIN booking_payments bp ON rd.payment_id = bp.id
            INNER JOIN bookings b ON rd.booking_id = b.id
            INNER JOIN equipment e ON b.equipment_id = e.id
            LEFT JOIN locations l ON e.location_id = l.id
            INNER JOIN farmers f ON b.farmer_id = f.id
            INNER JOIN users fu ON f.user_id = fu.id
            INNER JOIN owners o ON e.owner_id = o.id
            INNER JOIN users ou ON o.user_id = ou.id
            WHERE 1=1
        `;

        const queryParams = [];

        // Role-based access control:
        if (role === "AREA_ADMIN") {
            if (location_id) {
                query += ` AND (e.location_id = ? OR rd.assigned_area_admin_id = ?)`;
                queryParams.push(location_id, area_admin_id || 0);
            } else if (area_admin_id) {
                query += ` AND rd.assigned_area_admin_id = ?`;
                queryParams.push(area_admin_id);
            }
        }

        if (status) {
            query += ` AND rd.status = ?`;
            queryParams.push(status.toUpperCase());
        }

        query += ` ORDER BY rd.created_at DESC`;

        const [rows] = await pool.query(query, queryParams);

        const formattedDisputes = rows.map((row) => ({
            dispute_id: row.dispute_id,
            payment_id: row.payment_id,
            booking_id: row.booking_id,
            dispute_reason: row.dispute_reason,
            dispute_category: row.dispute_category,
            case_status: row.case_status,
            assigned_area_admin_id: row.assigned_area_admin_id,
            admin_notes: row.admin_notes,
            payment_amount: Number(row.payment_amount),
            refund_status: row.refund_status,
            refund_transaction_id: row.refund_transaction_id,
            refund_submitted_at: row.refund_submitted_at,
            farmer_name: row.farmer_name,
            farmer_phone: row.farmer_phone,
            owner_name: row.owner_name,
            owner_phone: row.owner_phone,
            equipment_name: row.equipment_name,
            location: row.district ? `${row.district}, ${row.state}` : "N/A",
            created_at: row.created_at,
            updated_at: row.updated_at
        }));

        return res.status(200).json({
            success: true,
            count: formattedDisputes.length,
            data: formattedDisputes
        });

    } catch (error) {
        console.error("Error fetching refund disputes:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch refund disputes"
        });
    }
};

// =========================================================================
// SUPER ADMIN FINAL DISPUTE RESOLUTION CONTROLLERS
// =========================================================================

/**
 * GET /api/admin/super/disputes
 * Feature 1: Super Admin Platform-Wide Dispute Dashboard
 * Shows all disputes across all geographical locations with full booking,
 * payment, refund, farmer, owner, and escalation metrics.
 */
export const getSuperAdminDisputesDashboard = async (req, res) => {
    try {
        if (req.user.role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Access restricted: Only Super Admin can access the global disputes dashboard"
            });
        }

        const { status } = req.query;

        let query = `
            SELECT
                rd.id AS dispute_id,
                rd.booking_id,
                rd.payment_id,
                rd.dispute_category,
                rd.dispute_reason,
                rd.status AS dispute_status,
                rd.escalation_reason,
                rd.escalated_at,
                rd.resolution_outcome,
                rd.resolution_explanation,
                rd.resolved_at,
                rd.super_admin_remarks,
                rd.created_at AS dispute_created_at,
                COALESCE(bp.amount, b.total_amount, 0) AS dispute_amount,
                -- Farmer details
                fu.id AS farmer_user_id,
                fu.full_name AS farmer_name,
                fu.phone AS farmer_phone,
                fu.email AS farmer_email,
                fu.status AS farmer_account_status,
                -- Owner details
                ou.id AS owner_user_id,
                ou.full_name AS owner_name,
                ou.phone AS owner_phone,
                ou.email AS owner_email,
                ou.status AS owner_account_status,
                -- Original Payment Details
                bp.transaction_id,
                bp.payment_method,
                bp.status AS payment_status,
                bp.submitted_at AS payment_submitted_at,
                bp.verified_at AS payment_verified_at,
                -- Refund details
                bp.refund_status,
                bp.refund_transaction_id,
                bp.refund_submitted_at,
                bp.refund_deadline,
                bp.refund_verified_at,
                -- Equipment details
                e.id AS equipment_id,
                e.name AS equipment_name,
                e.status AS equipment_status,
                l.district,
                l.state,
                -- Area Admin details
                aa.id AS area_admin_id,
                aau.full_name AS area_admin_name,
                aau.phone AS area_admin_phone
            FROM refund_disputes rd
            INNER JOIN bookings b ON rd.booking_id = b.id
            LEFT JOIN booking_payments bp ON rd.payment_id = bp.id
            INNER JOIN equipment e ON b.equipment_id = e.id
            LEFT JOIN locations l ON e.location_id = l.id
            INNER JOIN farmers f ON b.farmer_id = f.id
            INNER JOIN users fu ON f.user_id = fu.id
            INNER JOIN owners o ON e.owner_id = o.id
            INNER JOIN users ou ON o.user_id = ou.id
            LEFT JOIN area_admins aa ON rd.assigned_area_admin_id = aa.id
            LEFT JOIN users aau ON aa.user_id = aau.id
            WHERE 1=1
        `;

        const queryParams = [];
        if (status) {
            query += ` AND rd.status = ?`;
            queryParams.push(status.toUpperCase());
        }

        query += ` ORDER BY rd.created_at DESC`;

        const [rows] = await pool.query(query, queryParams);

        const formatted = rows.map(r => ({
            disputeId: r.dispute_id,
            bookingId: r.booking_id,
            disputeCategory: r.dispute_category,
            disputeReason: r.dispute_reason,
            disputeAmount: Number(r.dispute_amount),
            status: r.dispute_status,
            escalatedAt: r.escalated_at,
            escalationReason: r.escalation_reason,
            resolutionOutcome: r.resolution_outcome,
            resolvedAt: r.resolved_at,
            createdAt: r.dispute_created_at,
            farmer: {
                userId: r.farmer_user_id,
                name: r.farmer_name,
                phone: r.farmer_phone,
                email: r.farmer_email,
                accountStatus: r.farmer_account_status
            },
            owner: {
                userId: r.owner_user_id,
                name: r.owner_name,
                phone: r.owner_phone,
                email: r.owner_email,
                accountStatus: r.owner_account_status
            },
            equipment: {
                id: r.equipment_id,
                name: r.equipment_name,
                status: r.equipment_status,
                location: r.district ? `${r.district}, ${r.state}` : "N/A"
            },
            payment: r.transaction_id ? {
                paymentId: r.payment_id,
                transactionId: r.transaction_id,
                method: r.payment_method,
                status: r.payment_status,
                submittedAt: r.payment_submitted_at,
                verifiedAt: r.payment_verified_at
            } : null,
            refund: {
                refundStatus: r.refund_status || "NOT_REQUIRED",
                refundTransactionId: r.refund_transaction_id,
                refundSubmittedAt: r.refund_submitted_at,
                refundDeadline: r.refund_deadline,
                refundVerifiedAt: r.refund_verified_at
            },
            assignedAreaAdmin: r.area_admin_id ? {
                id: r.area_admin_id,
                name: r.area_admin_name,
                phone: r.area_admin_phone
            } : null
        }));

        return res.status(200).json({
            success: true,
            count: formatted.length,
            data: formatted
        });

    } catch (error) {
        console.error("Super Admin dashboard error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch Super Admin dispute dashboard"
        });
    }
};

/**
 * GET /api/admin/super/disputes/:disputeId
 * Feature 2: Investigation Review (Full Composite Dossier)
 * Aggregates complaints, owner explanations, area admin reports,
 * inspection photos/videos, evidence files, and audit trail.
 */
export const getSuperAdminDisputeDossier = async (req, res) => {
    try {
        if (req.user.role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Access restricted: Only Super Admin can review complete dispute dossiers"
            });
        }

        const { disputeId } = req.params;

        // 1. Fetch primary dispute record with joins
        const [disputes] = await pool.query(
            `SELECT
                rd.*,
                b.total_amount,
                b.advance_amount,
                b.start_date,
                b.end_date,
                b.status AS booking_status,
                b.handover_completed_at,
                b.return_completed_at,
                bp.amount AS payment_amount,
                bp.transaction_id,
                bp.payment_method,
                bp.status AS payment_status,
                bp.refund_status,
                bp.refund_transaction_id,
                bp.refund_submitted_at,
                bp.refund_deadline,
                bp.refund_verified_at,
                fu.id AS farmer_user_id,
                fu.full_name AS farmer_name,
                fu.phone AS farmer_phone,
                fu.email AS farmer_email,
                fu.status AS farmer_account_status,
                ou.id AS owner_user_id,
                ou.full_name AS owner_name,
                ou.phone AS owner_phone,
                ou.email AS owner_email,
                ou.status AS owner_account_status,
                e.id AS equipment_id,
                e.name AS equipment_name,
                e.status AS equipment_status,
                l.district,
                l.state,
                aa.id AS area_admin_id,
                aau.full_name AS area_admin_name,
                aau.phone AS area_admin_phone
             FROM refund_disputes rd
             INNER JOIN bookings b ON rd.booking_id = b.id
             LEFT JOIN booking_payments bp ON rd.payment_id = bp.id
             INNER JOIN equipment e ON b.equipment_id = e.id
             LEFT JOIN locations l ON e.location_id = l.id
             INNER JOIN farmers f ON b.farmer_id = f.id
             INNER JOIN users fu ON f.user_id = fu.id
             INNER JOIN owners o ON e.owner_id = o.id
             INNER JOIN users ou ON o.user_id = ou.id
             LEFT JOIN area_admins aa ON rd.assigned_area_admin_id = aa.id
             LEFT JOIN users aau ON aa.user_id = aau.id
             WHERE rd.id = ?`,
            [disputeId]
        );

        if (disputes.length === 0) {
            return res.status(404).json({ success: false, message: "Dispute not found" });
        }

        const d = disputes[0];

        // 2. Fetch evidence uploaded to dispute_evidence
        const [evidenceRows] = await pool.query(
            `SELECT de.*, u.full_name AS uploaded_by_name, u.role AS uploaded_by_role
             FROM dispute_evidence de
             JOIN users u ON de.uploaded_by_user_id = u.id
             WHERE de.dispute_id = ?
             ORDER BY de.created_at ASC`,
            [disputeId]
        );

        // 3. Fetch inspection history & media for this booking (Initial & Final)
        const [inspections] = await pool.query(
            `SELECT ei.*, u.full_name AS inspector_name
             FROM equipment_inspections ei
             JOIN users u ON ei.inspector_user_id = u.id
             WHERE ei.booking_id = ?
             ORDER BY ei.inspection_stage ASC, ei.created_at ASC`,
            [d.booking_id]
        );

        for (const insp of inspections) {
            const [media] = await pool.query(
                `SELECT id, media_type, file_url, is_deleted, created_at
                 FROM inspection_media
                 WHERE inspection_id = ?`,
                [insp.id]
            );
            insp.media = media.map(m => ({
                id: m.id,
                media_type: m.media_type,
                file_url: m.is_deleted ? null : m.file_url,
                is_deleted: Boolean(m.is_deleted),
                created_at: m.created_at
            }));
        }

        // 4. Fetch audit trail for this dispute
        const [auditLogs] = await pool.query(
            `SELECT dal.*, u.full_name AS performed_by_name
             FROM dispute_audit_logs dal
             JOIN users u ON dal.performed_by_user_id = u.id
             WHERE dal.dispute_id = ?
             ORDER BY dal.created_at ASC`,
            [disputeId]
        );

        return res.status(200).json({
            success: true,
            data: {
                disputeId: d.id,
                bookingId: d.booking_id,
                paymentId: d.payment_id,
                disputeCategory: d.dispute_category,
                disputeReason: d.dispute_reason,
                status: d.status,
                escalatedAt: d.escalated_at,
                escalationReason: d.escalation_reason,
                resolutionOutcome: d.resolution_outcome,
                resolutionExplanation: d.resolution_explanation,
                resolvedAt: d.resolved_at,
                superAdminRemarks: d.super_admin_remarks,
                evidenceRequestInstructions: d.evidence_request_instructions,
                adminNotes: d.admin_notes,
                ownerExplanation: d.owner_explanation,
                investigationFindings: d.investigation_findings,
                recommendedAction: d.recommended_action,
                createdAt: d.created_at,
                booking: {
                    id: d.booking_id,
                    status: d.booking_status,
                    startDate: d.start_date,
                    endDate: d.end_date,
                    totalAmount: Number(d.total_amount),
                    advanceAmount: Number(d.advance_amount),
                    handoverCompletedAt: d.handover_completed_at,
                    returnCompletedAt: d.return_completed_at
                },
                farmer: {
                    userId: d.farmer_user_id,
                    name: d.farmer_name,
                    phone: d.farmer_phone,
                    email: d.farmer_email,
                    accountStatus: d.farmer_account_status
                },
                owner: {
                    userId: d.owner_user_id,
                    name: d.owner_name,
                    phone: d.owner_phone,
                    email: d.owner_email,
                    accountStatus: d.owner_account_status
                },
                equipment: {
                    id: d.equipment_id,
                    name: d.equipment_name,
                    status: d.equipment_status,
                    location: d.district ? `${d.district}, ${d.state}` : "N/A"
                },
                payment: d.transaction_id ? {
                    transactionId: d.transaction_id,
                    amount: Number(d.payment_amount),
                    method: d.payment_method,
                    status: d.payment_status,
                    refundStatus: d.refund_status,
                    refundTransactionId: d.refund_transaction_id,
                    refundSubmittedAt: d.refund_submitted_at,
                    refundDeadline: d.refund_deadline,
                    refundVerifiedAt: d.refund_verified_at
                } : null,
                assignedAreaAdmin: d.area_admin_id ? {
                    id: d.area_admin_id,
                    name: d.area_admin_name,
                    phone: d.area_admin_phone
                } : null,
                evidenceFiles: evidenceRows,
                inspections: inspections,
                auditTrail: auditLogs
            }
        });

    } catch (error) {
        console.error("Super Admin dossier review error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch dispute dossier"
        });
    }
};

/**
 * POST /api/admin/super/disputes/:disputeId/request-evidence
 * Feature 3: Additional Evidence Request (Remand to Area Admin)
 * Remands the case to Area Admin, updates status to 'EVIDENCE_REQUESTED',
 * preserves all previous findings, and notifies Area Admin via SMS.
 */
export const requestAdditionalEvidence = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        if (req.user.role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Access restricted: Only Super Admin can remand disputes for evidence"
            });
        }

        const { disputeId } = req.params;
        const { instructions } = req.body;

        if (!instructions || !instructions.trim()) {
            return res.status(400).json({
                success: false,
                message: "Instructions for additional evidence/investigation are required"
            });
        }

        await connection.beginTransaction();

        // Lock dispute row
        const [disputes] = await connection.query(
            `SELECT rd.id, rd.booking_id, rd.status, rd.assigned_area_admin_id,
                    aa.id AS area_admin_id, u.email AS admin_email, u.phone AS admin_phone, u.full_name AS admin_name
             FROM refund_disputes rd
             LEFT JOIN area_admins aa ON rd.assigned_area_admin_id = aa.id
             LEFT JOIN users u ON aa.user_id = u.id
             WHERE rd.id = ?
             FOR UPDATE`,
            [disputeId]
        );

        if (disputes.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Dispute not found" });
        }

        const dispute = disputes[0];

        // Reject if dispute is already resolved or closed
        if (dispute.status === "RESOLVED" || dispute.status === "CLOSED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Cannot request evidence for an already resolved dispute"
            });
        }

        // Remand case to Area Admin
        await connection.query(
            `UPDATE refund_disputes
             SET status = 'EVIDENCE_REQUESTED',
                 evidence_request_instructions = ?,
                 super_admin_remarks = ?,
                 admin_notes = CONCAT(COALESCE(admin_notes, ''), '\n[', NOW(), ' Super Admin Remand]: ', ?)
             WHERE id = ?`,
            [instructions.trim(), instructions.trim(), instructions.trim(), disputeId]
        );

        // Record immutable audit log
        await connection.query(
            `INSERT INTO dispute_audit_logs (dispute_id, action_type, performed_by_user_id, performed_by_role, details)
             VALUES (?, 'EVIDENCE_REQUESTED_BY_SUPER_ADMIN', ?, 'SUPER_ADMIN', ?)`,
            [disputeId, req.user.id, `Instructions: ${instructions.trim()}`]
        );

        await connection.commit();

        // Dispatch Email to Area Admin (via Brevo Email)
        if (dispute.admin_email) {
            sendAdditionalEvidenceRequestedEmail({
                adminEmail: dispute.admin_email,
                adminName: dispute.admin_name,
                disputeId,
                bookingId: dispute.booking_id,
                instructions: instructions.trim()
            }).catch(err => console.error("Evidence request email error:", err));
        }

        return res.status(200).json({
            success: true,
            message: "Dispute successfully remanded to Area Admin for additional evidence",
            data: {
                disputeId: Number(disputeId),
                status: "EVIDENCE_REQUESTED",
                instructions: instructions.trim()
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Request additional evidence error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to request additional evidence"
        });
    } finally {
        connection.release();
    }
};

/**
 * POST /api/admin/super/disputes/:disputeId/decide
 * Features 4 & 9: Final Dispute Decision & Refund Integration
 * Super Admin issues binding adjudication:
 * - REFUND_REQUIRED: orders refund; transitions booking_payments to REFUND_REQUIRED with 24h deadline.
 * - REFUND_CONFIRMED: verifies completed refund.
 * - DISPUTE_REJECTED: rejects dispute claim.
 * - ACCOUNT_ACTION_REQUIRED: marks dispute resolved with account sanction flag.
 */
export const submitFinalDisputeDecision = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        if (req.user.role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Access restricted: Only Super Admin has authority to issue final dispute decisions"
            });
        }

        const { disputeId } = req.params;
        const { decision, reason, remarks } = req.body;

        const ALLOWED_DECISIONS = [
            "REFUND_REQUIRED",
            "REFUND_CONFIRMED",
            "DISPUTE_REJECTED",
            "ACCOUNT_ACTION_REQUIRED"
        ];

        if (!ALLOWED_DECISIONS.includes(decision)) {
            return res.status(400).json({
                success: false,
                message: `Invalid decision. Allowed decisions: ${ALLOWED_DECISIONS.join(", ")}`
            });
        }

        if (!reason || !reason.trim()) {
            return res.status(400).json({
                success: false,
                message: "Decision reason is required"
            });
        }

        await connection.beginTransaction();

        // 1. Lock dispute and related records
        const [disputes] = await connection.query(
            `SELECT
                rd.id AS dispute_id,
                rd.booking_id,
                rd.payment_id,
                rd.status AS dispute_status,
                rd.dispute_category,
                b.total_amount,
                b.equipment_id,
                e.name AS equipment_name,
                bp.amount AS payment_amount,
                bp.refund_status,
                fu.email AS farmer_email,
                fu.phone AS farmer_phone,
                fu.full_name AS farmer_name,
                ou.email AS owner_email,
                ou.phone AS owner_phone,
                ou.full_name AS owner_name,
                aau.email AS admin_email,
                aau.phone AS admin_phone,
                aau.full_name AS admin_name
             FROM refund_disputes rd
             INNER JOIN bookings b ON rd.booking_id = b.id
             INNER JOIN equipment e ON b.equipment_id = e.id
             LEFT JOIN booking_payments bp ON rd.payment_id = bp.id
             INNER JOIN farmers f ON b.farmer_id = f.id
             INNER JOIN users fu ON f.user_id = fu.id
             INNER JOIN owners o ON e.owner_id = o.id
             INNER JOIN users ou ON o.user_id = ou.id
             LEFT JOIN area_admins aa ON rd.assigned_area_admin_id = aa.id
             LEFT JOIN users aau ON aa.user_id = aau.id
             WHERE rd.id = ?
             FOR UPDATE`,
            [disputeId]
        );

        if (disputes.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Dispute not found" });
        }

        const d = disputes[0];

        // 2. Prevent duplicate final decisions (Feature 7)
        if (d.dispute_status === "RESOLVED" || d.dispute_status === "CLOSED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Dispute has already been resolved with a final decision and cannot be re-adjudicated"
            });
        }

        // 3. Apply Decision Logic
        if (decision === "REFUND_REQUIRED") {
            // Dispute status -> RESOLVED with REFUND_REQUIRED
            await connection.query(
                `UPDATE refund_disputes
                 SET status = 'RESOLVED',
                     resolution_outcome = 'REFUND_REQUIRED',
                     resolution_explanation = ?,
                     super_admin_remarks = ?,
                     resolved_by_user_id = ?,
                     resolved_at = NOW()
                 WHERE id = ?`,
                [reason.trim(), remarks ? remarks.trim() : null, req.user.id, disputeId]
            );

            // Update booking payment refund workflow (Feature 9)
            if (d.payment_id) {
                await connection.query(
                    `UPDATE booking_payments
                     SET status = 'PAYMENT_REJECTED',
                         refund_status = 'REFUND_REQUIRED',
                         refund_required_at = NOW(),
                         refund_deadline = DATE_ADD(NOW(), INTERVAL 24 HOUR),
                         rejection_reason = ?
                     WHERE id = ?`,
                    [`Super Admin ruling: ${reason.trim()}`, d.payment_id]
                );
            }

            // Update booking status
            await connection.query(
                `UPDATE bookings
                 SET cancellation_reason = ?
                 WHERE id = ?`,
                [`Super Admin dispute resolution: Refund ordered. ${reason.trim()}`, d.booking_id]
            );

        } else if (decision === "REFUND_CONFIRMED") {
            await connection.query(
                `UPDATE refund_disputes
                 SET status = 'RESOLVED',
                     resolution_outcome = 'REFUND_CONFIRMED',
                     resolution_explanation = ?,
                     super_admin_remarks = ?,
                     resolved_by_user_id = ?,
                     resolved_at = NOW()
                 WHERE id = ?`,
                [reason.trim(), remarks ? remarks.trim() : null, req.user.id, disputeId]
            );

            if (d.payment_id) {
                await connection.query(
                    `UPDATE booking_payments
                     SET status = 'REFUNDED',
                         refund_status = 'REFUNDED',
                         refund_verified_at = NOW()
                     WHERE id = ?`,
                    [d.payment_id]
                );
            }

        } else if (decision === "DISPUTE_REJECTED") {
            await connection.query(
                `UPDATE refund_disputes
                 SET status = 'RESOLVED',
                     resolution_outcome = 'DISPUTE_REJECTED',
                     resolution_explanation = ?,
                     super_admin_remarks = ?,
                     resolved_by_user_id = ?,
                     resolved_at = NOW()
                 WHERE id = ?`,
                [reason.trim(), remarks ? remarks.trim() : null, req.user.id, disputeId]
            );

            // If booking was placed in DISPUTED, mark COMPLETED and restore equipment to AVAILABLE
            await connection.query(
                `UPDATE bookings SET status = 'COMPLETED' WHERE id = ? AND status = 'DISPUTED'`,
                [d.booking_id]
            );

            // Restore equipment to AVAILABLE if no other active booking prevents it
            const [otherActive] = await connection.query(
                `SELECT id FROM bookings WHERE equipment_id = ? AND status IN ('ACCEPTED', 'CONFIRMED', 'IN_PROGRESS') AND id != ?`,
                [d.equipment_id, d.booking_id]
            );
            if (otherActive.length === 0) {
                await connection.query(
                    `UPDATE equipment SET status = 'AVAILABLE' WHERE id = ? AND status = 'DAMAGED'`,
                    [d.equipment_id]
                );
            }

        } else if (decision === "ACCOUNT_ACTION_REQUIRED") {
            await connection.query(
                `UPDATE refund_disputes
                 SET status = 'RESOLVED',
                     resolution_outcome = 'ACCOUNT_ACTION_REQUIRED',
                     resolution_explanation = ?,
                     super_admin_remarks = ?,
                     resolved_by_user_id = ?,
                     resolved_at = NOW()
                 WHERE id = ?`,
                [reason.trim(), remarks ? remarks.trim() : null, req.user.id, disputeId]
            );
        }

        // 4. Record audit log
        await connection.query(
            `INSERT INTO dispute_audit_logs (dispute_id, action_type, performed_by_user_id, performed_by_role, details)
             VALUES (?, 'FINAL_DECISION_ISSUED', ?, 'SUPER_ADMIN', ?)`,
            [disputeId, req.user.id, JSON.stringify({ decision, reason: reason.trim(), remarks: remarks || null })]
        );

        await connection.commit();

        // 5. Multi-Party Email Notifications (via Brevo Email)
        const notifyParams = {
            disputeId,
            bookingId: d.booking_id,
            decision,
            remarks: reason.trim()
        };

        if (d.farmer_email) {
            sendSuperAdminDisputeDecisionEmail({
                recipientEmail: d.farmer_email,
                recipientName: d.farmer_name,
                ...notifyParams
            }).catch(err => console.error("Farmer decision email error:", err));
        }

        if (d.owner_email) {
            sendSuperAdminDisputeDecisionEmail({
                recipientEmail: d.owner_email,
                recipientName: d.owner_name,
                ...notifyParams
            }).catch(err => console.error("Owner decision email error:", err));
        }

        if (d.admin_email) {
            sendSuperAdminDisputeDecisionEmail({
                recipientEmail: d.admin_email,
                recipientName: d.admin_name,
                ...notifyParams
            }).catch(err => console.error("Area Admin decision email error:", err));
        }

        return res.status(200).json({
            success: true,
            message: `Final dispute decision '${decision}' successfully executed and recorded`,
            data: {
                disputeId: Number(disputeId),
                bookingId: d.booking_id,
                decision,
                reason: reason.trim(),
                resolvedByUserId: req.user.id,
                resolvedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Submit final dispute decision error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to submit final dispute decision"
        });
    } finally {
        connection.release();
    }
};

/**
 * POST /api/admin/super/users/:userId/account-action
 * Feature 5: Account Administration (Warnings, Suspensions, Blocks, Reactivations)
 * Strictly restricted to SUPER_ADMIN.
 * AREA_ADMIN is barred from accessing this endpoint.
 */
export const executeUserAccountAction = async (req, res) => {
    try {
        if (req.user.role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Access restricted: Only Super Admin has authority to issue account warnings, suspensions, or blocks"
            });
        }

        const { userId } = req.params;
        const { actionType, reason, durationDays, disputeId } = req.body;

        const ALLOWED_ACTIONS = ["WARN", "SUSPEND", "BLOCK", "REACTIVATE"];
        if (!ALLOWED_ACTIONS.includes(actionType)) {
            return res.status(400).json({
                success: false,
                message: `Invalid action type. Allowed: ${ALLOWED_ACTIONS.join(", ")}`
            });
        }

        if (!reason || !reason.trim()) {
            return res.status(400).json({
                success: false,
                message: "A justification reason is required for account administration actions"
            });
        }

        // Verify target user exists and is not a SUPER_ADMIN
        const [users] = await pool.query(
            "SELECT id, full_name, email, phone, role, status, warning_count FROM users WHERE id = ?",
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: "Target user not found" });
        }

        const targetUser = users[0];
        if (targetUser.role === "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Super Admin accounts cannot be suspended or blocked"
            });
        }

        let updatedStatus = targetUser.status;
        let suspendedUntil = null;
        let durationStr = null;
        let auditAction = "";

        if (actionType === "WARN") {
            await pool.query(
                "UPDATE users SET warning_count = warning_count + 1 WHERE id = ?",
                [userId]
            );
            auditAction = "USER_WARNING_ISSUED";

        } else if (actionType === "SUSPEND") {
            const days = Number(durationDays) > 0 ? Number(durationDays) : 7;
            durationStr = `${days} days`;
            await pool.query(
                `UPDATE users
                 SET status = 'SUSPENDED',
                     suspended_until = DATE_ADD(NOW(), INTERVAL ? DAY),
                     suspension_reason = ?
                 WHERE id = ?`,
                [days, reason.trim(), userId]
            );
            updatedStatus = "SUSPENDED";
            auditAction = "USER_SUSPENDED";

        } else if (actionType === "BLOCK") {
            await pool.query(
                `UPDATE users
                 SET status = 'BLOCKED',
                     suspended_until = NULL,
                     suspension_reason = ?
                 WHERE id = ?`,
                [reason.trim(), userId]
            );
            updatedStatus = "BLOCKED";
            auditAction = "USER_BLOCKED";

        } else if (actionType === "REACTIVATE") {
            await pool.query(
                `UPDATE users
                 SET status = 'ACTIVE',
                     suspended_until = NULL,
                     suspension_reason = NULL
                 WHERE id = ?`,
                [userId]
            );
            updatedStatus = "ACTIVE";
            auditAction = "USER_REACTIVATED";
        }

        // Record audit trail
        await pool.query(
            `INSERT INTO dispute_audit_logs (dispute_id, target_user_id, action_type, performed_by_user_id, performed_by_role, details)
             VALUES (?, ?, ?, ?, 'SUPER_ADMIN', ?)`,
            [disputeId || null, userId, auditAction, req.user.id, JSON.stringify({ actionType, reason: reason.trim(), durationDays: durationDays || null })]
        );

        // Notify user via Brevo Email
        if (targetUser.email) {
            sendAccountActionEmail({
                recipientEmail: targetUser.email,
                recipientName: targetUser.full_name,
                actionType,
                reason: reason.trim(),
                duration: durationStr
            }).catch(err => console.error("Account action email error:", err));
        }

        return res.status(200).json({
            success: true,
            message: `Account action '${actionType}' successfully applied to user #${userId} (${targetUser.full_name})`,
            data: {
                userId: Number(userId),
                userName: targetUser.full_name,
                actionType,
                newStatus: updatedStatus,
                reason: reason.trim(),
                duration: durationStr
            }
        });

    } catch (error) {
        console.error("Execute account action error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to execute account administration action"
        });
    }
};

/**
 * GET /api/admin/super/users/:userId/audit-history
 * Feature 7: User Disciplinary and Dispute History
 */
export const getUserAccountAuditHistory = async (req, res) => {
    try {
        if (req.user.role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Access restricted: Only Super Admin can view user audit history"
            });
        }

        const { userId } = req.params;

        const [users] = await pool.query(
            `SELECT id, full_name, phone, email, role, status, warning_count, suspended_until, suspension_reason, created_at
             FROM users WHERE id = ?`,
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const [auditLogs] = await pool.query(
            `SELECT dal.*, u.full_name AS performed_by_name
             FROM dispute_audit_logs dal
             JOIN users u ON dal.performed_by_user_id = u.id
             WHERE dal.target_user_id = ? OR dal.dispute_id IN (
                 SELECT rd.id FROM refund_disputes rd
                 JOIN bookings b ON rd.booking_id = b.id
                 JOIN equipment e ON b.equipment_id = e.id
                 LEFT JOIN owners o ON e.owner_id = o.id
                 LEFT JOIN farmers f ON b.farmer_id = f.id
                 WHERE o.user_id = ? OR f.user_id = ?
             )
             ORDER BY dal.created_at DESC`,
            [userId, userId, userId]
        );

        return res.status(200).json({
            success: true,
            data: {
                user: users[0],
                auditHistory: auditLogs
            }
        });

    } catch (error) {
        console.error("User audit history error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch user audit history"
        });
    }
};

/**
 * Helper to upload buffer to Cloudinary for dispute evidence
 */
const uploadDisputeBufferToCloudinary = (fileBuffer, resourceType = "auto", folder = "agrirent/disputes") => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: resourceType
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        stream.end(fileBuffer);
    });
};

/**
 * PUT /api/admin/disputes/:disputeId/investigation
 * Allows Area Admin (location-scoped) or Super Admin to record investigation findings,
 * recommended actions, and notes.
 * Automatically moves status from OPEN or EVIDENCE_REQUESTED to UNDER_ADMIN_REVIEW.
 */
export const updateDisputeInvestigation = async (req, res) => {
    try {
        const { disputeId } = req.params;
        const { investigationFindings, recommendedAction, adminNotes, ownerExplanation } = req.body;
        const { role, location_id, area_admin_id } = req.user;

        // Fetch dispute with location and assignment details
        const [disputes] = await pool.query(
            `SELECT rd.*, e.location_id AS equipment_location_id
             FROM refund_disputes rd
             JOIN bookings b ON rd.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             WHERE rd.id = ?`,
            [disputeId]
        );

        if (disputes.length === 0) {
            return res.status(404).json({ success: false, message: "Dispute not found" });
        }

        const dispute = disputes[0];

        // Authorization check for Area Admin
        if (role === "AREA_ADMIN") {
            const matchesLocation = location_id && dispute.equipment_location_id === location_id;
            const matchesAssignment = area_admin_id && dispute.assigned_area_admin_id === area_admin_id;
            if (!matchesLocation && !matchesAssignment) {
                return res.status(403).json({
                    success: false,
                    message: "Area Admin can only manage disputes within their assigned area"
                });
            }
        }

        if (dispute.status === "CLOSED" || dispute.status === "RESOLVED") {
            return res.status(400).json({
                success: false,
                message: "Cannot update investigation on a closed or resolved dispute"
            });
        }

        if (role === "AREA_ADMIN" && dispute.status === "ESCALATED_TO_SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "This dispute has been escalated to Super Admin and cannot be modified by Area Admin"
            });
        }

        const updates = [];
        const params = [];

        if (investigationFindings !== undefined) {
            updates.push("investigation_findings = ?");
            params.push(investigationFindings ? investigationFindings.trim() : null);
        }

        if (recommendedAction !== undefined) {
            updates.push("recommended_action = ?");
            params.push(recommendedAction ? recommendedAction.trim() : null);
        }

        if (ownerExplanation !== undefined) {
            updates.push("owner_explanation = ?");
            params.push(ownerExplanation ? ownerExplanation.trim() : null);
        }

        if (adminNotes && adminNotes.trim()) {
            updates.push("admin_notes = CONCAT(COALESCE(admin_notes, ''), '\n[', NOW(), ' ', ?, ' (', ?, ')]: ', ?)");
            params.push(req.user.full_name || "Admin", role, adminNotes.trim());
        }

        // If currently OPEN or EVIDENCE_REQUESTED, transition to UNDER_ADMIN_REVIEW
        if (dispute.status === "OPEN" || dispute.status === "EVIDENCE_REQUESTED") {
            updates.push("status = 'UNDER_ADMIN_REVIEW'");
            if (!dispute.assigned_area_admin_id && area_admin_id) {
                updates.push("assigned_area_admin_id = ?");
                params.push(area_admin_id);
            }
        }

        if (updates.length > 0) {
            params.push(disputeId);
            await pool.query(
                `UPDATE refund_disputes SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ?`,
                params
            );
        }

        const [refetched] = await pool.query(
            "SELECT id, status, investigation_findings, recommended_action, admin_notes, owner_explanation, updated_at FROM refund_disputes WHERE id = ?",
            [disputeId]
        );

        return res.status(200).json({
            success: true,
            message: "Dispute investigation updated successfully",
            data: refetched[0]
        });

    } catch (error) {
        console.error("Update dispute investigation error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update dispute investigation"
        });
    }
};

/**
 * POST /api/admin/disputes/:disputeId/evidence
 * Uploads evidence files (images/documents) to Cloudinary and registers in dispute_evidence.
 * Accessible to AREA_ADMIN, SUPER_ADMIN, OWNER, and FARMER (authorized for the case).
 */
export const uploadDisputeEvidence = async (req, res) => {
    try {
        const { disputeId } = req.params;
        const { title, description, evidence_type } = req.body;
        const user = req.user;

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "At least one evidence file is required"
            });
        }

        // Verify dispute & access
        const [disputes] = await pool.query(
            `SELECT rd.id, rd.status, rd.booking_id, rd.assigned_area_admin_id,
                    e.location_id, e.owner_id, o.user_id AS owner_user_id,
                    b.farmer_id, f.user_id AS farmer_user_id
             FROM refund_disputes rd
             JOIN bookings b ON rd.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             JOIN owners o ON e.owner_id = o.id
             JOIN farmers f ON b.farmer_id = f.id
             WHERE rd.id = ?`,
            [disputeId]
        );

        if (disputes.length === 0) {
            return res.status(404).json({ success: false, message: "Dispute not found" });
        }

        const dispute = disputes[0];

        if (dispute.status === "CLOSED") {
            return res.status(400).json({
                success: false,
                message: "Cannot upload evidence to a closed dispute"
            });
        }

        // RBAC / IDOR checks
        if (user.role === "OWNER" && dispute.owner_user_id !== user.id) {
            return res.status(403).json({ success: false, message: "Unauthorized: not your dispute booking" });
        } else if (user.role === "FARMER" && dispute.farmer_user_id !== user.id) {
            return res.status(403).json({ success: false, message: "Unauthorized: not your dispute booking" });
        } else if (user.role === "AREA_ADMIN") {
            const matchesLocation = user.location_id && dispute.location_id === user.location_id;
            const matchesAssignment = user.area_admin_id && dispute.assigned_area_admin_id === user.area_admin_id;
            if (!matchesLocation && !matchesAssignment) {
                return res.status(403).json({ success: false, message: "Area Admin can only upload evidence for disputes in their area" });
            }
        }

        const uploadedItems = [];

        for (const file of req.files) {
            const isVideo = file.mimetype.startsWith("video/");
            const isImage = file.mimetype.startsWith("image/");
            const resourceType = isVideo ? "video" : (isImage ? "image" : "auto");
            const inferredType = evidence_type || (isImage ? "IMAGE" : (isVideo ? "VIDEO" : "DOCUMENT"));

            const uploadResult = await uploadDisputeBufferToCloudinary(file.buffer, resourceType);

            const [insertRes] = await pool.query(
                `INSERT INTO dispute_evidence (
                    dispute_id,
                    uploaded_by_user_id,
                    evidence_type,
                    title,
                    description,
                    file_url,
                    public_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    disputeId,
                    user.id,
                    inferredType,
                    title ? title.trim() : file.originalname,
                    description ? description.trim() : null,
                    uploadResult.secure_url || uploadResult.url,
                    uploadResult.public_id
                ]
            );

            uploadedItems.push({
                id: insertRes.insertId,
                disputeId: Number(disputeId),
                evidenceType: inferredType,
                title: title ? title.trim() : file.originalname,
                fileUrl: uploadResult.secure_url || uploadResult.url,
                publicId: uploadResult.public_id
            });
        }

        return res.status(201).json({
            success: true,
            message: `Successfully uploaded ${uploadedItems.length} evidence file(s)`,
            data: uploadedItems
        });

    } catch (error) {
        console.error("Upload dispute evidence error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to upload dispute evidence"
        });
    }
};

/**
 * POST /api/admin/disputes/:disputeId/escalate
 * Allows Area Admin to escalate an active dispute directly to Super Admin with a justification reason.
 */
export const escalateDisputeToSuperAdmin = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { disputeId } = req.params;
        const { reason } = req.body;
        const { role, location_id, area_admin_id } = req.user;

        if (role !== "AREA_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Access restricted: Only Area Admin can escalate disputes to Super Admin"
            });
        }

        if (!reason || !reason.trim()) {
            return res.status(400).json({
                success: false,
                message: "Escalation reason is required"
            });
        }

        await connection.beginTransaction();

        const [disputes] = await connection.query(
            `SELECT rd.id, rd.status, rd.booking_id, rd.assigned_area_admin_id, e.location_id
             FROM refund_disputes rd
             JOIN bookings b ON rd.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             WHERE rd.id = ?
             FOR UPDATE`,
            [disputeId]
        );

        if (disputes.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Dispute not found" });
        }

        const dispute = disputes[0];

        // Verify assignment / area authority
        const matchesLocation = location_id && dispute.location_id === location_id;
        const matchesAssignment = area_admin_id && dispute.assigned_area_admin_id === area_admin_id;
        if (!matchesLocation && !matchesAssignment) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "Area Admin can only escalate disputes within their assigned area"
            });
        }

        if (dispute.status === "RESOLVED" || dispute.status === "CLOSED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Cannot escalate an already resolved or closed dispute"
            });
        }

        if (dispute.status === "ESCALATED_TO_SUPER_ADMIN") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Dispute is already escalated to Super Admin"
            });
        }

        await connection.query(
            `UPDATE refund_disputes
             SET status = 'ESCALATED_TO_SUPER_ADMIN',
                 escalation_reason = ?,
                 escalated_by_user_id = ?,
                 escalated_at = NOW(),
                 admin_notes = CONCAT(COALESCE(admin_notes, ''), '\n[', NOW(), ' Manual Escalation by Area Admin]: ', ?)
             WHERE id = ?`,
            [reason.trim(), req.user.id, reason.trim(), disputeId]
        );

        await connection.query(
            `INSERT INTO dispute_audit_logs (dispute_id, action_type, performed_by_user_id, performed_by_role, details)
             VALUES (?, 'DISPUTE_ESCALATED', ?, 'AREA_ADMIN', ?)`,
            [disputeId, req.user.id, `Manual escalation: ${reason.trim()}`]
        );

        // Fetch Super Admin for Email notification
        const [superAdmins] = await connection.query(
            "SELECT email, phone, full_name FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1"
        );

        await connection.commit();

        if (superAdmins.length > 0 && superAdmins[0].email) {
            sendSuperAdminEscalationEmail({
                superAdminEmail: superAdmins[0].email,
                superAdminName: superAdmins[0].full_name,
                disputeId,
                bookingId: dispute.booking_id,
                reason: reason.trim()
            }).catch(err => console.error("Escalation email error:", err));
        }

        return res.status(200).json({
            success: true,
            message: "Dispute successfully escalated to Super Admin",
            data: {
                disputeId: Number(disputeId),
                status: "ESCALATED_TO_SUPER_ADMIN",
                reason: reason.trim(),
                escalatedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Escalate dispute error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to escalate dispute"
        });
    } finally {
        connection.release();
    }
};
