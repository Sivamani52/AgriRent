import pool from "../db.js";

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

    } catch (error) {
        console.error(
            "Payment timeout service error:",
            error.message || error
        );
    }
};
