import pool from "../db.js";
import {
    sendBookingReminderSMS,
    sendBookingAutoCancelledSMS,
    sendPaymentRejectedSMS,
    sendRefundReminderSMS,
    sendAreaAdminDisputeSMS,
    sendSuperAdminEscalationSMS
} from "./smsService.js";

/**
 * Checks owner booking acceptance timeouts:
 * 1. At 2 hours: Sends a reminder SMS once to the owner.
 * 2. At 4 hours: Automatically cancels the pending booking, records cancelled_at and reason,
 *    restores equipment availability if appropriate, handles any existing payment safely,
 *    and notifies both farmer and owner via SMS.
 */
export const checkBookingAcceptanceTimeouts = async () => {
    try {
        // --- 1. Owner 2-Hour Reminder ---
        const [reminderBookings] = await pool.query(
            `SELECT
                b.id AS booking_id,
                b.created_at,
                u.id AS owner_user_id,
                u.full_name AS owner_name,
                u.phone AS owner_phone,
                e.name AS equipment_name
             FROM bookings b
             JOIN equipment e ON b.equipment_id = e.id
             JOIN owners o ON e.owner_id = o.id
             JOIN users u ON o.user_id = u.id
             WHERE b.status = 'PENDING'
               AND b.created_at <= DATE_SUB(NOW(), INTERVAL 2 HOUR)
               AND b.created_at > DATE_SUB(NOW(), INTERVAL 4 HOUR)
               AND b.acceptance_reminder_sent_at IS NULL`
        );

        for (const booking of reminderBookings) {
            // Update timestamp first to guarantee idempotency and prevent duplicate reminders
            const [updateResult] = await pool.query(
                `UPDATE bookings
                 SET acceptance_reminder_sent_at = NOW()
                 WHERE id = ? AND acceptance_reminder_sent_at IS NULL AND status = 'PENDING'`,
                [booking.booking_id]
            );

            if (updateResult.affectedRows > 0) {
                sendBookingReminderSMS({
                    ownerPhone: booking.owner_phone,
                    ownerName: booking.owner_name,
                    bookingId: booking.booking_id,
                    equipmentName: booking.equipment_name
                }).catch(err => console.error("Booking reminder SMS error:", err));
            }
        }

        // --- 2. Owner 4-Hour Automatic Cancellation ---
        const [expiredBookings] = await pool.query(
            `SELECT
                b.id AS booking_id,
                b.equipment_id,
                b.created_at,
                ou.full_name AS owner_name,
                ou.phone AS owner_phone,
                fu.full_name AS farmer_name,
                fu.phone AS farmer_phone,
                e.name AS equipment_name
             FROM bookings b
             JOIN equipment e ON b.equipment_id = e.id
             JOIN owners o ON e.owner_id = o.id
             JOIN users ou ON o.user_id = ou.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             WHERE b.status = 'PENDING'
               AND b.created_at <= DATE_SUB(NOW(), INTERVAL 4 HOUR)`
        );

        for (const booking of expiredBookings) {
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                // 1. Lock booking row and re-verify status
                const [lockedRows] = await connection.query(
                    `SELECT id, status, equipment_id
                     FROM bookings
                     WHERE id = ? AND status = 'PENDING'
                     FOR UPDATE`,
                    [booking.booking_id]
                );

                if (lockedRows.length === 0) {
                    await connection.rollback();
                    continue;
                }

                // 2. Check whether any payment has already been submitted or verified
                const [payments] = await connection.query(
                    `SELECT id, status, refund_status, amount
                     FROM booking_payments
                     WHERE booking_id = ?
                     FOR UPDATE`,
                    [booking.booking_id]
                );

                if (payments.length > 0) {
                    for (const p of payments) {
                        if (p.status === "PAYMENT_PENDING" || p.status === "PAYMENT_VERIFIED") {
                            await connection.query(
                                `UPDATE booking_payments
                                 SET status = 'PAYMENT_REJECTED',
                                     refund_status = 'REFUND_REQUIRED',
                                     refund_required_at = NOW(),
                                     refund_deadline = DATE_ADD(NOW(), INTERVAL 24 HOUR),
                                     rejection_reason = 'Booking auto-cancelled after owner acceptance timeout'
                                 WHERE id = ?`,
                                [p.id]
                            );
                        }
                    }
                }

                // 3. Update booking status to CANCELLED
                const [cancelResult] = await connection.query(
                    `UPDATE bookings
                     SET status = 'CANCELLED',
                         cancellation_reason = 'Owner did not respond within the 4-hour deadline',
                         cancelled_at = NOW()
                     WHERE id = ? AND status = 'PENDING'`,
                    [booking.booking_id]
                );

                // 4. Check whether equipment should be restored to AVAILABLE
                const [otherActive] = await connection.query(
                    `SELECT id FROM bookings
                     WHERE equipment_id = ?
                     AND status IN ('ACCEPTED', 'CONFIRMED', 'IN_PROGRESS')
                     AND id != ?`,
                    [booking.equipment_id, booking.booking_id]
                );

                if (otherActive.length === 0) {
                    await connection.query(
                        `UPDATE equipment
                         SET status = 'AVAILABLE'
                         WHERE id = ? AND status = 'BOOKED'`,
                        [booking.equipment_id]
                    );
                }

                await connection.commit();

                // 5. Send cancellation notifications only if the row was indeed updated
                if (cancelResult.affectedRows > 0) {
                    sendBookingAutoCancelledSMS({
                        recipientPhone: booking.farmer_phone,
                        recipientName: booking.farmer_name,
                        recipientRole: "FARMER",
                        bookingId: booking.booking_id,
                        equipmentName: booking.equipment_name
                    }).catch(err => console.error("Farmer auto-cancel SMS error:", err));

                    sendBookingAutoCancelledSMS({
                        recipientPhone: booking.owner_phone,
                        recipientName: booking.owner_name,
                        recipientRole: "OWNER",
                        bookingId: booking.booking_id,
                        equipmentName: booking.equipment_name
                    }).catch(err => console.error("Owner auto-cancel SMS error:", err));
                }

            } catch (err) {
                await connection.rollback();
                console.error(`Error auto-cancelling booking ${booking.booking_id}:`, err);
            } finally {
                connection.release();
            }
        }

    } catch (error) {
        console.error("Booking acceptance timeout service error:", error.message || error);
    }
};

/**
 * Checks Payment Verification Timeouts and Refund Escalations:
 * 1. Owner 2-Hour Payment Verification Warning.
 * 2. Grace Period Expired: Auto-reject payment, require refund, cancel booking.
 * 3. Farmer Refund 24-Hour Response Timeout: Mark REFUND_OUTSTANDING and assign Area Admin dispute.
 * 4. 48-Hour Dispute Escalation: Escalate unresolved disputes to Super Admin.
 */
export const checkPaymentVerificationTimeouts = async () => {
    try {
        // --- 1. Owner 2-Hour Payment Verification Warning ---
        const [warningPayments] = await pool.query(
            `SELECT 
                bp.id, 
                bp.booking_id, 
                bp.verification_deadline, 
                bp.admin_warning_sent_at, 
                bp.admin_grace_deadline,
                ou.phone AS owner_phone,
                ou.full_name AS owner_name
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             JOIN owners o ON e.owner_id = o.id
             JOIN users ou ON o.user_id = ou.id
             WHERE bp.status = 'PAYMENT_PENDING' 
               AND bp.verification_deadline <= NOW() 
               AND bp.admin_warning_sent_at IS NULL`
        );

        for (const payment of warningPayments) {
            const graceDeadline = new Date(Date.now() + 2 * 60 * 60 * 1000);

            const [updateResult] = await pool.query(
                `UPDATE booking_payments 
                 SET admin_warning_sent_at = NOW(), 
                     admin_grace_deadline = ? 
                 WHERE id = ? AND admin_warning_sent_at IS NULL AND status = 'PAYMENT_PENDING'`,
                [graceDeadline, payment.id]
            );

            if (updateResult.affectedRows > 0) {
                console.log(
                    `⚠️ Payment verification grace period initiated for payment ${payment.id}. Booking #${payment.booking_id}.`
                );
            }
        }

        // --- 2. Grace Period Expired: Auto-reject payment and cancel booking ---
        const [expiredGracePayments] = await pool.query(
            `SELECT 
                bp.id, 
                bp.booking_id,
                bp.amount,
                b.equipment_id,
                ou.phone AS owner_phone,
                ou.full_name AS owner_name,
                fu.phone AS farmer_phone,
                fu.full_name AS farmer_name
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             JOIN owners o ON e.owner_id = o.id
             JOIN users ou ON o.user_id = ou.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             WHERE bp.status = 'PAYMENT_PENDING' 
               AND bp.admin_grace_deadline <= NOW() 
               AND bp.auto_rejected_at IS NULL`
        );

        for (const payment of expiredGracePayments) {
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                const [lockedPayments] = await connection.query(
                    `SELECT id, status FROM booking_payments WHERE id = ? AND status = 'PAYMENT_PENDING' FOR UPDATE`,
                    [payment.id]
                );

                if (lockedPayments.length === 0) {
                    await connection.rollback();
                    continue;
                }

                await connection.query(
                    `UPDATE booking_payments 
                     SET status = 'PAYMENT_REJECTED', 
                         auto_rejected_at = NOW(), 
                         refund_required_at = NOW(), 
                         refund_status = 'REFUND_REQUIRED',
                         refund_deadline = DATE_ADD(NOW(), INTERVAL 24 HOUR), 
                         rejection_reason = 'Owner did not verify payment within the allowed time' 
                     WHERE id = ?`,
                    [payment.id]
                );

                await connection.query(
                    `UPDATE bookings 
                     SET status = 'CANCELLED', 
                         cancellation_reason = 'Payment verification timeout' 
                     WHERE id = ?`,
                    [payment.booking_id]
                );

                // Release equipment if no other active booking
                const [otherActive] = await connection.query(
                    `SELECT id FROM bookings
                     WHERE equipment_id = ?
                     AND status IN ('ACCEPTED', 'CONFIRMED', 'IN_PROGRESS')
                     AND id != ?`,
                    [payment.equipment_id, payment.booking_id]
                );

                if (otherActive.length === 0) {
                    await connection.query(
                        `UPDATE equipment
                         SET status = 'AVAILABLE'
                         WHERE id = ? AND status = 'BOOKED'`,
                        [payment.equipment_id]
                    );
                }

                await connection.commit();

                sendPaymentRejectedSMS({
                    farmerPhone: payment.farmer_phone,
                    farmerName: payment.farmer_name,
                    bookingId: payment.booking_id,
                    amount: payment.amount,
                    reason: "Owner did not verify payment within the allowed time"
                }).catch(err => console.error("Auto-reject farmer SMS error:", err));

            } catch (err) {
                await connection.rollback();
                console.error(`Error auto-rejecting payment ${payment.id}:`, err);
            } finally {
                connection.release();
            }
        }

        // --- 3. Farmer Refund 24-Hour Response Timeout Escalation ---
        // When owner submitted refund, but farmer has not responded within 24 hours
        const [expiredFarmerRefunds] = await pool.query(
            `SELECT 
                bp.id, 
                bp.booking_id,
                bp.amount,
                bp.farmer_refund_response_deadline,
                e.location_id,
                fu.id AS farmer_user_id,
                fu.phone AS farmer_phone,
                fu.full_name AS farmer_name
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             WHERE bp.refund_status = 'REFUND_SUBMITTED'
               AND bp.farmer_refund_response_deadline <= NOW()
               AND bp.farmer_refund_followup_required_at IS NULL`
        );

        for (const payment of expiredFarmerRefunds) {
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                const [lockedPayments] = await connection.query(
                    `SELECT id, refund_status FROM booking_payments WHERE id = ? AND refund_status = 'REFUND_SUBMITTED' FOR UPDATE`,
                    [payment.id]
                );

                if (lockedPayments.length === 0) {
                    await connection.rollback();
                    continue;
                }

                // Update payment to REFUND_OUTSTANDING and record followup timestamp
                await connection.query(
                    `UPDATE booking_payments
                     SET farmer_refund_followup_required_at = NOW(),
                         refund_status = 'REFUND_OUTSTANDING'
                     WHERE id = ?`,
                    [payment.id]
                );

                // Find assigned Area Admin for the booking location
                const [adminRows] = await connection.query(
                    `SELECT aa.id, aa.user_id, u.phone AS admin_phone, u.full_name AS admin_name
                     FROM area_admins aa
                     JOIN users u ON aa.user_id = u.id
                     WHERE aa.location_id = ?
                     LIMIT 1`,
                    [payment.location_id]
                );

                const assignedAdmin = adminRows.length > 0 ? adminRows[0] : null;

                // Check if dispute record exists
                const [existingDisputes] = await connection.query(
                    `SELECT id FROM refund_disputes WHERE payment_id = ? FOR UPDATE`,
                    [payment.id]
                );

                let disputeId;
                if (existingDisputes.length === 0) {
                    const [disputeResult] = await connection.query(
                        `INSERT INTO refund_disputes
                            (payment_id, booking_id, dispute_reason, dispute_category, raised_by_user_id, raised_by_role, status, assigned_area_admin_id)
                         VALUES (?, ?, 'Farmer did not confirm refund within 24-hour response deadline', 'REFUND_CONFIRMATION_TIMEOUT', ?, 'FARMER', 'UNDER_ADMIN_REVIEW', ?)`,
                        [
                            payment.id,
                            payment.booking_id,
                            payment.farmer_user_id,
                            assignedAdmin ? assignedAdmin.id : null
                        ]
                    );
                    disputeId = disputeResult.insertId;
                } else {
                    disputeId = existingDisputes[0].id;
                }

                await connection.commit();

                // Send SMS notifications (non-blocking)
                sendRefundReminderSMS({
                    farmerPhone: payment.farmer_phone,
                    farmerName: payment.farmer_name,
                    bookingId: payment.booking_id,
                    amount: payment.amount
                }).catch(err => console.error("Farmer refund reminder SMS error:", err));

                if (assignedAdmin && assignedAdmin.admin_phone) {
                    sendAreaAdminDisputeSMS({
                        adminPhone: assignedAdmin.admin_phone,
                        adminName: assignedAdmin.admin_name,
                        bookingId: payment.booking_id,
                        disputeId,
                        disputeReason: "Farmer did not confirm refund within 24-hour response deadline"
                    }).catch(err => console.error("Area admin dispute SMS error:", err));
                }

            } catch (err) {
                await connection.rollback();
                console.error(`Error escalating refund response timeout for payment ${payment.id}:`, err);
            } finally {
                connection.release();
            }
        }

        // --- 4. 48-Hour Dispute Escalation to Super Admin ---
        // Disputes remaining in OPEN or UNDER_ADMIN_REVIEW past 48 hours escalate to Super Admin
        const [escalationDisputes] = await pool.query(
            `SELECT
                rd.id AS dispute_id,
                rd.payment_id,
                rd.booking_id,
                su.phone AS super_admin_phone,
                su.full_name AS super_admin_name
             FROM refund_disputes rd
             CROSS JOIN (
                 SELECT phone, full_name
                 FROM users
                 WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE'
                 LIMIT 1
             ) su
             WHERE rd.status IN ('OPEN', 'UNDER_ADMIN_REVIEW')
               AND rd.created_at <= DATE_SUB(NOW(), INTERVAL 48 HOUR)
               AND rd.escalated_at IS NULL`
        );

        for (const dispute of escalationDisputes) {
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                const [lockedDisputes] = await connection.query(
                    `SELECT id, status FROM refund_disputes WHERE id = ? AND status IN ('OPEN', 'UNDER_ADMIN_REVIEW') FOR UPDATE`,
                    [dispute.dispute_id]
                );

                if (lockedDisputes.length === 0) {
                    await connection.rollback();
                    continue;
                }

                await connection.query(
                    `UPDATE refund_disputes
                     SET status = 'ESCALATED_TO_SUPER_ADMIN',
                         escalation_reason = 'Dispute unresolved within 48-hour deadline. Escalated to Super Admin for final resolution.',
                         escalated_at = NOW()
                     WHERE id = ?`,
                    [dispute.dispute_id]
                );

                await connection.commit();

                if (dispute.super_admin_phone) {
                    sendSuperAdminEscalationSMS({
                        superAdminPhone: dispute.super_admin_phone,
                        superAdminName: dispute.super_admin_name,
                        disputeId: dispute.dispute_id,
                        bookingId: dispute.booking_id,
                        reason: "Exceeded 48-hour resolution deadline"
                    }).catch(err => console.error("Super Admin escalation SMS error:", err));
                }

            } catch (err) {
                await connection.rollback();
                console.error(`Error escalating dispute ${dispute.dispute_id}:`, err);
            } finally {
                connection.release();
            }
        }

    } catch (error) {
        console.error("Payment timeout service error:", error.message || error);
    }
};
