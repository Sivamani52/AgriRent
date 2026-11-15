function Badge({
  children,
  variant = 'neutral',
  size = 'md',
  className = '',
  icon: Icon = null,
  ...props
}) {
  const sizeStyles = {
    sm: 'text-xs px-2.5 py-0.5 gap-1',
    md: 'text-xs px-3 py-1 gap-1.5',
    lg: 'text-sm px-3.5 py-1.5 gap-2',
  }

  const variantStyles = {
    success: 'bg-[#f0fdf4] text-[#166534] border-green-200 font-medium',
    warning: 'bg-amber-50 text-[#b45309] border-amber-200 font-medium',
    danger: 'bg-red-50 text-[#dc2626] border-red-200 font-medium',
    info: 'bg-sky-50 text-sky-800 border-sky-200 font-medium',
    neutral: 'bg-slate-50 text-[#64748b] border-[#e2e8f0] font-medium',
  }

  return (
    <span
      className={`inline-flex items-center rounded-full border ${
        sizeStyles[size] || sizeStyles.md
      } ${variantStyles[variant] || variantStyles.neutral} ${className}`}
      {...props}
    >
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      <span>{children}</span>
    </span>
  )
}

export default Badge
