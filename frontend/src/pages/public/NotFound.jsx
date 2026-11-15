import { Link } from 'react-router-dom'
import { Tractor, ArrowLeft, Home as HomeIcon } from 'lucide-react'
import Button from '../../components/common/Button'

function NotFound() {
  return (
    <div className="min-h-[65vh] flex items-center justify-center px-4 sm:px-6 lg:px-8 py-12 sm:py-16 w-full">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-3xl bg-[#f0fdf4] text-[#166534] flex items-center justify-center shadow-xs border border-green-200 shrink-0">
          <Tractor className="w-8 h-8 sm:w-10 sm:h-10" />
        </div>

        <div className="space-y-2">
          <span className="text-xs uppercase tracking-widest font-bold text-[#166534]">
            Error 404
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-[#1e293b] tracking-tight">
            Page Not Found
          </h1>
          <p className="text-xs sm:text-sm text-[#64748b] leading-relaxed">
            The page you are looking for does not exist or has been moved. Let&apos;s get you back to renting farm equipment.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2 w-full">
          <Link to="/" className="w-full sm:w-auto">
            <Button variant="primary" size="md" className="w-full sm:w-auto font-semibold" icon={HomeIcon}>
              Return to Home
            </Button>
          </Link>

          <button
            type="button"
            onClick={() => window.history.back()}
            className="w-full sm:w-auto"
          >
            <Button variant="outline" size="md" className="w-full sm:w-auto font-semibold" icon={ArrowLeft}>
              Go Back
            </Button>
          </button>
        </div>
      </div>
    </div>
  )
}

export default NotFound
