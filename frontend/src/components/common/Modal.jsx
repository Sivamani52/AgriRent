import { useEffect } from 'react'
import { X } from 'lucide-react'

function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  className = '',
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.body.style.overflow = 'unset'
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const sizeStyles = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Card */}
      <div
        className={`relative w-full ${
          sizeStyles[size] || sizeStyles.md
        } max-h-[calc(100dvh-2rem)] flex flex-col bg-white rounded-3xl border border-[#e2e8f0] shadow-xl overflow-hidden z-10 transition-all ${className}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 sm:py-5 border-b border-[#e2e8f0] shrink-0">
          <h3 className="text-base sm:text-lg font-bold text-[#1e293b] leading-tight truncate pr-2">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 min-h-[36px] min-w-[36px] rounded-xl text-[#64748b] hover:text-[#1e293b] hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-[#166534] shrink-0 flex items-center justify-center"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="px-5 sm:px-6 py-4 sm:py-5 text-sm text-[#1e293b] leading-relaxed overflow-y-auto">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2.5 sm:gap-3 px-5 sm:px-6 py-3.5 sm:py-4 bg-slate-50 border-t border-[#e2e8f0] shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export default Modal
