import { Link } from 'react-router-dom'
import { Tractor, Phone, Mail, ShieldCheck, Clock, CheckCircle } from 'lucide-react'

function Footer() {
  return (
    <footer className="bg-[#0f172a] text-slate-300 border-t border-slate-800 w-full overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 lg:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* Column 1: Brand & Purpose */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#166534] text-white flex items-center justify-center shrink-0">
                <Tractor className="w-6 h-6" aria-hidden="true" />
              </div>
              <span className="text-xl sm:text-2xl font-black text-white tracking-tight">
                Agri<span className="text-[#22c55e]">Rent</span>
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed break-words">
              AgriRent is a modern agricultural machinery rental platform connecting verified local farmers with tractor and equipment owners for simple, transparent, and affordable rentals.
            </p>
          </div>

          {/* Column 2: Quick Links */}
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider mb-3.5 sm:mb-4">
              Platform Navigation
            </h4>
            <ul className="space-y-2.5 text-xs sm:text-sm">
              <li>
                <Link to="/" className="hover:text-[#22c55e] transition-colors inline-block py-1">
                  Home
                </Link>
              </li>
              <li>
                <Link to="/help" className="hover:text-[#22c55e] transition-colors inline-block py-1">
                  Help & Frequently Asked Questions
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-[#22c55e] transition-colors inline-block py-1">
                  Account Login
                </Link>
              </li>
              <li>
                <Link to="/register" className="hover:text-[#22c55e] transition-colors inline-block py-1">
                  Farmer & Owner Registration
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 3: Trust & Safety */}
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider mb-3.5 sm:mb-4">
              Platform Guarantees
            </h4>
            <ul className="space-y-3 text-xs sm:text-sm text-slate-400">
              <li className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-[#22c55e] shrink-0" />
                <span>Admin-Verified Equipment</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-[#22c55e] shrink-0" />
                <span>12-Hour Payment Grace Period</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle className="w-4 h-4 text-[#22c55e] shrink-0" />
                <span>Transparent 20% Advance Lock</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle className="w-4 h-4 text-[#22c55e] shrink-0" />
                <span>Two-Stage Handover Inspection</span>
              </li>
            </ul>
          </div>

          {/* Column 4: Farmer Support */}
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider mb-3.5 sm:mb-4">
              Help & Inquiries
            </h4>
            <div className="space-y-3.5 text-xs sm:text-sm text-slate-400">
              <div className="flex items-start gap-2.5">
                <Phone className="w-4 h-4 text-[#22c55e] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <span className="block text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                    Toll-Free Helpline
                  </span>
                  <span className="text-white font-bold text-sm sm:text-base break-words">1800-AGRI-RENT</span>
                  <span className="block text-[11px] text-slate-500">Mon - Sat, 8 AM - 8 PM</span>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Mail className="w-4 h-4 text-[#22c55e] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <span className="block text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                    Email Support
                  </span>
                  <span className="text-white font-medium text-xs sm:text-sm break-all">support@agrirent.com</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 sm:mt-12 pt-6 sm:pt-8 border-t border-slate-800 text-center text-[11px] sm:text-xs text-slate-500 leading-relaxed">
          <p>© 2026 AgriRent Platform. All rights reserved. Connecting Farmers and Agricultural Equipment Owners.</p>
        </div>
      </div>
    </footer>
  )
}

export default Footer
