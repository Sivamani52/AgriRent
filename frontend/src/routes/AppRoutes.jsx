import { Routes, Route } from 'react-router-dom'
import PublicLayout from '../layouts/PublicLayout'
import Home from '../pages/public/Home'
import Help from '../pages/public/Help'
import NotFound from '../pages/public/NotFound'

function AppRoutes() {
  return (
    <Routes>
      {/* Public Pages with Standard Header & Footer */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/help" element={<Help />} />

        {/* 
          FUTURE ROUTING STRUCTURE (Levels 2+):
          - Authentication routes: /login, /register, /forgot-password, /verify-otp
          - Farmer portal routes: /farmer/bookings, /farmer/equipment, /farmer/payments
          - Owner portal routes: /owner/equipment, /owner/requests, /owner/payments
          - Area Admin portal routes: /area-admin/disputes, /area-admin/verification
          - Super Admin portal routes: /super-admin/dashboard, /super-admin/users
        */}

        {/* Catch-all 404 Route */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default AppRoutes
