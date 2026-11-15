function Card({
  children,
  title,
  subtitle,
  footer,
  hoverable = false,
  padding = 'md',
  className = '',
  ...props
}) {
  const paddingStyles = {
    none: 'p-0',
    sm: 'p-4 sm:p-5',
    md: 'p-5 sm:p-6',
    lg: 'p-6 sm:p-8',
  }

  return (
    <div
      className={`bg-white rounded-2xl border border-[#e2e8f0] shadow-xs transition-all duration-200 ${
        hoverable
          ? 'hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300'
          : ''
      } ${paddingStyles[padding] || paddingStyles.md} ${className}`}
      {...props}
    >
      {(title || subtitle) && (
        <div className="mb-4">
          {title && (
            <h3 className="text-lg font-bold text-[#1e293b] leading-snug">
              {title}
            </h3>
          )}
          {subtitle && (
            <p className="mt-1 text-sm text-[#64748b] leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
      )}

      {children}

      {footer && (
        <div className="mt-5 pt-4 border-t border-[#e2e8f0]">{footer}</div>
      )}
    </div>
  )
}

export default Card
