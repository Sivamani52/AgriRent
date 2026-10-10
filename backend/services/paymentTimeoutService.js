import pool from "../db.js";

/**
 * Dispatches simulated notification to console/audit log.
 * Note: Mobile SMS / Push service (e.g. Twilio) is not yet configured in this project.
 * Notifications are recorded here with complete recipient metadata and exact message copy.
 */
const logNotification = ({ type, recipientRole, recipientName, recipientContact, bookingId, message }) => {
    console.log(`\n📢 [NOTIFICATION DISPATCHED]`);
    console.log(`   Type: ${type}`);
    console.log(`   To (${recipientRole}): ${recipientName || "N/A"} (${recipientContact || "N/A"})`);
    console.log(`   Booking ID: ${bookingId}`);
    console.log(`   Message: "${message}"\n`);
};

/**
 * Checks owner booking acceptance timeouts:
 * 1. At 2 hours: Sends a reminder notification once to the owner.
 * 2. At 4 hours: Automatically cancels the pending booking, records cancelled_at and reason,
 *    and notifies both farmer and owner.
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
                u.email AS owner_email,
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
            await pool.query(
                `UPDATE bookings
                 SET acceptance_reminder_sent_at = NOW()
                 WHERE id = ? AND acceptance_reminder_sent_at IS NULL`,
                [booking.booking_id]
            );

            logNotification({
                type: "BOOKING_ACCEPTANCE_REMINDER",
                recipientRole: "OWNER",
                recipientName: booking.owner_name,
                recipientContact: booking.owner_phone || booking.owner_email,
                bookingId: booking.booking_id,
                message: "AgriRent Booking Reminder: You have a pending equipment booking request that requires your response. Please accept or reject the booking within the next 2 hours. If you do not respond before the deadline, the booking will be automatically cancelled."
            });
        }

        // --- 2. Owner 4-Hour Automatic Cancellation ---
        const [expiredBookings] = await pool.query(
            `SELECT
                b.id AS booking_id,
                b.created_at,
                ou.full_name AS owner_name,
                ou.phone AS owner_phone,
                ou.email AS owner_email,
                fu.full_name AS farmer_name,
                fu.phone AS farmer_phone,
                fu.email AS farmer_email
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

                const [result] = await connection.query(
                    `UPDATE bookings
                     SET status = 'CANCELLED',
                         cancellation_reason = 'Owner did not respond within the 4-hour deadline',
                         cancelled_at = NOW()
                     WHERE id = ? AND status = 'PENDING'`,
                    [booking.booking_id]
                );

                await connection.commit();

                // Only send cancellation notifications if the row was indeed updated
                if (result.affectedRows > 0) {
                    // Notify Farmer
                    logNotification({
                        type: "BOOKING_AUTO_CANCELLED_FARMER",
                        recipientRole: "FARMER",
                        recipientName: booking.farmer_name,
                        recipientContact: booking.farmer_phone || booking.farmer_email,
                        bookingId: booking.booking_id,
                        message: "Your AgriRent booking request has been cancelled because the owner did not respond within 4 hours. You can book another available piece of equipment."
                    });

                    // Notify Owner
                    logNotification({
                        type: "BOOKING_AUTO_CANCELLED_OWNER",
                        recipientRole: "OWNER",
                        recipientName: booking.owner_name,
                        recipientContact: booking.owner_phone || booking.owner_email,
                        bookingId: booking.booking_id,
                        message: "Your AgriRent booking request has been cancelled because you did not respond within the 4-hour deadline. Please respond promptly to future booking requests."
                    });
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
 * Existing Payment Verification Timeout Service
 */
export const checkPaymentVerificationTimeouts = async () => {
    try {
        const [warningPayments] = await pool.query(
            `SELECT 
                id, 
                booking_id, 
                verification_deadline, 
                admin_warning_sent_at, 
                admin_grace_deadline 
             FROM booking_payments 
             WHERE status = 'PAYMENT_PENDING' 
             AND verification_deadline <= NOW() 
             AND admin_warning_sent_at IS NULL`
        );

        for (const payment of warningPayments) {
            const graceDeadline = new Date(
                Date.now() + 2 * 60 * 60 * 1000
            );

            await pool.query(
                `UPDATE booking_payments 
                 SET admin_warning_sent_at = NOW(), 
                     admin_grace_deadline = ? 
                 WHERE id = ?`,
                [graceDeadline, payment.id]
            );

            console.log(
                `⚠️ Area Admin warning required for payment ${payment.id}. Booking ${payment.booking_id}.`
            );
        }

        const [expiredGracePayments] = await pool.query(
            `SELECT 
                id, 
                booking_id 
             FROM booking_payments 
             WHERE status = 'PAYMENT_PENDING' 
             AND admin_grace_deadline <= NOW() 
             AND auto_rejected_at IS NULL`
        );

        for (const payment of expiredGracePayments) {
            await pool.query(
                `UPDATE booking_payments 
                    SET status = 'PAYMENT_REJECTED', 
                    auto_rejected_at = NOW(), 
                    refund_required_at = NOW(), 
                    refund_deadline = DATE_ADD(NOW(), INTERVAL 24 HOUR), 
                    rejection_reason = 'Owner did not verify payment within the allowed time' 
                 WHERE id = ?`,
                [payment.id]
            );

            await pool.query(
                `UPDATE bookings 
                 SET status = 'CANCELLED', 
                     cancellation_reason = 'Payment verification timeout' 
                 WHERE id = ?`,
                [payment.booking_id]
            );

            console.log(
                `❌ Payment ${payment.id} automatically rejected. Booking ${payment.booking_id} cancelled. Refund required.`
            );
        }

        // Farmer refund response timeout
        const [expiredFarmerRefunds] = await pool.query(
            `SELECT 
                id, 
                booking_id,
                farmer_refund_response_deadline
             FROM booking_payments
             WHERE refund_status = 'REFUND_SUBMITTED'
             AND farmer_refund_response_deadline <= NOW()
             AND farmer_refund_followup_required_at IS NULL`
        );

        for (const payment of expiredFarmerRefunds) {
            await pool.query(
                `UPDATE booking_payments
                 SET farmer_refund_followup_required_at = NOW()
                 WHERE id = ?`,
                [payment.id]
            );

            console.log(
                `⚠️ Farmer refund follow-up required for payment ${payment.id}. Booking ${payment.booking_id}.`
            );
        }

    } catch (error) {
        console.error(
            "Payment timeout service error:",
            error.message || error
        );
    }
};
