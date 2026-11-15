import { useState } from 'react'
import {
  Phone,
  Mail,
  HelpCircle,
  CheckCircle,
  ShieldCheck,
  Clock,
  Tractor,
  Search,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import Card from '../../components/common/Card'

function Help() {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('ALL')
  const [expandedFaq, setExpandedFaq] = useState(0)

  const categories = [
    { id: 'ALL', label: 'All Questions' },
    { id: 'RENTAL', label: 'Renting Equipment' },
    { id: 'PAYMENT', label: '20% Advance & Payments' },
    { id: 'INSPECTION', label: 'Inspections & Damage' },
    { id: 'OWNER', label: 'For Machinery Owners' },
  ]

  const faqs = [
    {
      category: 'RENTAL',
      question: 'How do I rent equipment on AgriRent?',
      answer:
        'Create a free Farmer account, browse verified machinery in your local area, select your required start and end dates, and click "Request Booking". The equipment owner will review and accept your request.',
    },
    {
      category: 'PAYMENT',
      question: 'How does the 20% advance payment work?',
      answer:
        'To prevent fake requests and protect both parties, AgriRent requires a simple 20% advance payment once an owner accepts your booking. You submit your advance payment transaction details (UPI or bank transfer), and the owner verifies it within a 12-hour grace period to confirm the reservation.',
    },
    {
      category: 'PAYMENT',
      question: 'What happens if the owner does not verify the payment in 12 hours?',
      answer:
        'AgriRent gives owners a fair 12-hour verification window and sends reminder notices. If an unverified request expires, the platform safeguards the renter and ensures any submitted advance payment is processed for refund or prompt administrative review.',
    },
    {
      category: 'INSPECTION',
      question: 'What is the Two-Stage Inspection process?',
      answer:
        'AgriRent protects farmers and owners through two documented inspections: (1) Stage 1 Initial Handover Inspection when picking up the machine to verify fuel, engine, tyres, and body condition; and (2) Stage 2 Final Return Inspection when handing the machinery back.',
    },
    {
      category: 'INSPECTION',
      question: 'What happens if damage or breakdown is reported?',
      answer:
        'If an owner notes damage during the return inspection, an automatic dispute review is created in the platform. The local Area Administrator reviews the inspection notes and photos to reach an impartial decision.',
    },
    {
      category: 'OWNER',
      question: 'How can equipment owners list their machinery?',
      answer:
        'Register as an Equipment Owner, specify your location, and list your tractors or farm implements with genuine photos and daily/hourly rates. An Area Administrator will review and verify your equipment before it appears in public search results.',
    },
    {
      category: 'OWNER',
      question: 'Do equipment owners have full control over bookings?',
      answer:
        'Yes. Equipment owners have complete freedom to accept or reject any booking request based on machinery maintenance schedules or personal availability.',
    },
    {
      category: 'RENTAL',
      question: 'Can I rent equipment for just a few hours instead of a full day?',
      answer:
        'Yes! Many equipment listings on AgriRent support hourly rates in addition to daily rates, allowing you to pay only for the exact field hours you require.',
    },
  ]

  const filteredFaqs = faqs.filter((faq) => {
    const matchesCategory =
      activeCategory === 'ALL' || faq.category === activeCategory
    const matchesSearch =
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16 space-y-10 sm:space-y-14 w-full overflow-hidden">
      {/* Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#f0fdf4] border border-green-200 text-[#166534] text-xs sm:text-sm font-semibold max-w-full">
          <HelpCircle className="w-4 h-4 text-[#22c55e] shrink-0" />
          <span className="truncate">Support & Frequently Asked Questions</span>
        </div>

        <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-[#1e293b] tracking-tight">
          How Can We Help You?
        </h1>

        <p className="text-xs sm:text-base lg:text-lg text-[#64748b] leading-relaxed">
          Find clear, simple answers to all questions regarding equipment rentals, advance payments, inspections, and safety.
        </p>

        {/* Live Search Input */}
        <div className="pt-2 max-w-xl mx-auto w-full">
          <div className="relative flex items-center bg-white rounded-2xl border border-[#e2e8f0] px-3.5 sm:px-4 py-2.5 sm:py-3 shadow-xs focus-within:border-[#166534] focus-within:ring-2 focus-within:ring-green-100 transition-all w-full">
            <Search className="w-4 h-4 sm:w-5 sm:h-5 text-[#64748b] mr-2.5 sm:mr-3 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search help topics (e.g. advance, inspection...)"
              className="w-full text-xs sm:text-sm text-[#1e293b] placeholder:text-[#94a3b8] bg-transparent focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Direct Contact Banner */}
      <div className="bg-white rounded-3xl border border-[#e2e8f0] p-5 sm:p-8 shadow-xs grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6 items-center w-full">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-[#f0fdf4] text-[#166534] flex items-center justify-center shrink-0">
            <Phone className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider font-bold text-[#64748b]">Toll-Free Helpline</p>
            <p className="text-base sm:text-lg font-black text-[#1e293b] truncate">1800-AGRI-RENT</p>
            <p className="text-xs text-[#64748b] truncate">Mon - Sat, 8 AM - 8 PM</p>
          </div>
        </div>

        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-[#f0fdf4] text-[#166534] flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider font-bold text-[#64748b]">Email Support</p>
            <p className="text-sm sm:text-lg font-black text-[#1e293b] truncate">support@agrirent.com</p>
            <p className="text-xs text-[#64748b] truncate">Response within 24 hours</p>
          </div>
        </div>

        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-[#f0fdf4] text-[#166534] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider font-bold text-[#64748b]">Area Administrator</p>
            <p className="text-base sm:text-lg font-black text-[#1e293b] truncate">District Assistance</p>
            <p className="text-xs text-[#64748b] truncate">Inspection & Dispute Support</p>
          </div>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1 w-full">
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCategory(cat.id)}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer min-h-[36px] ${
              activeCategory === cat.id
                ? 'bg-[#166534] text-white shadow-xs'
                : 'bg-white text-[#64748b] border border-[#e2e8f0] hover:border-slate-300 hover:text-[#1e293b]'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Accordion FAQ List */}
      <div className="space-y-3.5 sm:space-y-4 w-full">
        {filteredFaqs.length === 0 ? (
          <Card className="text-center py-10">
            <p className="text-xs sm:text-sm text-[#64748b]">
              No questions found matching &ldquo;{searchQuery}&rdquo;. Try another search term or call our helpline.
            </p>
          </Card>
        ) : (
          filteredFaqs.map((faq, index) => {
            const isExpanded = expandedFaq === index
            return (
              <div
                key={index}
                className="bg-white rounded-2xl border border-[#e2e8f0] shadow-xs overflow-hidden transition-all duration-200"
              >
                <button
                  type="button"
                  onClick={() => setExpandedFaq(isExpanded ? null : index)}
                  className="w-full flex items-center justify-between p-4 sm:p-6 text-left cursor-pointer hover:bg-slate-50/50 transition-colors gap-3"
                  aria-expanded={isExpanded}
                >
                  <span className="text-sm sm:text-base font-bold text-[#1e293b] flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-[#166534] shrink-0" />
                    <span className="break-words">{faq.question}</span>
                  </span>
                  <div className="p-1 sm:p-1.5 rounded-lg text-[#64748b] bg-slate-100 shrink-0">
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 sm:px-6 pb-5 pt-1 text-xs sm:text-sm text-[#64748b] leading-relaxed border-t border-slate-100 pl-4 sm:pl-14">
                    {faq.answer}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Helpful Pre-Rental Tips */}
      <div className="bg-[#f0fdf4] rounded-3xl border border-green-200 p-5 sm:p-8 lg:p-10 space-y-4 w-full">
        <h3 className="text-base sm:text-xl font-bold text-[#166534] flex items-center gap-2">
          <Tractor className="w-5 h-5 sm:w-6 sm:h-6 text-[#166534] shrink-0" />
          <span>Helpful Tips for a Smooth Equipment Rental</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4 text-xs sm:text-sm text-[#1e293b]">
          <div className="flex items-start gap-2.5 bg-white/80 p-3.5 rounded-xl border border-green-100">
            <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-[#166534] shrink-0 mt-0.5" />
            <span>Book 2 to 3 days in advance during peak seasonal sowing and harvesting times.</span>
          </div>
          <div className="flex items-start gap-2.5 bg-white/80 p-3.5 rounded-xl border border-green-100">
            <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-[#166534] shrink-0 mt-0.5" />
            <span>Always complete the two-stage condition checklist during pickup with the owner.</span>
          </div>
          <div className="flex items-start gap-2.5 bg-white/80 p-3.5 rounded-xl border border-green-100">
            <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-[#166534] shrink-0 mt-0.5" />
            <span>Keep your UPI transaction reference number handy for fast advance payment confirmation.</span>
          </div>
          <div className="flex items-start gap-2.5 bg-white/80 p-3.5 rounded-xl border border-green-100">
            <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-[#166534] shrink-0 mt-0.5" />
            <span>Return the machinery cleaned and on time to build a strong platform trust rating.</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Help
