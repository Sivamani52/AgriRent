import axios from 'axios'

// Resolve API base URL from Vite environment variable with safe fallback
const rawBaseURL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
  'http://localhost:5000'
const apiBaseURL = rawBaseURL.endsWith('/api')
  ? rawBaseURL
  : `${rawBaseURL.replace(/\/+$/, '')}/api`

const api = axios.create({
  baseURL: apiBaseURL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
})

// Request Interceptor: Attach JWT authorization header if present
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response Interceptor: Normalize responses and error messages
api.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    // Extract server message or fallback
    const message =
      error.response?.data?.message ||
      error.message ||
      'Unable to connect to AgriRent server. Please check your network.'

    // Format error object for clean UI display
    const normalizedError = {
      status: error.response?.status || 500,
      message,
      data: error.response?.data || null,
      originalError: error,
    }

    return Promise.reject(normalizedError)
  }
)

/**
 * Health check utility to probe the AgriRent backend connection
 */
export const checkApiHealth = async () => {
  const response = await api.get('/health')
  return response.data
}

export default api
