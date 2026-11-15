function Input({
  label,
  id,
  name,
  type = 'text',
  value,
  onChange,
  placeholder,
  required = false,
  disabled = false,
  error,
  helperText,
  icon: Icon = null,
  className = '',
  ...props
}) {
  const inputId = id || name

  return (
    <div className="w-full text-left">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-xs sm:text-sm font-semibold text-[#1e293b] mb-1.5"
        >
          {label}
          {required && <span className="text-[#dc2626] ml-1">*</span>}
        </label>
      )}

      <div className="relative rounded-xl w-full">
        {Icon && (
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#64748b]">
            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
          </div>
        )}

        <input
          id={inputId}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
          required={required}
          className={`block w-full min-h-[44px] rounded-xl border bg-white py-2.5 text-base sm:text-sm text-[#1e293b] placeholder:text-[#94a3b8] transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:bg-slate-100 disabled:text-[#64748b] disabled:cursor-not-allowed ${
            Icon ? 'pl-10 pr-3.5' : 'px-3.5'
          } ${
            error
              ? 'border-[#dc2626] focus:border-[#dc2626] focus:ring-red-200'
              : 'border-[#e2e8f0] hover:border-slate-300 focus:border-[#166534] focus:ring-green-100'
          } ${className}`}
          {...props}
        />
      </div>

      {error ? (
        <p className="mt-1.5 text-xs text-[#dc2626] font-medium leading-normal">{error}</p>
      ) : helperText ? (
        <p className="mt-1.5 text-xs text-[#64748b] leading-normal">{helperText}</p>
      ) : null}
    </div>
  )
}

export default Input
