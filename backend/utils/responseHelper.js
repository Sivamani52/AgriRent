/**
 * Parses and validates a positive integer route or query parameter.
 * @param {unknown} value
 * @returns {number|null}
 */
export const parsePositiveInt = (value) => {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    const str = String(value).trim();
    if (!/^\d+$/.test(str)) {
        return null;
    }
    const num = Number(str);
    return Number.isSafeInteger(num) && num > 0 ? num : null;
};

/**
 * Sends a standardized success JSON response.
 */
export const sendSuccess = (res, statusCode = 200, message = "Success", data = undefined, extra = {}) => {
    const payload = {
        success: true,
        message
    };
    if (data !== undefined) {
        payload.data = data;
    }
    Object.assign(payload, extra);
    return res.status(statusCode).json(payload);
};

/**
 * Sends a standardized error JSON response.
 */
export const sendError = (res, statusCode = 500, message = "An error occurred", errors = undefined) => {
    const payload = {
        success: false,
        message
    };
    if (errors !== undefined) {
        payload.errors = errors;
    }
    return res.status(statusCode).json(payload);
};

