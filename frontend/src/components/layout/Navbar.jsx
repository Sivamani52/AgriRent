import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Tractor, Menu, X, HelpCircle, LogIn, UserPlus } from 'lucide-react'
import Button from '../common/Button'

function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const location = useLocation()

  const isActive = (path) => location.pathname === path

  const navLinks = [
    { label: 'Home', path: '/' },
    { label: 'Help & FAQ', path: '/help', icon: HelpCircle },
  ]

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#e2e8f0] shadow-2xs w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20 gap-2">
          {/* Logo & Brand */}
          <Link
            to="/"
            className="flex items-center gap-2.5 sm:gap-3 text-left group focus:outline-none focus:ring-2 focus:ring-[#166534] rounded-2xl p-1 min-w-0"
          >
            <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-2xl bg-[#166534] text-white flex items-center justify-center shadow-xs group-hover:bg-[#14532d] transition-colors shrink-0">
              <Tractor className="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <span className="text-lg sm:text-2xl font-black text-[#1e293b] tracking-tight block leading-tight truncate">
                Agri<span className="text-[#166534]">Rent</span>
              </span>
              <span className="text-[10px] sm:text-[11px] font-semibold text-[#64748b] hidden sm:block -mt-0.5 tracking-wide truncate">
                Agricultural Equipment Rental
              </span>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-1.5 shrink-0">
            {navLinks.map((link) => {
              const active = isActive(link.path)
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-150 ${
                    active
                      ? 'bg-[#f0fdf4] text-[#166534]'
                      : 'text-[#1e293b] hover:text-[#166534] hover:bg-slate-50'
                  }`}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>

          {/* Desktop User Action Buttons */}
          <div className="hidden md:flex items-center gap-2.5 shrink-0">
            <Link to="/login">
              <Button variant="ghost" size="sm" icon={LogIn}>
                Login
              </Button>
            </Link>
            <Link to="/register">
              <Button variant="primary" size="sm" icon={UserPlus}>
                Register
              </Button>
            </Link>
          </div>

          {/* Mobile Hamburger Button */}
          <div className="flex md:hidden shrink-0">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2.5 min-w-[44px] min-h-[44px] rounded-xl text-[#1e293b] hover:bg-slate-100 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-[#166534]"
              aria-label={isMobileMenuOpen ? 'Close main menu' : 'Open main menu'}
              aria-expanded={isMobileMenuOpen}
            >
              {isMobileMenuOpen ? (
                <X className="w-6 h-6" aria-hidden="true" />
              ) : (
                <Menu className="w-6 h-6" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-t border-[#e2e8f0] bg-white px-4 pt-3 pb-6 space-y-3 w-full animate-in fade-in slide-in-from-top-2 duration-150">
          <nav className="space-y-1">
            {navLinks.map((link) => {
              const active = isActive(link.path)
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`block px-4 py-3 rounded-xl text-base font-semibold min-h-[44px] flex items-center transition-colors ${
                    active
                      ? 'bg-[#f0fdf4] text-[#166534]'
                      : 'text-[#1e293b] hover:bg-slate-50'
                  }`}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>

          <div className="pt-3 border-t border-[#e2e8f0] flex flex-col gap-2.5">
            <Link
              to="/login"
              onClick={() => setIsMobileMenuOpen(false)}
              className="w-full"
            >
              <Button variant="outline" size="md" className="w-full min-h-[44px]" icon={LogIn}>
                Login
              </Button>
            </Link>
            <Link
              to="/register"
              onClick={() => setIsMobileMenuOpen(false)}
              className="w-full"
            >
              <Button variant="primary" size="md" className="w-full min-h-[44px]" icon={UserPlus}>
                Register
              </Button>
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}

export default Navbar
