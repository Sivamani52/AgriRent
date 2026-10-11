import pool from "../db.js";

const VALID_CASE_STATUSES = [
    "OPEN",
    "UNDER_ADMIN_REVIEW",
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

        // Base query joining refund_disputes, booking_payments, bookings, and equipment

        let query = `
            SELECT
                rd.id AS dispute_id,
                rd.payment_id,
                rd.booking_id,
                rd.dispute_reason,
                rd.status AS case_status,
                rd.assigned_area_admin_id,
                rd.admin_notes,
                bp.amount AS payment_amount,
                bp.refund_status,
                bp.refund_transaction_id,
                bp.refund_submitted_at,
                rd.created_at,
                rd.updated_at
            FROM refund_disputes rd
            INNER JOIN booking_payments bp
                ON rd.payment_id = bp.id
            INNER JOIN bookings b
                ON rd.booking_id = b.id
            INNER JOIN equipment e
                ON b.equipment_id = e.id
            WHERE 1=1
        `;

        const queryParams = [];

        // Role-based access control:
        // SUPER_ADMIN has access to all disputes across the platform.
        // AREA_ADMIN is restricted to cases in their location or assigned to them.
        
        if (role === "AREA_ADMIN") {
            if (location_id) {
                query += ` AND (e.location_id = ? OR rd.assigned_area_admin_id = ?)`;
                queryParams.push(location_id, area_admin_id || 0);
            } else if (area_admin_id) {
                query += ` AND rd.assigned_area_admin_id = ?`;
                queryParams.push(area_admin_id);
            }
        }

        // Optional status filter
        if (status) {
            query += ` AND rd.status = ?`;
            queryParams.push(status.toUpperCase());
        }

        // Order by newest cases first
        query += ` ORDER BY rd.created_at DESC`;

        const [rows] = await pool.query(query, queryParams);

        // Format data properly (convert payment_amount to number)
        const formattedDisputes = rows.map((row) => ({
            dispute_id: row.dispute_id,
            payment_id: row.payment_id,
            booking_id: row.booking_id,
            dispute_reason: row.dispute_reason,
            case_status: row.case_status,
            assigned_area_admin_id: row.assigned_area_admin_id,
            admin_notes: row.admin_notes,
            payment_amount: Number(row.payment_amount),
            refund_status: row.refund_status,
            refund_transaction_id: row.refund_transaction_id,
            refund_submitted_at: row.refund_submitted_at,
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
