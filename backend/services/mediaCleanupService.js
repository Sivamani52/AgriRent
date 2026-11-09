import pool from "../db.js";
import cloudinary from "../config/cloudinary.js";

/**
 * Checks whether a booking is completely safe for inspection media deletion.
 * Enforces all dispute protection and lifecycle completion rules.
 * 
 * Rules:
 * 1. Booking must be COMPLETED and return_completed_at must be at least 48 hours old.
 * 2. Booking status must not be DISPUTED.
 * 3. No unresolved disputes (status in 'OPEN', 'UNDER_ADMIN_REVIEW', 'ESCALATED_TO_SUPER_ADMIN')
 *    can exist in refund_disputes for this booking.
 * 4. If any resolved dispute exists, at least 48 hours must have elapsed since its resolution (resolved_at).
 * 
 * @param {object} connection - MySQL connection or pool
 * @param {number|string} bookingId - Target booking ID
 * @returns {Promise<{ isSafe: boolean, reason?: string }>}
 */
export const isBookingSafeForMediaCleanup = async (connection, bookingId) => {
    // 1. Verify booking lifecycle status and return completion timestamp
    const [bookingRows] = await connection.query(
        `SELECT id, status, return_completed_at,
                TIMESTAMPDIFF(HOUR, return_completed_at, NOW()) AS hours_since_return
         FROM bookings
         WHERE id = ?`,
        [bookingId]
    );

    if (bookingRows.length === 0) {
        return { isSafe: false, reason: "Booking not found" };
    }

    const booking = bookingRows[0];

    // Must be strictly COMPLETED
    if (booking.status !== "COMPLETED") {
        return {
            isSafe: false,
            reason: `Booking status is '${booking.status}', only 'COMPLETED' bookings are eligible`
        };
    }

    // Must have a valid return_completed_at timestamp
    if (!booking.return_completed_at) {
        return {
            isSafe: false,
            reason: "Equipment return has not been formally confirmed (return_completed_at is null)"
        };
    }

    // Must have passed the 48-hour post-return retention threshold
    if (booking.hours_since_return < 48) {
        return {
            isSafe: false,
            reason: `Retention period active: only ${booking.hours_since_return} hours elapsed since return (48 hours required)`
        };
    }

    // 2. Check for active or unresolved disputes in refund_disputes
    const [activeDisputes] = await connection.query(
        `SELECT id, dispute_category, status, created_at
         FROM refund_disputes
         WHERE booking_id = ?
           AND status IN ('OPEN', 'UNDER_ADMIN_REVIEW', 'ESCALATED_TO_SUPER_ADMIN')`,
        [bookingId]
    );

    if (activeDisputes.length > 0) {
        const dispute = activeDisputes[0];
        return {
            isSafe: false,
            reason: `Active dispute #${dispute.id} (${dispute.dispute_category}) in status '${dispute.status}'. Evidence must be preserved.`
        };
    }

    // 3. Check for resolved disputes: Must respect 48-hour post-resolution grace period
    const [resolvedDisputes] = await connection.query(
        `SELECT id, status, resolved_at,
                TIMESTAMPDIFF(HOUR, resolved_at, NOW()) AS hours_since_resolution
         FROM refund_disputes
         WHERE booking_id = ?
           AND status IN ('RESOLVED', 'CLOSED')
         ORDER BY resolved_at DESC`,
        [bookingId]
    );

    for (const rd of resolvedDisputes) {
        if (!rd.resolved_at) {
            // Unrecorded resolution time; safeguard evidence
            return {
                isSafe: false,
                reason: `Dispute #${rd.id} marked ${rd.status} without a resolved_at timestamp. Evidence preserved.`
            };
        }
        if (rd.hours_since_resolution < 48) {
            return {
                isSafe: false,
                reason: `Post-dispute grace period active: only ${rd.hours_since_resolution} hours since dispute #${rd.id} was resolved (48 hours required)`
            };
        }
    }

    return { isSafe: true };
};

/**
 * Purges a batch of inspection media items from Cloudinary and updates MySQL references.
 * Idempotent, safe, and scoped strictly to inspection media.
 * 
 * @param {object} connection - MySQL connection
 * @param {Array<object>} mediaItems - Array of { id, public_id, media_type, booking_id }
 * @returns {Promise<{ deletedCount: number, failedCount: number }>}
 */
export const deleteInspectionMediaBatch = async (connection, mediaItems) => {
    let deletedCount = 0;
    let failedCount = 0;

    for (const item of mediaItems) {
        try {
            // Determine Cloudinary resource_type: "video" or "image"
            const resourceType = item.media_type === "VIDEO" ? "video" : "image";

            if (item.public_id) {
                // Call Cloudinary destroy API
                const cloudResult = await cloudinary.uploader.destroy(item.public_id, {
                    resource_type: resourceType,
                    invalidate: true
                });

                // Both 'ok' and 'not found' indicate the file no longer exists in Cloudinary
                if (cloudResult.result === "ok" || cloudResult.result === "not found") {
                    console.log(`[Media Cleanup] Cloudinary purged: ${item.public_id} (${resourceType}) for media #${item.id}`);
                } else {
                    console.warn(`[Media Cleanup] Cloudinary returned unexpected result for ${item.public_id}:`, cloudResult);
                }
            }

            // Update database reference to reflect deletion
            await connection.query(
                `UPDATE inspection_media
                 SET is_deleted = TRUE,
                     deleted_at = NOW()
                 WHERE id = ?`,
                [item.id]
            );

            deletedCount++;

        } catch (cloudinaryError) {
            console.error(
                `[Media Cleanup] Failed to delete inspection media #${item.id} (public_id: ${item.public_id}):`,
                cloudinaryError.message || cloudinaryError
            );
            failedCount++;
            // Do not throw; leave is_deleted = FALSE so it can retry on the next scheduled run
        }
    }

    return { deletedCount, failedCount };
};

/**
 * Main scheduled task runner.
 * Scans for all completed bookings whose inspection media retention period (48h)
 * has matured and dispute conditions are clear.
 * 
 * Persistent across server restarts: evaluates database timestamps.
 */
export const checkInspectionMediaCleanupTimeouts = async () => {
    let connection;
    try {
        connection = await pool.getConnection();

        // 1. Identify candidate bookings:
        // - status = 'COMPLETED'
        // - return_completed_at is at least 48 hours ago
        // - contains at least one active (unpurged) inspection_media record
        const [candidateBookings] = await connection.query(
            `SELECT DISTINCT b.id AS booking_id, b.status, b.return_completed_at
             FROM bookings b
             JOIN inspection_media im ON b.id = im.booking_id
             WHERE b.status = 'COMPLETED'
               AND b.return_completed_at IS NOT NULL
               AND b.return_completed_at <= DATE_SUB(NOW(), INTERVAL 48 HOUR)
               AND (im.is_deleted = FALSE OR im.is_deleted IS NULL)`
        );

        if (candidateBookings.length === 0) {
            return;
        }

        console.log(`[Media Cleanup] Found ${candidateBookings.length} booking(s) eligible for inspection media retention review.`);

        for (const candidate of candidateBookings) {
            const bookingId = candidate.booking_id;

            // 2. Dispute protection check
            const safetyCheck = await isBookingSafeForMediaCleanup(connection, bookingId);
            if (!safetyCheck.isSafe) {
                console.log(`[Media Cleanup] Booking #${bookingId} skipped: ${safetyCheck.reason}`);
                continue;
            }

            // 3. Fetch all active inspection media for this booking with FOR UPDATE to prevent race conditions
            await connection.beginTransaction();

            const [mediaRows] = await connection.query(
                `SELECT id, booking_id, media_type, public_id, file_url
                 FROM inspection_media
                 WHERE booking_id = ?
                   AND (is_deleted = FALSE OR is_deleted IS NULL)
                 FOR UPDATE`,
                [bookingId]
            );

            if (mediaRows.length === 0) {
                await connection.commit();
                continue;
            }

            // 4. Execute deletion batch
            const { deletedCount, failedCount } = await deleteInspectionMediaBatch(connection, mediaRows);

            await connection.commit();

            console.log(
                `[Media Cleanup] Booking #${bookingId} cleanup complete: ${deletedCount} purged, ${failedCount} failed.`
            );
        }

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rbErr) {
                console.error("[Media Cleanup] Rollback error:", rbErr.message);
            }
        }
        console.error("[Media Cleanup] Error during media cleanup check:", error.message || error);
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

export default {
    isBookingSafeForMediaCleanup,
    deleteInspectionMediaBatch,
    checkInspectionMediaCleanupTimeouts
};

