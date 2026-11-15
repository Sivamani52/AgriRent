import { Outlet } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Navbar from '../components/layout/Navbar'
import Footer from '../components/layout/Footer'

function PublicLayout() {
  return (
    <div className="flex flex-col min-h-screen w-full overflow-x-hidden bg-[#f8fafc] text-[#1e293b]">
      <Navbar />

      <main className="flex-1 w-full max-w-full">
        <Outlet />
      </main>

      <Footer />

      {/* Global Notification Toast Container */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#ffffff',
            color: '#1e293b',
            fontSize: '14px',
            fontWeight: '500',
            borderRadius: '16px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
            border: '1px solid #e2e8f0',
            padding: '12px 18px',
            maxWidth: '90vw',
          },
          success: {
            iconTheme: {
              primary: '#166534',
              secondary: '#ffffff',
            },
          },
          error: {
            iconTheme: {
              primary: '#dc2626',
              secondary: '#ffffff',
            },
          },
        }}
      />
    </div>
  )
}

export default PublicLayout
