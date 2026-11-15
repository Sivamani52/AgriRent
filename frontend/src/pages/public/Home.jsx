import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Tractor,
  Calendar,
  CheckCircle,
  ShieldCheck,
  Clock,
  ArrowRight,
  HelpCircle,
  Sparkles,
  Users,
  Search,
  Wrench,
  Truck,
  Droplets,
  Layers,
  MapPin,
} from 'lucide-react'
import Button from '../../components/common/Button'
import Card from '../../components/common/Card'
import Badge from '../../components/common/Badge'

function Home() {
  const [searchQuery, setSearchQuery] = useState('')

  const categories = [
    {
      name: 'Tractors & Power Units',
      description: '35HP - 75HP utility & 4WD tractors for plowing, hauling, and heavy farm work.',
      icon: Tractor,
      badge: 'Popular',
      tag: 'From ₹1,500/day',
    },
    {
      name: 'Harvesting & Threshing',
      description: 'Combine harvesters, reaper binders, and multi-crop threshers for rapid seasonal harvesting.',
      icon: Layers,
      badge: 'High Demand',
      tag: 'From ₹3,500/day',
    },
    {
      name: 'Land Preparation & Tillage',
      description: 'Rotavators, disc harrows, cultivators, and reversible MB ploughs for seedbed preparation.',
      icon: Wrench,
      badge: 'Essential',
      tag: 'From ₹800/day',
    },
    {
      name: 'Sowing & Crop Planting',
      description: 'Pneumatic precision planters, zero-till seed drills, and mechanical paddy transplanters.',
      icon: Calendar,
      badge: 'Seasonal',
      tag: 'From ₹1,000/day',
    },
    {
      name: 'Spraying & Crop Care',
      description: 'Tractor-mounted boom sprayers, orchard mist blowers, and high-pressure portable sprayers.',
      icon: Droplets,
      badge: 'Available',
      tag: 'From ₹600/day',
    },
    {
      name: 'Haulage & Post-Harvest',
      description: 'Heavy hydraulic tipping trailers, straw balers, and grain bagging machinery.',
      icon: Truck,
      badge: 'Utility',
      tag: 'From ₹1,200/day',
    },
  ]

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      window.location.href = `/login?q=${encodeURIComponent(searchQuery.trim())}`
    }
  }

  return (
    <div className="space-y-12 sm:space-y-20 lg:space-y-24 pb-16 sm:pb-20 w-full overflow-hidden">
      {/* 1. Hero Section */}
      <section className="relative bg-gradient-to-b from-[#f0fdf4] via-white to-[#f8fafc] pt-10 sm:pt-20 pb-12 sm:pb-16 px-4 sm:px-6 lg:px-8 border-b border-[#e2e8f0]/80">
        <div className="max-w-5xl mx-auto text-center space-y-5 sm:space-y-7">
          {/* Top Pill Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#f0fdf4] border border-green-200 text-[#166534] text-xs sm:text-sm font-semibold shadow-2xs max-w-full">
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#22c55e] shrink-0" />
            <span className="truncate">The Modern Agricultural Machinery Rental Platform</span>
          </div>

          {/* Main Headline */}
          <h1 className="text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-black text-[#1e293b] tracking-tight leading-tight sm:leading-[1.15]">
            Rent Farm Equipment with <br className="hidden sm:inline" />
            <span className="text-[#166534] underline decoration-[#22c55e] decoration-wavy decoration-2">
              Confidence & Ease
            </span>
          </h1>

          {/* Subtitle */}
          <p className="max-w-3xl mx-auto text-sm sm:text-lg lg:text-xl text-[#64748b] leading-relaxed">
            AgriRent directly connects local farmers with trusted machinery owners. Access high-grade tractors, harvesters, and tillers on transparent daily or hourly rental terms.
          </p>

          {/* Prominent Quick-Search Bar */}
          <div className="max-w-2xl mx-auto pt-1 w-full">
            <form
              onSubmit={handleSearchSubmit}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-white p-2 rounded-2xl sm:rounded-full border border-[#e2e8f0] shadow-md hover:border-slate-300 focus-within:border-[#166534] focus-within:ring-2 focus-within:ring-green-100 transition-all w-full"
            >
              <div className="flex items-center gap-2.5 w-full px-3 py-2 text-[#64748b] min-w-0">
                <Search className="w-5 h-5 text-[#166534] shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="What equipment do you need? (e.g. Tractor, Harvester...)"
                  className="w-full text-xs sm:text-sm text-[#1e293b] placeholder:text-[#94a3b8] bg-transparent focus:outline-none"
                />
              </div>

              <div className="shrink-0 w-full sm:w-auto">
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  className="w-full sm:w-auto rounded-xl sm:rounded-full px-6 py-2.5 font-semibold text-xs sm:text-sm min-h-[44px]"
                  icon={Search}
                >
                  Find Equipment
                </Button>
              </div>
            </form>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2 w-full">
            <Link to="/login" className="w-full sm:w-auto">
              <Button
                variant="primary"
                size="lg"
                className="w-full sm:w-auto px-7 py-3 text-sm sm:text-base font-semibold shadow-xs"
                icon={Search}
              >
                Browse All Equipment
              </Button>
            </Link>

            <Link to="/register" className="w-full sm:w-auto">
              <Button
                variant="outline"
                size="lg"
                className="w-full sm:w-auto px-7 py-3 text-sm sm:text-base font-semibold"
                icon={Tractor}
              >
                List Your Machinery
              </Button>
            </Link>
          </div>

          {/* Trust Highlights Strip: 1 col on small mobile, 2 col on tablet, 4 col on desktop */}
          <div className="pt-4 sm:pt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 max-w-4xl mx-auto text-left w-full">
            <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-[#e2e8f0] shadow-2xs flex items-center gap-3 hover:border-slate-300 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#f0fdf4] text-[#166534] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#1e293b] truncate">Verified Machines</p>
                <p className="text-[11px] text-[#64748b] truncate">Inspected by Area Admin</p>
              </div>
            </div>

            <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-[#e2e8f0] shadow-2xs flex items-center gap-3 hover:border-slate-300 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#f0fdf4] text-[#166534] flex items-center justify-center shrink-0">
                <CheckCircle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#1e293b] truncate">20% Fair Advance</p>
                <p className="text-[11px] text-[#64748b] truncate">Transparent reservation</p>
              </div>
            </div>

            <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-[#e2e8f0] shadow-2xs flex items-center gap-3 hover:border-slate-300 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#f0fdf4] text-[#166534] flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#1e293b] truncate">12-Hour Grace</p>
                <p className="text-[11px] text-[#64748b] truncate">Fast owner confirmation</p>
              </div>
            </div>

            <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-[#e2e8f0] shadow-2xs flex items-center gap-3 hover:border-slate-300 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#f0fdf4] text-[#166534] flex items-center justify-center shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#1e293b] truncate">Two-Stage Inspection</p>
                <p className="text-[11px] text-[#64748b] truncate">Pickup & return safety</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Equipment Categories Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 sm:mb-10 gap-3">
          <div className="space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-[#166534]">
              Browse by Machinery Type
            </span>
            <h2 className="text-xl sm:text-3xl lg:text-4xl font-black text-[#1e293b] tracking-tight">
              Popular Equipment Categories
            </h2>
            <p className="text-xs sm:text-sm lg:text-base text-[#64748b] max-w-xl">
              From heavy-duty tractors to seasonal harvesters, find verified agricultural machinery suited for your specific crop and soil needs.
            </p>
          </div>

          <Link to="/login" className="self-start md:self-auto shrink-0">
            <Button variant="ghost" size="sm" icon={ArrowRight} iconPosition="right">
              View All Categories
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {categories.map((cat, idx) => {
            const Icon = cat.icon
            return (
              <Card
                key={idx}
                hoverable
                className="group relative flex flex-col justify-between p-5 sm:p-6 lg:p-7 border border-[#e2e8f0] transition-all"
              >
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-[#f0fdf4] text-[#166534] flex items-center justify-center group-hover:bg-[#166534] group-hover:text-white transition-colors duration-200 shrink-0">
                      <Icon className="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true" />
                    </div>
                    <Badge variant="neutral" size="sm">
                      {cat.badge}
                    </Badge>
                  </div>

                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-[#1e293b] group-hover:text-[#166534] transition-colors">
                      {cat.name}
                    </h3>
                    <p className="mt-1.5 text-xs sm:text-sm text-[#64748b] leading-relaxed">
                      {cat.description}
                    </p>
                  </div>
                </div>

                <div className="mt-5 pt-3.5 border-t border-[#e2e8f0] flex items-center justify-between text-xs font-semibold">
                  <span className="text-[#166534] bg-[#f0fdf4] px-2.5 py-1 rounded-lg">
                    {cat.tag}
                  </span>
                  <Link
                    to="/login"
                    className="text-[#64748b] group-hover:text-[#166534] flex items-center gap-1 transition-colors p-1"
                  >
                    <span>Browse</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </Card>
            )
          })}
        </div>
      </section>

      {/* 3. How AgriRent Works (3-Step Guide) */}
      <section className="bg-white py-12 sm:py-20 border-y border-[#e2e8f0] w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-14 space-y-2 sm:space-y-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[#166534]">
              Simple & Transparent
            </span>
            <h2 className="text-xl sm:text-3xl lg:text-4xl font-black text-[#1e293b] tracking-tight">
              How AgriRent Works in 3 Easy Steps
            </h2>
            <p className="text-xs sm:text-sm lg:text-base text-[#64748b]">
              Designed so that any farmer or equipment owner can rent machinery without complicated technical hurdles.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-8">
            {/* Step 1 */}
            <div className="bg-[#f8fafc] rounded-3xl p-6 sm:p-8 border border-[#e2e8f0] space-y-3.5 text-center hover:border-slate-300 transition-colors">
              <div className="w-12 h-12 sm:w-14 sm:h-14 mx-auto rounded-2xl bg-[#166534] text-white flex items-center justify-center font-black text-lg sm:text-xl shadow-xs">
                1
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-[#1e293b]">
                Find Equipment
              </h3>
              <p className="text-xs sm:text-sm text-[#64748b] leading-relaxed">
                Filter by machinery type and village location. Review transparent daily/hourly pricing, specifications, and verified photos.
              </p>
            </div>

            {/* Step 2 */}
            <div className="bg-[#f8fafc] rounded-3xl p-6 sm:p-8 border border-[#e2e8f0] space-y-3.5 text-center hover:border-slate-300 transition-colors">
              <div className="w-12 h-12 sm:w-14 sm:h-14 mx-auto rounded-2xl bg-[#166534] text-white flex items-center justify-center font-black text-lg sm:text-xl shadow-xs">
                2
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-[#1e293b]">
                Book & Pay 20% Advance
              </h3>
              <p className="text-xs sm:text-sm text-[#64748b] leading-relaxed">
                Pick your work dates. Once the owner accepts your request, submit the 20% advance via UPI with a generous 12-hour confirmation window.
              </p>
            </div>

            {/* Step 3 */}
            <div className="bg-[#f8fafc] rounded-3xl p-6 sm:p-8 border border-[#e2e8f0] space-y-3.5 text-center hover:border-slate-300 transition-colors">
              <div className="w-12 h-12 sm:w-14 sm:h-14 mx-auto rounded-2xl bg-[#166534] text-white flex items-center justify-center font-black text-lg sm:text-xl shadow-xs">
                3
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-[#1e293b]">
                Inspect & Farm
              </h3>
              <p className="text-xs sm:text-sm text-[#64748b] leading-relaxed">
                Verify machinery condition (engine, tyres, fuel) together during pickup and return. Both farmer and owner stay completely protected.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Comparative Value: For Farmers vs. For Equipment Owners */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 lg:gap-12">
          {/* Card: For Farmers */}
          <div className="bg-white rounded-3xl p-6 sm:p-8 lg:p-10 border border-[#e2e8f0] shadow-xs space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="inline-flex p-3 rounded-2xl bg-[#f0fdf4] text-[#166534]">
                <Tractor className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>

              <h3 className="text-xl sm:text-2xl lg:text-3xl font-black text-[#1e293b] tracking-tight">
                For Farmers
              </h3>

              <p className="text-xs sm:text-sm lg:text-base text-[#64748b] leading-relaxed">
                Get high-power agricultural implements when you need them without taking heavy farm loans or paying for year-round depreciation.
              </p>

              <div className="space-y-3 pt-1">
                <div className="flex items-start gap-2.5">
                  <CheckCircle className="w-5 h-5 text-[#166534] shrink-0 mt-0.5" />
                  <span className="text-xs sm:text-sm font-medium text-[#1e293b]">
                    Search verified tractors, cultivators, and harvesters in your local area.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle className="w-5 h-5 text-[#166534] shrink-0 mt-0.5" />
                  <span className="text-xs sm:text-sm font-medium text-[#1e293b]">
                    Pay only 20% advance to confirm your seasonal dates.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle className="w-5 h-5 text-[#166534] shrink-0 mt-0.5" />
                  <span className="text-xs sm:text-sm font-medium text-[#1e293b]">
                    Two-stage inspection ensures you receive machinery in good working order.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle className="w-5 h-5 text-[#166534] shrink-0 mt-0.5" />
                  <span className="text-xs sm:text-sm font-medium text-[#1e293b]">
                    Fair dispute assistance managed directly by your local Area Administrator.
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-[#e2e8f0]">
              <Link to="/register" className="block sm:inline-block">
                <Button variant="primary" size="md" className="w-full sm:w-auto" icon={ArrowRight} iconPosition="right">
                  Create Farmer Account
                </Button>
              </Link>
            </div>
          </div>

          {/* Card: For Equipment Owners */}
          <div className="bg-white rounded-3xl p-6 sm:p-8 lg:p-10 border border-[#e2e8f0] shadow-xs space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="inline-flex p-3 rounded-2xl bg-slate-100 text-[#1e293b]">
                <Calendar className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>

              <h3 className="text-xl sm:text-2xl lg:text-3xl font-black text-[#1e293b] tracking-tight">
                For Equipment Owners
              </h3>

              <p className="text-xs sm:text-sm lg:text-base text-[#64748b] leading-relaxed">
                Turn your machinery into steady seasonal earnings. Retain full authority over booking approvals and rental scheduling.
              </p>

              <div className="space-y-3 pt-1">
                <div className="flex items-start gap-2.5">
                  <CheckCircle className="w-5 h-5 text-[#166534] shrink-0 mt-0.5" />
                  <span className="text-xs sm:text-sm font-medium text-[#1e293b]">
                    Review and accept only the booking requests that suit your schedule.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle className="w-5 h-5 text-[#166534] shrink-0 mt-0.5" />
                  <span className="text-xs sm:text-sm font-medium text-[#1e293b]">
                    Generous 12-hour grace period to inspect and verify advance payments.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle className="w-5 h-5 text-[#166534] shrink-0 mt-0.5" />
                  <span className="text-xs sm:text-sm font-medium text-[#1e293b]">
                    Standardized checklists document machinery condition at pickup and return.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle className="w-5 h-5 text-[#166534] shrink-0 mt-0.5" />
                  <span className="text-xs sm:text-sm font-medium text-[#1e293b]">
                    Platform policy safeguards your machinery with return damage reporting.
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-[#e2e8f0]">
              <Link to="/register" className="block sm:inline-block">
                <Button variant="outline" size="md" className="w-full sm:w-auto" icon={ArrowRight} iconPosition="right">
                  Register as Equipment Owner
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Trust & Safety Banner */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        <div className="rounded-3xl bg-white border border-[#e2e8f0] p-6 sm:p-8 lg:p-12 shadow-xs grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 items-center">
          <div className="space-y-1.5 md:col-span-1">
            <span className="text-xs font-bold uppercase tracking-wider text-[#166534]">
              Trust & Transparency
            </span>
            <h3 className="text-lg sm:text-2xl font-black text-[#1e293b]">
              Built for Farm Safety
            </h3>
            <p className="text-xs sm:text-sm text-[#64748b]">
              Every rental on AgriRent is supported by official checks and regional administration.
            </p>
          </div>

          <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#f0fdf4] text-[#166534] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="space-y-0.5 min-w-0">
                <h4 className="text-xs sm:text-sm font-bold text-[#1e293b]">Area Admin Verification</h4>
                <p className="text-xs text-[#64748b] leading-relaxed">
                  Every listed machine is verified for operational safety and registration before being visible.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#f0fdf4] text-[#166534] flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5" />
              </div>
              <div className="space-y-0.5 min-w-0">
                <h4 className="text-xs sm:text-sm font-bold text-[#1e293b]">Local Proximity Search</h4>
                <p className="text-xs text-[#64748b] leading-relaxed">
                  Find machinery nearest to your farmland to cut transport delays and travel expenses.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. High-Impact Bottom Call to Action */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        <div className="rounded-3xl bg-[#166534] text-white p-6 sm:p-10 lg:p-14 text-center space-y-5 sm:space-y-6 shadow-lg relative overflow-hidden">
          <div className="relative z-10 max-w-2xl mx-auto space-y-3.5">
            <h2 className="text-xl sm:text-3xl lg:text-4xl font-black tracking-tight leading-tight">
              Ready to Experience Fair and Simple Farm Equipment Rental?
            </h2>

            <p className="text-green-100 text-xs sm:text-sm lg:text-base leading-relaxed">
              Join local farmers and machinery owners across the region. Free account setup with no hidden subscription fees.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-3 w-full">
              <Link to="/register" className="w-full sm:w-auto">
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full sm:w-auto text-sm sm:text-base font-bold px-7 py-3 bg-white text-[#166534] hover:bg-[#f0fdf4] shadow-sm"
                >
                  Create Your Free Account
                </Button>
              </Link>

              <Link to="/help" className="w-full sm:w-auto">
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full sm:w-auto text-sm sm:text-base font-semibold px-7 py-3 border-white text-white bg-transparent hover:bg-white/10"
                  icon={HelpCircle}
                >
                  Visit Help Center
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default Home
