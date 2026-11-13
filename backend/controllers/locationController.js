import pool from "../db.js";
import { parsePositiveInt } from "../utils/responseHelper.js";

/**
 * List locations with optional hierarchical filters and pagination.
 * GET /api/locations
 * Access: Public (used by registration, equipment filters, and dashboards)
 */
export const getLocations = async (req, res) => {
    try {
        const { state, district, mandal, panchayat, village, search, page, limit } = req.query;

        let whereSql = " WHERE 1=1";
        const values = [];

        if (state && state.trim()) {
            whereSql += " AND LOWER(state) = LOWER(?)";
            values.push(state.trim());
        }
        if (district && district.trim()) {
            whereSql += " AND LOWER(district) = LOWER(?)";
            values.push(district.trim());
        }
        if (mandal && mandal.trim()) {
            whereSql += " AND LOWER(mandal) = LOWER(?)";
            values.push(mandal.trim());
        }
        if (panchayat && panchayat.trim()) {
            whereSql += " AND LOWER(panchayat) = LOWER(?)";
            values.push(panchayat.trim());
        }
        if (village && village.trim()) {
            whereSql += " AND LOWER(village) = LOWER(?)";
            values.push(village.trim());
        }
        if (search && search.trim()) {
            const pattern = `%${search.trim()}%`;
            whereSql += " AND (state LIKE ? OR district LIKE ? OR mandal LIKE ? OR panchayat LIKE ? OR village LIKE ?)";
            values.push(pattern, pattern, pattern, pattern, pattern);
        }

        const pageNum = Math.max(Number(page) || 1, 1);
        const limitNum = Math.min(Math.max(Number(limit) || 50, 1), 200);
        const offset = (pageNum - 1) * limitNum;

        const [countRows] = await pool.query(
            `SELECT COUNT(*) AS total FROM locations${whereSql}`,
            values
        );
        const total = countRows[0].total;

        const [locations] = await pool.query(
            `SELECT id, state, district, mandal, panchayat, village, created_at
             FROM locations${whereSql}
             ORDER BY state ASC, district ASC, mandal ASC, village ASC
             LIMIT ? OFFSET ?`,
            [...values, limitNum, offset]
        );

        return res.status(200).json({
            success: true,
            message: "Locations fetched successfully",
            count: locations.length,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum) || 1
            },
            data: locations
        });
    } catch (error) {
        console.error("Get locations error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch locations"
        });
    }
};

/**
 * Get single location by ID.
 * GET /api/locations/:locationId
 */
export const getLocationById = async (req, res) => {
    try {
        const locationId = parsePositiveInt(req.params.locationId);
        if (!locationId) {
            return res.status(400).json({
                success: false,
                message: "Invalid location ID"
            });
        }

        const [rows] = await pool.query(
            "SELECT id, state, district, mandal, panchayat, village, created_at FROM locations WHERE id = ?",
            [locationId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Location not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Location fetched successfully",
            data: rows[0]
        });
    } catch (error) {
        console.error("Get location by ID error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch location"
        });
    }
};

/**
 * Create a new location.
 * POST /api/locations
 * Access: SUPER_ADMIN only
 */
export const createLocation = async (req, res) => {
    try {
        const { state, district, mandal, panchayat, village } = req.body;

        const fields = { state, district, mandal, panchayat, village };
        for (const [key, val] of Object.entries(fields)) {
            if (!val || typeof val !== "string" || !val.trim()) {
                return res.status(400).json({
                    success: false,
                    message: `${key} is required`
                });
            }
            if (val.trim().length > 100) {
                return res.status(400).json({
                    success: false,
                    message: `${key} must not exceed 100 characters`
                });
            }
        }

        const cleanState = state.trim();
        const cleanDistrict = district.trim();
        const cleanMandal = mandal.trim();
        const cleanPanchayat = panchayat.trim();
        const cleanVillage = village.trim();

        const [existing] = await pool.query(
            `SELECT id FROM locations
             WHERE LOWER(state) = LOWER(?) AND LOWER(district) = LOWER(?)
               AND LOWER(mandal) = LOWER(?) AND LOWER(panchayat) = LOWER(?)
               AND LOWER(village) = LOWER(?)`,
            [cleanState, cleanDistrict, cleanMandal, cleanPanchayat, cleanVillage]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Location already exists"
            });
        }

        const [result] = await pool.query(
            `INSERT INTO locations (state, district, mandal, panchayat, village)
             VALUES (?, ?, ?, ?, ?)`,
            [cleanState, cleanDistrict, cleanMandal, cleanPanchayat, cleanVillage]
        );

        return res.status(201).json({
            success: true,
            message: "Location created successfully",
            data: {
                id: result.insertId,
                state: cleanState,
                district: cleanDistrict,
                mandal: cleanMandal,
                panchayat: cleanPanchayat,
                village: cleanVillage
            }
        });
    } catch (error) {
        console.error("Create location error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to create location"
        });
    }
};

/**
 * Update a location.
 * PUT /api/locations/:locationId
 * Access: SUPER_ADMIN only
 */
export const updateLocation = async (req, res) => {
    try {
        const locationId = parsePositiveInt(req.params.locationId);
        if (!locationId) {
            return res.status(400).json({
                success: false,
                message: "Invalid location ID"
            });
        }

        const [existingRows] = await pool.query(
            "SELECT * FROM locations WHERE id = ?",
            [locationId]
        );
        if (existingRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Location not found"
            });
        }

        const current = existingRows[0];
        const { state, district, mandal, panchayat, village } = req.body;

        if (
            state === undefined &&
            district === undefined &&
            mandal === undefined &&
            panchayat === undefined &&
            village === undefined
        ) {
            return res.status(400).json({
                success: false,
                message: "At least one location field is required"
            });
        }

        const next = {
            state: state !== undefined ? String(state).trim() : current.state,
            district: district !== undefined ? String(district).trim() : current.district,
            mandal: mandal !== undefined ? String(mandal).trim() : current.mandal,
            panchayat: panchayat !== undefined ? String(panchayat).trim() : current.panchayat,
            village: village !== undefined ? String(village).trim() : current.village
        };

        for (const [key, val] of Object.entries(next)) {
            if (!val || val.length > 100) {
                return res.status(400).json({
                    success: false,
                    message: `${key} must be between 1 and 100 characters`
                });
            }
        }

        const [duplicate] = await pool.query(
            `SELECT id FROM locations
             WHERE LOWER(state) = LOWER(?) AND LOWER(district) = LOWER(?)
               AND LOWER(mandal) = LOWER(?) AND LOWER(panchayat) = LOWER(?)
               AND LOWER(village) = LOWER(?) AND id != ?`,
            [next.state, next.district, next.mandal, next.panchayat, next.village, locationId]
        );

        if (duplicate.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Another location with these details already exists"
            });
        }

        await pool.query(
            `UPDATE locations
             SET state = ?, district = ?, mandal = ?, panchayat = ?, village = ?
             WHERE id = ?`,
            [next.state, next.district, next.mandal, next.panchayat, next.village, locationId]
        );

        return res.status(200).json({
            success: true,
            message: "Location updated successfully",
            data: {
                id: locationId,
                ...next
            }
        });
    } catch (error) {
        console.error("Update location error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to update location"
        });
    }
};

/**
 * Delete a location if unreferenced.
 * DELETE /api/locations/:locationId
 * Access: SUPER_ADMIN only
 */
export const deleteLocation = async (req, res) => {
    try {
        const locationId = parsePositiveInt(req.params.locationId);
        if (!locationId) {
            return res.status(400).json({
                success: false,
                message: "Invalid location ID"
            });
        }

        const [rows] = await pool.query("SELECT id FROM locations WHERE id = ?", [locationId]);
        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Location not found"
            });
        }

        const [refs] = await pool.query(
            `SELECT
                (SELECT COUNT(*) FROM area_admins WHERE location_id = ?) AS admin_refs,
                (SELECT COUNT(*) FROM owners WHERE location_id = ?) AS owner_refs,
                (SELECT COUNT(*) FROM farmers WHERE location_id = ?) AS farmer_refs,
                (SELECT COUNT(*) FROM equipment WHERE location_id = ?) AS equipment_refs`,
            [locationId, locationId, locationId, locationId]
        );

        const totalRefs =
            Number(refs[0].admin_refs) +
            Number(refs[0].owner_refs) +
            Number(refs[0].farmer_refs) +
            Number(refs[0].equipment_refs);

        if (totalRefs > 0) {
            return res.status(409).json({
                success: false,
                message: "Cannot delete location because it is assigned to existing users or equipment"
            });
        }

        await pool.query("DELETE FROM locations WHERE id = ?", [locationId]);

        return res.status(200).json({
            success: true,
            message: "Location deleted successfully",
            data: { locationId }
        });
    } catch (error) {
        console.error("Delete location error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to delete location"
        });
    }
};

