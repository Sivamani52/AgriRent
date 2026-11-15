function Button({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled = false,
  icon: Icon = null,
  iconPosition = 'left',
  type = 'button',
  onClick,
  className = '',
  ...props
}) {
  const baseStyles =
    'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed select-none cursor-pointer text-center max-w-full'

  const sizeStyles = {
    sm: 'text-xs px-3 py-1.5 gap-1.5 min-h-[36px]',
    md: 'text-sm px-4 py-2.5 gap-2 min-h-[44px]',
    lg: 'text-base px-6 py-3 gap-2.5 min-h-[48px]',
  }

  const variantStyles = {
    primary:
      'bg-[#166534] text-white hover:bg-[#14532d] active:bg-[#0f3d21] focus:ring-[#166534] shadow-xs active:scale-[0.99]',
    secondary:
      'bg-[#22c55e] text-white hover:bg-[#16a34a] active:bg-[#15803d] focus:ring-[#22c55e] shadow-xs active:scale-[0.99]',
    light:
      'bg-[#f0fdf4] text-[#166534] hover:bg-[#dcfce7] active:bg-[#bbf7d0] focus:ring-[#166534]',
    outline:
      'border-2 border-[#166534] text-[#166534] bg-white hover:bg-[#f0fdf4] active:bg-[#dcfce7] focus:ring-[#166534]',
    ghost:
      'text-[#1e293b] bg-transparent hover:bg-slate-100 active:bg-slate-200 focus:ring-slate-400',
    danger:
      'bg-[#dc2626] text-white hover:bg-red-700 active:bg-red-800 focus:ring-red-500 shadow-xs active:scale-[0.99]',
  }

  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      onClick={onClick}
      className={`${baseStyles} ${sizeStyles[size] || sizeStyles.md} ${
        variantStyles[variant] || variantStyles.primary
      } ${className}`}
      {...props}
    >
      {isLoading && (
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v8H4z"
          />
        </svg>
      )}

      {!isLoading && Icon && iconPosition === 'left' && (
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      )}

      <span className="truncate">{children}</span>

      {!isLoading && Icon && iconPosition === 'right' && (
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      )}
    </button>
  )
}

export default Button
